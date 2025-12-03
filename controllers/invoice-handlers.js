const { ROLES, hasRole } = require('../lib/roles');
const {
    getBandById,
    getBandByUserId,
    getAllBands,
    getAllCategories,
    getTransactionById,
    updateTransaction,
    addTransactionDocument,
    getTransactionsByBand
} = require('../lib/db');
const invoiceService = require('../services/invoice-service');
const googleAuth = require('../lib/google-auth');
const { getTransactionsFolderId, createTransactionFolder, uploadTransactionDocument } = require('../lib/google-drive');
const { syncTransactionsToSheet } = require('../lib/google-sheets');
const { generateInvoicePDF } = require('../lib/invoice-pdf');

/**
 * Parse invoice items from form body
 * @param {Object} body - Request body
 * @returns {Array} Parsed items array
 */
function parseInvoiceItems(body) {
    const items = [];
    const descriptions = Array.isArray(body.item_description) ? body.item_description : [body.item_description];
    const quantities = Array.isArray(body.item_quantity) ? body.item_quantity : [body.item_quantity];
    const unitPrices = Array.isArray(body.item_unit_price) ? body.item_unit_price : [body.item_unit_price];

    for (let i = 0; i < descriptions.length; i++) {
        if (descriptions[i] && descriptions[i].trim()) {
            items.push({
                description: descriptions[i],
                quantity: parseFloat(quantities[i]) || 1,
                unitPrice: parseFloat(unitPrices[i]) || 0
            });
        }
    }
    return items;
}

/**
 * Shared handler for invoice list view (both bands and admins)
 */
async function handleInvoiceList(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        const statusFilter = req.query.status || null;
        const bandFilter = req.query.band || null;

        let invoices;
        let bands = null;
        let band = null;

        if (isAdmin) {
            invoices = await invoiceService.getAllInvoices(bandFilter, statusFilter);
            bands = await getAllBands();
        } else {
            band = await getBandByUserId(req.session.user.id);
            if (!band) {
                req.flash.error('Band not found');
                return res.redirect('/');
            }
            invoices = await invoiceService.getInvoicesForBand(band.id, statusFilter);
        }

        const urlPrefix = isAdmin ? '/admin/invoices' : '/invoices';

        res.render('invoices', {
            invoices,
            bands,
            band,
            urlPrefix,
            isAdmin,
            statusFilter,
            bandFilter
        });
    } catch (error) {
        console.error('Error loading invoices:', error);
        req.flash.error('Failed to load invoices');
        res.redirect('/tools');
    }
}

/**
 * Shared handler for invoice detail view (both bands and admins)
 */
async function handleInvoiceDetail(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        const invoice = await invoiceService.getById(req.params.id);

        if (!isAdmin) {
            const band = await getBandByUserId(req.session.user.id);
            if (!band || invoice.band_id !== band.id) {
                req.flash.error('Access denied');
                return res.redirect('/invoices');
            }
        }

        const band = await getBandById(invoice.band_id);
        const invoiceConfig = await invoiceService.getInvoiceConfig();
        const categories = await getAllCategories();

        const urlPrefix = isAdmin ? '/admin/invoices' : '/invoices';

        res.render('invoice-detail', {
            invoice,
            band,
            invoiceConfig,
            categories,
            urlPrefix,
            isAdmin
        });
    } catch (error) {
        console.error('Error loading invoice details:', error);
        req.flash.error('Failed to load invoice details');
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect(isAdmin ? '/admin/invoices' : '/invoices');
    }
}

/**
 * Shared handler for new invoice form (both bands and admins)
 */
async function handleInvoiceNew(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        let band = null;
        let bands = null;

        if (isAdmin) {
            bands = await getAllBands();
        } else {
            band = await getBandByUserId(req.session.user.id);
            if (!band) {
                req.flash.error('Band not found');
                return res.redirect('/');
            }
        }

        const invoiceConfig = await invoiceService.getInvoiceConfig();
        const urlPrefix = isAdmin ? '/admin/invoices' : '/invoices';

        res.render('invoice-form', {
            invoice: null,
            band,
            bands,
            invoiceConfig,
            urlPrefix,
            isAdmin,
            isEdit: false
        });
    } catch (error) {
        console.error('Error loading invoice form:', error);
        req.flash.error('Failed to load invoice form');
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect(isAdmin ? '/admin/invoices' : '/invoices');
    }
}

