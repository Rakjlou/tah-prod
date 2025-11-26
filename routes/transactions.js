const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { requireBand } = require('../lib/middleware');
const transactionService = require('../services/transaction-service');
const bandService = require('../services/band-service');
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
    const band = await bandService.getBandByUser(req.session.user.id);
    const statusFilter = req.query.status || null;
    const { transactions, balance, pendingCount } = await transactionService.getTransactionsForBand(band.id, statusFilter);

    res.render('transactions', {
        band,
        transactions,
        balance,
        pendingCount,
        statusFilter
    });
});

/**
 * GET /transactions/new
 * Display new transaction form
 */
router.get('/transactions/new', requireBand, async (req, res) => {
    const band = await bandService.getBandByUser(req.session.user.id);
    const categories = await bandService.getCategories();
    res.render('transaction-new', { band, categories });
});

/**
 * POST /transactions
 * Create a new transaction
 */
router.post('/transactions', requireBand, upload.array('documents', 10), async (req, res) => {
    try {
        const band = await bandService.getBandByUser(req.session.user.id);
        const { type, amount, category_id, description, transaction_date } = req.body;

        await transactionService.create({
            bandId: band.id,
            type,
            amount,
            categoryId: category_id,
            description,
            bandFolderId: band.folder_id,
            spreadsheetId: band.accounting_spreadsheet_id,
            files: req.files,
            transactionDate: transaction_date || null
        });

        req.flash.success('Transaction created successfully');
        res.redirect('/transactions');
    } catch (error) {
        console.error('Error creating transaction:', error);
        req.flash.error(error.userMessage || 'Failed to create transaction');
        res.redirect('/transactions');
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
    const band = await bandService.getBandByUser(req.session.user.id);
    const transaction = await transactionService.getById(req.params.id);

    bandService.verifyBandOwnership(band.id, transaction);

    if (transaction.status !== 'pending') {
        req.flash.error('Cannot edit validated transaction');
        return res.redirect('/transactions');
    }

    const categories = await bandService.getCategories();
    res.render('transaction-edit', { band, transaction, categories });
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
        const band = await bandService.getBandByUser(req.session.user.id);

        await transactionService.delete(
            req.params.id,
            band.id,
            band.accounting_spreadsheet_id
        );

        req.flash.success('Transaction deleted successfully');
        res.redirect('/transactions');
    } catch (error) {
        console.error('Error deleting transaction:', error);
        req.flash.error(error.userMessage || 'Failed to delete transaction');
        res.redirect('/transactions');
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
