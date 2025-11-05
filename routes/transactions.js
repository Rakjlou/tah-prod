const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { requireBand } = require('../lib/middleware');
const {
    getBandByUserId,
    getTransactionsByBand,
    getBalanceForBand,
    getAllCategories,
    createTransaction,
    getTransactionById,
    updateTransaction,
    deleteTransaction
} = require('../lib/db');
const googleAuth = require('../lib/google-auth');
const { syncTransactionsToSheet } = require('../lib/google-sheets');
const {
    getTransactionsFolderId,
    createTransactionFolder,
    uploadTransactionDocument,
    deleteTransactionFolder
} = require('../lib/google-drive');
const { addTransactionDocument } = require('../lib/db');
const {
    handleTransactionDetail,
    handleTransactionEdit,
    handleCreateFolder,
    handleUploadDocuments,
    handleDeleteDocument
} = require('../controllers/transaction-handlers');

/**
 * GET /transactions
 * Display band transactions list
 */
router.get('/transactions', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const statusFilter = req.query.status || null;
        const transactions = await getTransactionsByBand(band.id, statusFilter);
        const balance = await getBalanceForBand(band.id);
        const pendingCount = await getTransactionsByBand(band.id, 'pending');

        res.render('transactions', {
            band,
            transactions,
            balance,
            pendingCount: pendingCount.length,
            statusFilter
        });
    } catch (error) {
        console.error('Error loading transactions:', error);
        res.render('transactions', {
            error: 'Failed to load transactions',
            transactions: [],
            balance: 0,
            pendingCount: 0,
            statusFilter: null
        });
    }
});

/**
 * GET /transactions/new
 * Display new transaction form
 */
router.get('/transactions/new', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const categories = await getAllCategories();
        res.render('transaction-new', { band, categories });
    } catch (error) {
        console.error('Error loading new transaction form:', error);
        res.status(500).send('Failed to load form');
    }
});

/**
 * POST /transactions
 * Create a new transaction
 */
router.post('/transactions', requireBand, upload.array('documents', 10), async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const { type, amount, category_id, description } = req.body;

        // Create transaction
        const transactionId = await createTransaction(band.id, type, parseFloat(amount), parseInt(category_id), description);

        // Handle document uploads if any
        if (req.files && req.files.length > 0) {
            const authenticatedClient = await googleAuth.getAuthenticatedClient();
            const transactionsFolderId = await getTransactionsFolderId(authenticatedClient, band.folder_id);
            const folderId = await createTransactionFolder(authenticatedClient, transactionsFolderId, transactionId, description);

            // Upload each file
            for (const file of req.files) {
                const driveFileId = await uploadTransactionDocument(authenticatedClient, folderId, file.buffer, file.originalname);
                await addTransactionDocument(transactionId, driveFileId, file.originalname);
            }

            // Update transaction with folder ID
            await updateTransaction(transactionId, { drive_folder_id: folderId });
        }

        // Sync to Google Sheets
        const transactions = await getTransactionsByBand(band.id);
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        res.redirect('/transactions?success=' + encodeURIComponent('Transaction created successfully'));
    } catch (error) {
        console.error('Error creating transaction:', error);
        res.redirect('/transactions/new?error=' + encodeURIComponent('Failed to create transaction: ' + error.message));
    }
});

/**
 * GET /transactions/:id
 * Display transaction detail
 */
router.get('/transactions/:id', requireBand, handleTransactionDetail);

/**
 * GET /transactions/:id/edit
 * Display transaction edit form
 */
router.get('/transactions/:id/edit', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const transaction = await getTransactionById(req.params.id);
        if (!transaction || transaction.band_id !== band.id) {
            return res.status(404).send('Transaction not found');
        }

        if (transaction.status !== 'pending') {
            return res.redirect('/transactions?error=' + encodeURIComponent('Cannot edit validated transaction'));
        }

        const categories = await getAllCategories();
        res.render('transaction-edit', { band, transaction, categories });
    } catch (error) {
        console.error('Error loading transaction edit form:', error);
        res.status(500).send('Failed to load form');
    }
});

/**
 * POST /transactions/:id/edit
 * Update a transaction
 */
router.post('/transactions/:id/edit', requireBand, handleTransactionEdit);

/**
 * POST /transactions/:id/delete
 * Delete a transaction
 */
router.post('/transactions/:id/delete', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const transaction = await getTransactionById(req.params.id);
        if (!transaction || transaction.band_id !== band.id) {
            return res.status(404).send('Transaction not found');
        }

        if (transaction.status !== 'pending') {
            return res.redirect('/transactions?error=' + encodeURIComponent('Cannot delete validated transaction'));
        }

        // Delete folder from Drive if exists
        if (transaction.drive_folder_id) {
            const authenticatedClient = await googleAuth.getAuthenticatedClient();
            await deleteTransactionFolder(authenticatedClient, transaction.drive_folder_id);
        }

        await deleteTransaction(req.params.id);

        // Sync to Google Sheets
        const transactions = await getTransactionsByBand(band.id);
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        res.redirect('/transactions?success=' + encodeURIComponent('Transaction deleted successfully'));
    } catch (error) {
        console.error('Error deleting transaction:', error);
        res.redirect('/transactions?error=' + encodeURIComponent('Failed to delete transaction'));
    }
});

/**
 * POST /transactions/:id/create-folder
 * Create documents folder for transaction
 */
router.post('/transactions/:id/create-folder', requireBand, handleCreateFolder);

/**
 * POST /transactions/:id/documents
 * Upload documents to transaction
 */
router.post('/transactions/:id/documents', requireBand, upload.array('documents', 10), handleUploadDocuments);

/**
 * POST /transactions/:id/documents/:docId/delete
 * Delete a document from transaction
 */
router.post('/transactions/:id/documents/:docId/delete', requireBand, handleDeleteDocument);

module.exports = router;
