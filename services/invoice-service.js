const {
    generateInvoiceNumber,
    createInvoice,
    getInvoiceById,
    getInvoicesByBand,
    getAllInvoicesWithBands,
    updateInvoice,
    deleteInvoice,
    addInvoiceItem,
    getInvoiceItems,
    deleteInvoiceItems,
    getAllConfig,
    createTransaction,
    getBandById
} = require('../lib/db');
const { NotFoundError, ValidationError, ConflictError } = require('../lib/errors');

// Valid status transitions for band users (admins can set any status)
const BAND_STATUS_TRANSITIONS = {
    draft: ['sent', 'cancelled'],
    sent: ['paid', 'cancelled'],
    paid: [],
    cancelled: []
};

/**
 * Invoice Service
 * Handles all invoice-related business logic
 */
class InvoiceService {
    /**
     * Validate status transition for band users
     * @param {string} currentStatus - Current invoice status
     * @param {string} newStatus - New status to transition to
     * @param {boolean} isAdmin - Whether user is admin (admins bypass validation)
     * @throws {ValidationError} If transition is not allowed
     */
    validateStatusTransition(currentStatus, newStatus, isAdmin = false) {
        // Admins can set any status
        if (isAdmin) return;

        // Same status is always allowed
        if (currentStatus === newStatus) return;

        const allowedTransitions = BAND_STATUS_TRANSITIONS[currentStatus] || [];
        if (!allowedTransitions.includes(newStatus)) {
            throw new ValidationError(
                `Cannot change status from '${currentStatus}' to '${newStatus}'`,
                `Cannot change invoice status from ${currentStatus} to ${newStatus}`
            );
        }
    }
    /**
     * Get invoices for a band with filters
     * @param {number} bandId - Band ID
     * @param {string|null} statusFilter - Status filter (draft, sent, paid, cancelled)
     * @returns {Promise<Array>} List of invoices
     */
    async getInvoicesForBand(bandId, statusFilter = null) {
        return await getInvoicesByBand(bandId, statusFilter);
    }

    /**
     * Get all invoices with bands (admin view)
     * @param {number|null} bandFilter - Band ID filter
     * @param {string|null} statusFilter - Status filter
     * @returns {Promise<Array>} List of invoices with band info
     */
    async getAllInvoices(bandFilter = null, statusFilter = null) {
        return await getAllInvoicesWithBands(bandFilter, statusFilter);
    }

    /**
     * Get invoice by ID with items
     * @param {number} invoiceId - Invoice ID
     * @returns {Promise<Object>} Invoice object with items
     * @throws {NotFoundError} If invoice not found
     */
    async getById(invoiceId) {
        const invoice = await getInvoiceById(invoiceId);
        if (!invoice) {
            throw new NotFoundError('Invoice');
        }
        const items = await getInvoiceItems(invoiceId);
        return { ...invoice, items };
    }

    /**
     * Get invoice configuration
     * @returns {Promise<Object>} Invoice configuration object
     */
    async getInvoiceConfig() {
        const allConfig = await getAllConfig();
        return {
            prefix: allConfig.invoice_prefix || 'FAC',
            associationName: allConfig.association_name || '',
            associationAddress: allConfig.association_address || '',
            associationSiret: allConfig.association_siret || '',
            tvaMention: allConfig.tva_mention || 'TVA non applicable, art. 293 B du CGI',
            paymentDelayDays: parseInt(allConfig.payment_delay_days) || 30,
            latePenaltyRate: allConfig.late_penalty_rate || "3 fois le taux d'interet legal",
            iban: allConfig.iban || '',
            bic: allConfig.bic || '',
            bankName: allConfig.bank_name || '',
            customFooter: allConfig.custom_footer || ''
        };
    }

