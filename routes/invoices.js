const express = require('express');
const router = express.Router();
const { requireBand } = require('../lib/middleware');
const {
    handleInvoiceList,
    handleInvoiceDetail,
    handleInvoiceNew,
    handleInvoiceCreate,
    handleInvoiceEditForm,
    handleInvoiceEdit,
    handleInvoiceDelete,
    handleInvoiceStatusUpdate,
    handleCreateTransaction
} = require('../controllers/invoice-handlers');

/**
 * GET /invoices
 * List band's invoices
 */
router.get('/invoices', requireBand, handleInvoiceList);

/**
 * GET /invoices/new
 * Display new invoice form
 */
router.get('/invoices/new', requireBand, handleInvoiceNew);

/**
 * POST /invoices
 * Create new invoice
 */
router.post('/invoices', requireBand, handleInvoiceCreate);

/**
 * GET /invoices/:id
 * Display invoice detail
 */
router.get('/invoices/:id', requireBand, handleInvoiceDetail);

/**
 * GET /invoices/:id/edit
 * Display edit invoice form
 */
router.get('/invoices/:id/edit', requireBand, handleInvoiceEditForm);

/**
 * POST /invoices/:id/edit
 * Update invoice
 */
router.post('/invoices/:id/edit', requireBand, handleInvoiceEdit);

/**
 * POST /invoices/:id/delete
 * Delete invoice
 */
router.post('/invoices/:id/delete', requireBand, handleInvoiceDelete);

/**
 * POST /invoices/:id/status
 * Update invoice status
 */
router.post('/invoices/:id/status', requireBand, handleInvoiceStatusUpdate);

/**
 * POST /invoices/:id/create-transaction
 * Create transaction from invoice
 */
router.post('/invoices/:id/create-transaction', requireBand, handleCreateTransaction);

module.exports = router;
