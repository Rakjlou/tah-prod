const {
    getTransactionsByBand,
    getBalanceForBand,
    createTransaction,
    getTransactionById,
    updateTransaction,
    deleteTransaction,
    validateTransaction,
    getAllTransactionsWithBands
} = require('../lib/db');
const { NotFoundError, ValidationError, ConflictError } = require('../lib/errors');
const documentService = require('./document-service');
const syncService = require('./sync-service');

/**
 * Transaction Service
 * Handles all transaction-related business logic
 */
class TransactionService {
    /**
     * Get transactions for a band with filters
     * @param {number} bandId - Band ID
     * @param {string|null} statusFilter - Status filter (pending, validated, null)
     * @returns {Promise<Object>} Transactions data including balance and pending count
     */
    async getTransactionsForBand(bandId, statusFilter = null) {
        const transactions = await getTransactionsByBand(bandId, statusFilter);
        const balance = await getBalanceForBand(bandId);
        const pendingTransactions = await getTransactionsByBand(bandId, 'pending');

        return {
            transactions,
            balance,
            pendingCount: pendingTransactions.length
        };
    }

    /**
     * Get all transactions with bands (admin view)
     * @param {number|null} bandFilter - Band ID filter
     * @param {string|null} statusFilter - Status filter
     * @returns {Promise<Array>} List of transactions with band info
     */
    async getAllTransactions(bandFilter = null, statusFilter = 'pending') {
        return await getAllTransactionsWithBands(bandFilter, statusFilter);
    }

    /**
     * Get transaction by ID
     * @param {number} transactionId - Transaction ID
     * @returns {Promise<Object>} Transaction object
     * @throws {NotFoundError} If transaction not found
     */
    async getById(transactionId) {
        const transaction = await getTransactionById(transactionId);
        if (!transaction) {
            throw new NotFoundError('Transaction');
        }
        return transaction;
    }

    /**
     * Create a new transaction
     * @param {Object} data - Transaction data
     * @param {number} data.bandId - Band ID
     * @param {string} data.type - Transaction type (recette/depense)
     * @param {number} data.amount - Transaction amount
     * @param {number} data.categoryId - Category ID
     * @param {string} data.description - Transaction description
     * @param {string} data.bandFolderId - Band's folder ID in Google Drive
     * @param {string} data.spreadsheetId - Band's spreadsheet ID
     * @param {Array} data.files - Uploaded files (optional)
     * @returns {Promise<number>} Created transaction ID
     */
    async create(data) {
        const { bandId, type, amount, categoryId, description, bandFolderId, spreadsheetId, files } = data;

        // Validate input
        if (!['income', 'expense'].includes(type)) {
            throw new ValidationError('Invalid transaction type');
        }

        if (isNaN(amount) || amount <= 0) {
            throw new ValidationError('Invalid amount');
        }

        // Create transaction
        const transactionId = await createTransaction(bandId, type, parseFloat(amount), parseInt(categoryId), description);

        // Handle document uploads if any
        if (files && files.length > 0) {
            const folderId = await documentService.createFolderAndUploadDocuments(
                transactionId,
                description,
                bandFolderId,
                files
            );
            await updateTransaction(transactionId, { drive_folder_id: folderId });
        }

        // Sync to Google Sheets
        await syncService.syncBandTransactions(bandId, spreadsheetId);

        return transactionId;
    }

    /**
     * Update a transaction
     * @param {number} transactionId - Transaction ID
     * @param {number} bandId - Band ID (for ownership verification)
     * @param {Object} data - Update data
     * @param {string} data.spreadsheetId - Band's spreadsheet ID
     * @returns {Promise<void>}
     */
    async update(transactionId, bandId, data) {
        const transaction = await this.getById(transactionId);

        // Verify ownership
        if (transaction.band_id !== bandId) {
            throw new NotFoundError('Transaction');
        }

        // Can only edit pending transactions
        if (transaction.status !== 'pending') {
            throw new ConflictError(
                'Cannot edit validated transaction'
            );
        }

        const { type, amount, categoryId, description, spreadsheetId } = data;

        // Prepare update data
        const updates = {};
        if (type) updates.type = type;
        if (amount) updates.amount = parseFloat(amount);
        if (categoryId) updates.category_id = parseInt(categoryId);
        if (description !== undefined) updates.description = description;

        await updateTransaction(transactionId, updates);

        // Sync to Google Sheets
        if (spreadsheetId) {
            await syncService.syncBandTransactions(bandId, spreadsheetId);
        }
    }

    /**
     * Delete a transaction
     * @param {number} transactionId - Transaction ID
     * @param {number} bandId - Band ID (for ownership verification)
     * @param {string} spreadsheetId - Band's spreadsheet ID
     * @param {boolean} isAdmin - Whether the user is an admin (admins can delete validated transactions)
     * @returns {Promise<void>}
     */
    async delete(transactionId, bandId, spreadsheetId, isAdmin = false) {
        const transaction = await this.getById(transactionId);

        // Verify ownership for non-admin users
        if (!isAdmin && transaction.band_id !== bandId) {
            throw new NotFoundError('Transaction');
        }

        // Non-admins can only delete pending transactions
        if (!isAdmin && transaction.status !== 'pending') {
            throw new ConflictError(
                'Cannot delete validated transaction'
            );
        }

        // Delete folder from Drive if exists
        await documentService.deleteFolder(transaction.drive_folder_id);

        // Delete transaction
        await deleteTransaction(transactionId);

        // Sync to Google Sheets
        await syncService.syncBandTransactions(bandId, spreadsheetId);
    }

    /**
     * Validate a transaction (admin only)
     * @param {number} transactionId - Transaction ID
     * @param {number} validatorId - User ID of validator
     * @param {string} transactionDate - Transaction date
     * @returns {Promise<void>}
     */
    async validate(transactionId, validatorId, transactionDate) {
        const transaction = await this.getById(transactionId);

        // Check if already validated
        if (transaction.status === 'validated') {
            throw new ConflictError(
                'Transaction already validated'
            );
        }

        await validateTransaction(transactionId, validatorId, transactionDate);

        // Sync to Google Sheets - get band info from transaction
        if (transaction.band_id && transaction.accounting_spreadsheet_id) {
            await syncService.syncBandTransactions(
                transaction.band_id,
                transaction.accounting_spreadsheet_id
            );
        }
    }
}

module.exports = new TransactionService();