    /**
     * Create a new invoice with items
     * @param {Object} data - Invoice data
     * @param {number} data.bandId - Band ID
     * @param {string} data.issueDate - Issue date
     * @param {string} data.serviceDate - Service date (optional)
     * @param {string} data.clientName - Client name
     * @param {string} data.clientAddress - Client address
     * @param {string} data.clientSiret - Client SIRET (optional)
     * @param {string} data.notes - Notes (optional)
     * @param {Array} data.items - Invoice line items
     * @returns {Promise<number>} Created invoice ID
     */
    async create(data) {
        const { bandId, issueDate, serviceDate, clientName, clientAddress, clientSiret, notes, items, paymentDelayText, latePenaltyText, recoveryFeeText } = data;

        // Validate required fields
        if (!clientName || !clientName.trim()) {
            throw new ValidationError('Client name is required');
        }
        if (!clientAddress || !clientAddress.trim()) {
            throw new ValidationError('Client address is required');
        }
        if (!issueDate) {
            throw new ValidationError('Issue date is required');
        }
        // Validate date format (YYYY-MM-DD)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
            throw new ValidationError('Issue date must be in YYYY-MM-DD format');
        }
        if (serviceDate && !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
            throw new ValidationError('Service date must be in YYYY-MM-DD format');
        }
        if (!items || items.length === 0) {
            throw new ValidationError('At least one line item is required');
        }

        // Calculate total from items
        let totalAmount = 0;
        for (const item of items) {
            if (!item.description || !item.description.trim()) {
                throw new ValidationError('Item description is required');
            }
            if (isNaN(item.quantity) || item.quantity <= 0) {
                throw new ValidationError('Item quantity must be greater than 0');
            }
            if (isNaN(item.unitPrice) || item.unitPrice < 0) {
                throw new ValidationError('Item unit price must be 0 or greater');
            }
            const itemTotal = parseFloat(item.quantity) * parseFloat(item.unitPrice);
            totalAmount += itemTotal;
        }

        // Generate invoice number
        const invoiceNumber = await generateInvoiceNumber();

        // Create invoice
        const invoiceId = await createInvoice({
            bandId,
            invoiceNumber,
            issueDate,
            serviceDate: serviceDate || null,
            clientName: clientName.trim(),
            clientAddress: clientAddress.trim(),
            clientSiret: clientSiret ? clientSiret.trim() : null,
            totalAmount,
            notes: notes || null,
            paymentDelayText: paymentDelayText || null,
            latePenaltyText: latePenaltyText || null,
            recoveryFeeText: recoveryFeeText || null
        });

