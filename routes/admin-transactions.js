const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { requireAdmin } = require('../lib/middleware');
const {
    getAllTransactionsWithBands,
    getAllBands,
    getTransactionById,
    validateTransaction,
    deleteTransaction,
    getBandById,
    getTransactionsByBand
} = require('../lib/db');
const googleAuth = require('../lib/google-auth');
const { syncTransactionsToSheet } = require('../lib/google-sheets');
const { deleteTransactionFolder } = require('../lib/google-drive');
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
    try {
        const bandFilter = req.query.band ? parseInt(req.query.band) : null;
        const statusFilter = req.query.status !== undefined ? req.query.status : 'pending';

        const transactions = await getAllTransactionsWithBands(bandFilter, statusFilter);
        const bands = await getAllBands();
        const organizationBandId = await configService.getOrganizationBandId();

        res.render('admin-transactions', {
            transactions,
            bands,
            organizationBandId,
            bandFilter,
            statusFilter
        });
    } catch (error) {
        console.error('Error loading admin transactions:', error);
        res.render('admin-transactions', {
            error: 'Failed to load transactions',
            transactions: [],
            bands: [],
            organizationBandId: null,
            bandFilter: null,
            statusFilter: null
        });
    }
});

/**
 * GET /admin/reconciliation
 * Display reconciliation dashboard
 */
router.get('/admin/reconciliation', requireAdmin, async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Error loading reconciliation dashboard:', error);
        res.render('admin-reconciliation', {
            error: 'Failed to load reconciliation data',
            discrepancies: [],
            bands: [],
            bandFilter: null,
            statusFilter: null,
            stats: {
                total: 0,
                totalDifference: '0.00',
                pending: 0,
                validated: 0
            }
        });
    }
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
        const transaction = await getTransactionById(req.params.id);

        if (!transaction) {
            return res.redirect('/admin/transactions?error=' + encodeURIComponent('Transaction not found'));
        }

        if (transaction.status === 'validated') {
            return res.redirect('/admin/transactions?error=' + encodeURIComponent('Transaction already validated'));
        }

        await validateTransaction(req.params.id, req.session.user.id, transaction_date);

        // Sync to Google Sheets
        const band = await getBandById(transaction.band_id);
        if (!band) {
            return res.redirect('/admin/transactions?error=' + encodeURIComponent('Associated band not found'));
        }
        const transactions = await getTransactionsByBand(transaction.band_id);
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        res.redirect('/admin/transactions?success=' + encodeURIComponent('Transaction validated successfully'));
    } catch (error) {
        console.error('Error validating transaction:', error);
        res.redirect('/admin/transactions?error=' + encodeURIComponent('Failed to validate transaction'));
    }
});

/**
 * POST /admin/transactions/:id/delete
 * Delete a transaction
 */
router.post('/admin/transactions/:id/delete', requireAdmin, async (req, res) => {
    try {
        const transaction = await getTransactionById(req.params.id);

        if (!transaction) {
            return res.redirect('/admin/transactions?error=' + encodeURIComponent('Transaction not found'));
        }

        // Delete folder from Drive if exists
        if (transaction.drive_folder_id) {
            const authenticatedClient = await googleAuth.getAuthenticatedClient();
            await deleteTransactionFolder(authenticatedClient, transaction.drive_folder_id);
        }

        await deleteTransaction(req.params.id);

        // Sync to Google Sheets
        const band = await getBandById(transaction.band_id);
        if (!band) {
            return res.redirect('/admin/transactions?error=' + encodeURIComponent('Associated band not found'));
        }
        const transactions = await getTransactionsByBand(transaction.band_id);
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        res.redirect('/admin/transactions?success=' + encodeURIComponent('Transaction deleted successfully'));
    } catch (error) {
        console.error('Error deleting transaction:', error);
        res.redirect('/admin/transactions?error=' + encodeURIComponent('Failed to delete transaction'));
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
