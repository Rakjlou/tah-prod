const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { requireAdmin } = require('../lib/middleware');
const { getAllBands } = require('../lib/db');
const transactionService = require('../services/transaction-service');
const bandService = require('../services/band-service');
const configService = require('../lib/config-service');
const qontoValidation = require('../lib/qonto-validation');
const {
    handleTransactionDetail,
    handleTransactionEdit,
    handleCreateFolder,
    handleUploadDocuments,
    handleDeleteDocument
} = require('../controllers/transaction-handlers');

/**
 * GET /admin/transactions
 * Display admin transactions list
 */
router.get('/admin/transactions', requireAdmin, async (req, res) => {
    const bandFilter = req.query.band ? parseInt(req.query.band) : null;
    const statusFilter = req.query.status !== undefined ? req.query.status : 'pending';

    const transactions = await transactionService.getAllTransactions(bandFilter, statusFilter);
    const bands = await getAllBands();
    const organizationBandId = await configService.getOrganizationBandId();

    res.render('admin-transactions', {
        transactions,
        bands,
        organizationBandId,
        bandFilter,
        statusFilter
    });
});

/**
 * GET /admin/reconciliation
 * Display reconciliation dashboard
 */
router.get('/admin/reconciliation', requireAdmin, async (req, res) => {
    const bandFilter = req.query.band ? parseInt(req.query.band) : null;
    const statusFilter = req.query.status || null;

    // Get all discrepancies
    let discrepancies = await qontoValidation.getDiscrepancies();

    // Apply filters
    if (bandFilter) {
        discrepancies = discrepancies.filter(d => d.transaction.band_id === bandFilter);
    }

    if (statusFilter) {
        discrepancies = discrepancies.filter(d => d.transaction.status === statusFilter);
    }

    // Get bands for filter dropdown
    const bands = await getAllBands();

    // Calculate summary stats
    const totalDiscrepancies = discrepancies.length;
    const totalDifference = discrepancies.reduce((sum, d) => sum + Math.abs(d.difference), 0);
    const byStatus = {
        pending: discrepancies.filter(d => d.transaction.status === 'pending').length,
        validated: discrepancies.filter(d => d.transaction.status === 'validated').length
    };

    res.render('admin-reconciliation', {
        discrepancies,
        bands,
        bandFilter,
        statusFilter,
        stats: {
            total: totalDiscrepancies,
            totalDifference: totalDifference.toFixed(2),
            pending: byStatus.pending,
            validated: byStatus.validated
        }
    });
});

/**
 * GET /admin/transactions/:id
 * Display transaction detail
 */
router.get('/admin/transactions/:id', requireAdmin, handleTransactionDetail);

/**
 * POST /admin/transactions/:id/edit
 * Update a transaction
 */
router.post('/admin/transactions/:id/edit', requireAdmin, handleTransactionEdit);

/**
 * POST /admin/transactions/:id/validate
 * Validate a transaction
 */
router.post('/admin/transactions/:id/validate', requireAdmin, async (req, res) => {
    try {
        const { transaction_date } = req.body;

        await transactionService.validate(
            req.params.id,
            req.session.user.id,
            transaction_date
        );

        req.flash.success('Transaction validated successfully');
        res.redirect('/admin/transactions');
    } catch (error) {
        console.error('Error validating transaction:', error);
        req.flash.error(error.userMessage || 'Failed to validate transaction');
        res.redirect('/admin/transactions');
    }
});

/**
 * POST /admin/transactions/:id/delete
 * Delete a transaction
 */
router.post('/admin/transactions/:id/delete', requireAdmin, async (req, res) => {
    try {
        const transaction = await transactionService.getById(req.params.id);
        const band = await bandService.getBandById(transaction.band_id);

        await transactionService.delete(
            req.params.id,
            transaction.band_id,
            band.accounting_spreadsheet_id,
            true // isAdmin = true, can delete validated transactions
        );

        req.flash.success('Transaction deleted successfully');
        res.redirect('/admin/transactions');
    } catch (error) {
        console.error('Error deleting transaction:', error);
        req.flash.error(error.userMessage || 'Failed to delete transaction');
        res.redirect('/admin/transactions');
    }
});

/**
 * POST /admin/transactions/:id/create-folder
 * Create documents folder for transaction
 */
router.post('/admin/transactions/:id/create-folder', requireAdmin, handleCreateFolder);

/**
 * POST /admin/transactions/:id/documents
 * Upload documents to transaction
 */
router.post('/admin/transactions/:id/documents', requireAdmin, upload.array('documents', 10), handleUploadDocuments);

/**
 * POST /admin/transactions/:id/documents/:docId/delete
 * Delete a document from transaction
 */
router.post('/admin/transactions/:id/documents/:docId/delete', requireAdmin, handleDeleteDocument);

module.exports = router;
