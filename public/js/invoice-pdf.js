/**
 * Invoice PDF Generator
 * Generates French association (loi 1901) compliant invoices using jsPDF
 */

function generatePDF() {
    // Check if jsPDF is loaded
    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert('PDF library not loaded. Please refresh the page and try again.');
        return;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    // Page dimensions
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;

    // Font settings
    const fontNormal = 'courier';
    let y = margin;

    // Helper functions
    function formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('fr-FR');
    }

    function drawLine(startX, startY, endX, endY) {
        doc.setLineWidth(0.3);
        doc.line(startX, startY, endX, endY);
    }

    function drawHorizontalLine(yPos) {
        drawLine(margin, yPos, pageWidth - margin, yPos);
    }

    // Set font
    doc.setFont(fontNormal, 'normal');

    // ===== HEADER =====
    doc.setFontSize(18);
    doc.setFont(fontNormal, 'bold');
    doc.text('FACTURE', pageWidth / 2, y, { align: 'center' });
    y += 8;

    doc.setFontSize(12);
    doc.setFont(fontNormal, 'normal');
    doc.text(`N° ${invoiceData.invoiceNumber}`, pageWidth / 2, y, { align: 'center' });
    y += 6;

    // Band name after invoice number
    if (invoiceData.bandName) {
        doc.setFontSize(10);
        doc.text(invoiceData.bandName, pageWidth / 2, y, { align: 'center' });
        y += 6;
    }

    doc.setFontSize(10);
    doc.text(`Date d'emission: ${formatDate(invoiceData.issueDate)}`, pageWidth / 2, y, { align: 'center' });
    y += 5;

    if (invoiceData.serviceDate) {
        doc.text(`Date de prestation: ${formatDate(invoiceData.serviceDate)}`, pageWidth / 2, y, { align: 'center' });
        y += 5;
    }

    y += 5;
    drawHorizontalLine(y);
    y += 8;

    // ===== SELLER AND BUYER INFO =====
    const colWidth = contentWidth / 2 - 5;

    // Seller (left column)
    doc.setFontSize(10);
    doc.setFont(fontNormal, 'bold');
    doc.text('EMETTEUR', margin, y);

    // Buyer (right column)
    doc.text('DESTINATAIRE', margin + colWidth + 10, y);
    y += 6;

    doc.setFont(fontNormal, 'normal');
    doc.setFontSize(9);

    // Seller details
    let sellerY = y;
    if (invoiceConfig.associationName) {
        doc.text(invoiceConfig.associationName, margin, sellerY);
        sellerY += 4;
        sellerY += 4; // Empty line after name
    }
    if (invoiceConfig.associationAddress) {
        // Split by newlines first, then wrap each line if needed
        const addressParts = invoiceConfig.associationAddress.split('\n').filter(part => part.trim());
        addressParts.forEach(part => {
            const wrappedLines = doc.splitTextToSize(part, colWidth);
            wrappedLines.forEach(line => {
                doc.text(line, margin, sellerY);
                sellerY += 4;
            });
        });
        sellerY += 4; // Empty line after address
    }
    if (invoiceConfig.associationSiret) {
        doc.text(`SIRET: ${invoiceConfig.associationSiret}`, margin, sellerY);
        sellerY += 4;
    }

    // Buyer details
    let buyerY = y;
    if (invoiceData.clientName) {
        doc.text(invoiceData.clientName, margin + colWidth + 10, buyerY);
        buyerY += 4;
        buyerY += 4; // Empty line after name
    }
    if (invoiceData.clientAddress) {
        // Split by newlines first, then wrap each line if needed
        const addressParts = invoiceData.clientAddress.split('\n').filter(part => part.trim());
        addressParts.forEach(part => {
            const wrappedLines = doc.splitTextToSize(part, colWidth);
            wrappedLines.forEach(line => {
                doc.text(line, margin + colWidth + 10, buyerY);
                buyerY += 4;
            });
        });
        buyerY += 4; // Empty line after address
    }
    if (invoiceData.clientSiret) {
        doc.text(`SIRET: ${invoiceData.clientSiret}`, margin + colWidth + 10, buyerY);
        buyerY += 4;
    }

    y = Math.max(sellerY, buyerY) + 5;
    drawHorizontalLine(y);
    y += 8;

    // ===== ITEMS TABLE =====
    doc.setFontSize(10);
    doc.setFont(fontNormal, 'bold');
    doc.text('PRESTATIONS', margin, y);
    y += 6;

    // Table header
    const tableColumns = [
        { header: 'Description', dataKey: 'description' },
        { header: 'Qte', dataKey: 'quantity' },
        { header: 'Prix unit.', dataKey: 'unitPrice' },
        { header: 'Total', dataKey: 'total' }
    ];

    const tableData = invoiceData.items.map(item => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unitPrice: item.unit_price.toFixed(2) + ' EUR',
        total: item.total.toFixed(2) + ' EUR'
    }));

    doc.autoTable({
        startY: y,
        head: [['Description', 'Qte', 'Prix unit.', 'Total']],
        body: tableData.map(row => [row.description, row.quantity, row.unitPrice, row.total]),
        foot: [['', '', 'TOTAL', invoiceData.totalAmount.toFixed(2) + ' EUR']],
        theme: 'plain',
        styles: {
            font: 'courier',
            fontSize: 9,
            cellPadding: 2,
            lineColor: [0, 0, 0],
            lineWidth: 0.2
        },
        headStyles: {
            fontStyle: 'bold',
            fillColor: [255, 255, 255],
            textColor: [0, 0, 0]
        },
        footStyles: {
            fontStyle: 'bold',
            fillColor: [255, 255, 255],
            textColor: [0, 0, 0]
        },
        columnStyles: {
            0: { cellWidth: 90 },
            1: { cellWidth: 20, halign: 'right' },
            2: { cellWidth: 30, halign: 'right' },
            3: { cellWidth: 30, halign: 'right' }
        },
        margin: { left: margin, right: margin }
    });

    y = doc.lastAutoTable.finalY + 10;

    // ===== PAYMENT TERMS =====
    // Only show section if ANY payment condition text exists
    const hasPaymentConditions = invoiceData.paymentDelayText ||
                                  invoiceData.latePenaltyText ||
                                  invoiceData.recoveryFeeText;

    if (hasPaymentConditions) {
        drawHorizontalLine(y);
        y += 8;

        doc.setFontSize(10);
        doc.setFont(fontNormal, 'bold');
        doc.text('CONDITIONS DE PAIEMENT', margin, y);
        y += 6;

        doc.setFont(fontNormal, 'normal');
        doc.setFontSize(9);

        // Show only conditions that have text (NULL = don't show)
        if (invoiceData.paymentDelayText) {
            doc.text(invoiceData.paymentDelayText, margin, y);
            y += 4;
        }

        if (invoiceData.latePenaltyText) {
            doc.text(invoiceData.latePenaltyText, margin, y);
            y += 4;
        }

        if (invoiceData.recoveryFeeText) {
            doc.text(invoiceData.recoveryFeeText, margin, y);
            y += 4;
        }

        y += 4;
    }

    // ===== BANK DETAILS =====
    if (invoiceConfig.iban || invoiceConfig.bic) {
        doc.setFont(fontNormal, 'bold');
        doc.setFontSize(10);
        doc.text('COORDONNEES BANCAIRES', margin, y);
        y += 6;

        doc.setFont(fontNormal, 'normal');
        doc.setFontSize(9);

        if (invoiceConfig.bankName) {
            doc.text(`Banque: ${invoiceConfig.bankName}`, margin, y);
            y += 4;
        }
        if (invoiceConfig.iban) {
            doc.text(`IBAN: ${invoiceConfig.iban}`, margin, y);
            y += 4;
        }
        if (invoiceConfig.bic) {
            doc.text(`BIC: ${invoiceConfig.bic}`, margin, y);
            y += 4;
        }

        y += 4;
        doc.setFont(fontNormal, 'italic');
        doc.text("Merci d'indiquer le numero de facture dans le libelle du virement.", margin, y);
        y += 8;
    }

    // ===== FOOTER =====
    drawHorizontalLine(y);
    y += 6;

    doc.setFont(fontNormal, 'normal');
    doc.setFontSize(8);

    if (invoiceConfig.tvaMention) {
        doc.text(invoiceConfig.tvaMention, pageWidth / 2, y, { align: 'center' });
        y += 4;
    }

    if (invoiceConfig.customFooter) {
        const footerLines = doc.splitTextToSize(invoiceConfig.customFooter, contentWidth);
        footerLines.forEach(line => {
            doc.text(line, pageWidth / 2, y, { align: 'center' });
            y += 4;
        });
    }

    // Save the PDF
    const filename = `Facture_${invoiceData.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
    doc.save(filename);
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Error generating PDF. Please try again.');
    }
}