/**
 * Shared handler for create invoice (both bands and admins)
 */
async function handleInvoiceCreate(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        let bandId;

        if (isAdmin) {
            bandId = parseInt(req.body.band_id);
            if (!bandId) {
                req.flash.error('Please select a band');
                return res.redirect('/admin/invoices/new');
            }
        } else {
            const band = await getBandByUserId(req.session.user.id);
            if (!band) {
                req.flash.error('Band not found');
                return res.redirect('/');
            }
            bandId = band.id;
        }

        const items = parseInvoiceItems(req.body);

        const invoiceId = await invoiceService.create({
            bandId,
            issueDate: req.body.issue_date,
            serviceDate: req.body.service_date || null,
            clientName: req.body.client_name,
            clientAddress: req.body.client_address,
            clientSiret: req.body.client_siret || null,
            notes: req.body.notes || null,
            items,
            paymentDelayText: req.body.enable_payment_delay ? req.body.payment_delay_text : null,
            latePenaltyText: req.body.enable_late_penalty ? req.body.late_penalty_text : null,
            recoveryFeeText: req.body.enable_recovery_fee ? req.body.recovery_fee_text : null
        });

        req.flash.success('Invoice created successfully');
        res.redirect((isAdmin ? '/admin/invoices/' : '/invoices/') + invoiceId);
    } catch (error) {
        console.error('Error creating invoice:', error);
        req.flash.error(error.userMessage || 'Failed to create invoice');
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect(isAdmin ? '/admin/invoices/new' : '/invoices/new');
    }
}

/**
 * Shared handler for edit invoice form (both bands and admins)
 */
async function handleInvoiceEditForm(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        const invoice = await invoiceService.getById(req.params.id);

        if (!isAdmin) {
            const band = await getBandByUserId(req.session.user.id);
            if (!band || invoice.band_id !== band.id) {
                req.flash.error('Access denied');
                return res.redirect('/invoices');
            }
            if (invoice.status !== 'draft') {
                req.flash.error('Cannot edit non-draft invoice');
                return res.redirect('/invoices/' + req.params.id);
            }
        }

        const band = await getBandById(invoice.band_id);
        const bands = isAdmin ? await getAllBands() : null;
        const invoiceConfig = await invoiceService.getInvoiceConfig();
        const urlPrefix = isAdmin ? '/admin/invoices' : '/invoices';

        res.render('invoice-form', {
            invoice,
            band,
            bands,
            invoiceConfig,
            urlPrefix,
            isAdmin,
            isEdit: true
        });
    } catch (error) {
        console.error('Error loading invoice edit form:', error);
        req.flash.error('Failed to load invoice');
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect(isAdmin ? '/admin/invoices' : '/invoices');
    }
}

/**
 * Shared handler for update invoice (both bands and admins)
 */
async function handleInvoiceEdit(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        const invoice = await invoiceService.getById(req.params.id);

        let bandId = invoice.band_id;
        if (!isAdmin) {
            const band = await getBandByUserId(req.session.user.id);
            if (!band || invoice.band_id !== band.id) {
                req.flash.error('Access denied');
                return res.redirect('/invoices');
            }
            bandId = band.id;
        }

        const items = parseInvoiceItems(req.body);

        await invoiceService.update(req.params.id, bandId, {
            issueDate: req.body.issue_date,
            serviceDate: req.body.service_date || null,
            clientName: req.body.client_name,
            clientAddress: req.body.client_address,
            clientSiret: req.body.client_siret || null,
            notes: req.body.notes || null,
            status: req.body.status,
            items,
            paymentDelayText: req.body.enable_payment_delay ? req.body.payment_delay_text : null,
            latePenaltyText: req.body.enable_late_penalty ? req.body.late_penalty_text : null,
            recoveryFeeText: req.body.enable_recovery_fee ? req.body.recovery_fee_text : null
        }, isAdmin);

        req.flash.success('Invoice updated successfully');
        res.redirect((isAdmin ? '/admin/invoices/' : '/invoices/') + req.params.id);
    } catch (error) {
        console.error('Error updating invoice:', error);
        req.flash.error(error.userMessage || 'Failed to update invoice');
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect((isAdmin ? '/admin/invoices/' : '/invoices/') + req.params.id);
    }
}

/**
 * Shared handler for delete invoice (both bands and admins)
 */
