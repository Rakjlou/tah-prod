const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../lib/middleware');
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
 * GET /admin/invoices
 * List all invoices (admin view)
 */
router.get('/admin/invoices', requireAdmin, handleInvoiceList);

/**
 * GET /admin/invoices/new
 * Display new invoice form
 */
router.get('/admin/invoices/new', requireAdmin, handleInvoiceNew);

/**
 * POST /admin/invoices
 * Create new invoice
 */
router.post('/admin/invoices', requireAdmin, handleInvoiceCreate);

/**
 * GET /admin/invoices/:id
 * Display invoice detail
 */
router.get('/admin/invoices/:id', requireAdmin, handleInvoiceDetail);

/**
 * GET /admin/invoices/:id/edit
 * Display edit invoice form
 */
router.get('/admin/invoices/:id/edit', requireAdmin, handleInvoiceEditForm);

/**
 * POST /admin/invoices/:id/edit
 * Update invoice
 */
router.post('/admin/invoices/:id/edit', requireAdmin, handleInvoiceEdit);

/**
 * POST /admin/invoices/:id/delete
 * Delete invoice
 */
router.post('/admin/invoices/:id/delete', requireAdmin, handleInvoiceDelete);

/**
 * POST /admin/invoices/:id/status
 * Update invoice status
 */
router.post('/admin/invoices/:id/status', requireAdmin, handleInvoiceStatusUpdate);

/**
 * POST /admin/invoices/:id/create-transaction
 * Create transaction from invoice
 */
router.post('/admin/invoices/:id/create-transaction', requireAdmin, handleCreateTransaction);

module.exports = router;