        // Add items
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const itemTotal = parseFloat(item.quantity) * parseFloat(item.unitPrice);
            await addInvoiceItem({
                invoiceId,
                description: item.description.trim(),
                quantity: parseFloat(item.quantity),
                unitPrice: parseFloat(item.unitPrice),
                total: itemTotal,
                sortOrder: i
            });
        }

        return invoiceId;
    }

    /**
     * Update an invoice
     * @param {number} invoiceId - Invoice ID
     * @param {number} bandId - Band ID (for ownership verification, null for admin)
     * @param {Object} data - Update data
     * @param {boolean} isAdmin - Whether user is admin
     * @returns {Promise<void>}
     */
    async update(invoiceId, bandId, data, isAdmin = false) {
        const invoice = await getInvoiceById(invoiceId);
        if (!invoice) {
            throw new NotFoundError('Invoice');
        }

        // Verify ownership for non-admin users
        if (!isAdmin && invoice.band_id !== bandId) {
            throw new NotFoundError('Invoice');
        }

        // Non-admins can only edit draft invoices
        if (!isAdmin && invoice.status !== 'draft') {
            throw new ConflictError('Cannot edit non-draft invoice');
        }

        const { issueDate, serviceDate, clientName, clientAddress, clientSiret, notes, status, items, paymentDelayText, latePenaltyText, recoveryFeeText } = data;

        // Prepare updates
        const updates = {};
        if (issueDate) updates.issue_date = issueDate;
        if (serviceDate !== undefined) updates.service_date = serviceDate || null;
        if (clientName) updates.client_name = clientName.trim();
        if (clientAddress) updates.client_address = clientAddress.trim();
        if (clientSiret !== undefined) updates.client_siret = clientSiret ? clientSiret.trim() : null;
        if (notes !== undefined) updates.notes = notes || null;
        if (status && isAdmin) updates.status = status;
        if (paymentDelayText !== undefined) updates.payment_delay_text = paymentDelayText || null;
        if (latePenaltyText !== undefined) updates.late_penalty_text = latePenaltyText || null;
        if (recoveryFeeText !== undefined) updates.recovery_fee_text = recoveryFeeText || null;

        // Update items if provided
        if (items && items.length > 0) {
            // Recalculate total
            let totalAmount = 0;
            for (const item of items) {
                if (!item.description || !item.description.trim()) {
                    throw new ValidationError('Item description is required');
                }
                const itemTotal = parseFloat(item.quantity) * parseFloat(item.unitPrice);
                totalAmount += itemTotal;
            }
            updates.total_amount = totalAmount;

            // Delete existing items and add new ones
            await deleteInvoiceItems(invoiceId);
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const itemTotal = parseFloat(item.quantity) * parseFloat(item.unitPrice);
                await addInvoiceItem({
                    invoiceId,
                    description: item.description.trim(),
                    quantity: parseFloat(item.quantity),
                    unitPrice: parseFloat(item.unitPrice),
                    total: itemTotal,
                    sortOrder: i
                });
            }
        }

        if (Object.keys(updates).length > 0) {
            await updateInvoice(invoiceId, updates);
        }
    }

    /**
     * Update invoice status
     * @param {number} invoiceId - Invoice ID
     * @param {string} status - New status
     * @param {boolean} isAdmin - Whether user is admin
     * @returns {Promise<void>}
     */
    async updateStatus(invoiceId, status, isAdmin = false) {
        const validStatuses = ['draft', 'sent', 'paid', 'cancelled'];
        if (!validStatuses.includes(status)) {
            throw new ValidationError('Invalid status');
        }

        const invoice = await getInvoiceById(invoiceId);
        if (!invoice) {
            throw new NotFoundError('Invoice');
        }

        // Validate status transition
        this.validateStatusTransition(invoice.status, status, isAdmin);

        await updateInvoice(invoiceId, { status });
    }

    /**
     * Delete an invoice
     * @param {number} invoiceId - Invoice ID
     * @param {number} bandId - Band ID (for ownership verification, null for admin)
     * @param {boolean} isAdmin - Whether user is admin
     * @returns {Promise<void>}
     */
    async delete(invoiceId, bandId, isAdmin = false) {
        const invoice = await getInvoiceById(invoiceId);
        if (!invoice) {
            throw new NotFoundError('Invoice');
        }

        // Verify ownership for non-admin users
        if (!isAdmin && invoice.band_id !== bandId) {
            throw new NotFoundError('Invoice');
        }

        // Non-admins can only delete draft invoices
        if (!isAdmin && invoice.status !== 'draft') {
            throw new ConflictError('Cannot delete non-draft invoice');
        }

        await deleteInvoice(invoiceId);
    }

    /**
     * Prepare invoice data for PDF generation
     * @param {number} invoiceId - Invoice ID
     * @returns {Promise<Object>} Object with invoiceData and invoiceConfig
     */
    async prepareInvoiceForPdf(invoiceId) {
        const invoice = await this.getById(invoiceId);
        const config = await this.getInvoiceConfig();
        const band = await getBandById(invoice.band_id);

        return {
            invoiceData: {
                invoiceNumber: invoice.invoice_number,
                bandName: band ? band.name : '',
                issueDate: invoice.issue_date,
                serviceDate: invoice.service_date,
                clientName: invoice.client_name,
                clientAddress: invoice.client_address,
                clientSiret: invoice.client_siret,
                items: invoice.items,
                totalAmount: invoice.total_amount,
                paymentDelayText: invoice.payment_delay_text,
                latePenaltyText: invoice.late_penalty_text,
                recoveryFeeText: invoice.recovery_fee_text
            },
            invoiceConfig: config
        };
    }

    /**
     * Create a transaction from an invoice
     * @param {number} invoiceId - Invoice ID
     * @param {number} bandId - Band ID
     * @param {number} categoryId - Transaction category ID
     * @returns {Promise<number>} Created transaction ID
     */
    async createTransaction(invoiceId, bandId, categoryId) {
        const invoice = await this.getById(invoiceId);

        // Verify ownership
        if (invoice.band_id !== bandId) {
            throw new NotFoundError('Invoice');
        }

        // Check if transaction already linked
        if (invoice.transaction_id) {
            throw new ConflictError('Invoice already has a linked transaction');
        }

        // Create transaction
        const description = `Facture ${invoice.invoice_number} - ${invoice.client_name}`;
        const transactionDate = invoice.service_date || invoice.issue_date;

        const transactionId = await createTransaction(
            bandId,
            'income',
            invoice.total_amount,
            categoryId,
            description,
            transactionDate
        );

        // Link transaction to invoice
        await updateInvoice(invoiceId, { transaction_id: transactionId });

        return transactionId;
    }
}

module.exports = new InvoiceService();