async function handleInvoiceDelete(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);

        let bandId = null;
        if (!isAdmin) {
            const band = await getBandByUserId(req.session.user.id);
            if (!band) {
                req.flash.error('Band not found');
                return res.redirect('/invoices');
            }
            bandId = band.id;
        }

        await invoiceService.delete(req.params.id, bandId, isAdmin);

        req.flash.success('Invoice deleted successfully');
        res.redirect(isAdmin ? '/admin/invoices' : '/invoices');
    } catch (error) {
        console.error('Error deleting invoice:', error);
        req.flash.error(error.userMessage || 'Failed to delete invoice');
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect(isAdmin ? '/admin/invoices' : '/invoices');
    }
}

/**
 * Shared handler for update invoice status (both bands and admins)
 */
async function handleInvoiceStatusUpdate(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        const { status } = req.body;

        // Verify ownership for band users
        if (!isAdmin) {
            const band = await getBandByUserId(req.session.user.id);
            const invoice = await invoiceService.getById(req.params.id);
            if (!band || invoice.band_id !== band.id) {
                req.flash.error('Access denied');
                return res.redirect('/invoices');
            }
        }

        // Service handles status transition validation with admin override
        await invoiceService.updateStatus(req.params.id, status, isAdmin);

        req.flash.success('Invoice status updated');
        res.redirect((isAdmin ? '/admin/invoices/' : '/invoices/') + req.params.id);
    } catch (error) {
        console.error('Error updating invoice status:', error);
        req.flash.error(error.userMessage || 'Failed to update status');
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect((isAdmin ? '/admin/invoices/' : '/invoices/') + req.params.id);
    }
}

/**
 * Handler for creating transaction from invoice
 */
async function handleCreateTransaction(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        const invoice = await invoiceService.getById(req.params.id);

        let bandId;
        if (isAdmin) {
            bandId = invoice.band_id;
        } else {
            const band = await getBandByUserId(req.session.user.id);
            if (!band || invoice.band_id !== band.id) {
                req.flash.error('Access denied');
                return res.redirect('/invoices');
            }
            bandId = band.id;
        }

        const categoryId = parseInt(req.body.category_id);
        if (!categoryId) {
            req.flash.error('Please select a category');
            return res.redirect((isAdmin ? '/admin/invoices/' : '/invoices/') + req.params.id);
        }

        const transactionId = await invoiceService.createTransaction(req.params.id, bandId, categoryId);

        // Auto-upload invoice PDF to transaction's document folder
        try {
            const band = await getBandById(bandId);
            const authenticatedClient = await googleAuth.getAuthenticatedClient();

            // Get or create transaction folder
            const transaction = await getTransactionById(transactionId);
            let folderId = transaction.drive_folder_id;
            if (!folderId) {
                const transactionsFolderId = await getTransactionsFolderId(authenticatedClient, band.folder_id);
                folderId = await createTransactionFolder(authenticatedClient, transactionsFolderId, transactionId, transaction.description);
                await updateTransaction(transactionId, { drive_folder_id: folderId });
            }

            // Generate and upload invoice PDF
            const { invoiceData, invoiceConfig } = await invoiceService.prepareInvoiceForPdf(req.params.id);
            const pdfBuffer = generateInvoicePDF(invoiceData, invoiceConfig);
            const filename = `Facture_${invoice.invoice_number.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
            const driveFileId = await uploadTransactionDocument(authenticatedClient, folderId, pdfBuffer, filename);
            await addTransactionDocument(transactionId, driveFileId, filename);

            // Sync to sheet
            const transactions = await getTransactionsByBand(bandId);
            await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);
        } catch (pdfError) {
            // Log error but don't fail the transaction creation
            console.error('Error uploading invoice PDF:', pdfError);
        }

        req.flash.success('Transaction created from invoice');
        res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + transactionId);
    } catch (error) {
        console.error('Error creating transaction from invoice:', error);
        req.flash.error(error.userMessage || 'Failed to create transaction');
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect((isAdmin ? '/admin/invoices/' : '/invoices/') + req.params.id);
    }
}

module.exports = {
    handleInvoiceList,
    handleInvoiceDetail,
    handleInvoiceNew,
    handleInvoiceCreate,
    handleInvoiceEditForm,
    handleInvoiceEdit,
    handleInvoiceDelete,
    handleInvoiceStatusUpdate,
    handleCreateTransaction
};
