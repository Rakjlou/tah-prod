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

class TransactionService {
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

    async getAllTransactions(bandFilter = null, statusFilter = 'pending') {
        return await getAllTransactionsWithBands(bandFilter, statusFilter);
    }

    async getById(transactionId) {
        const transaction = await getTransactionById(transactionId);
        if (!transaction) {
            throw new NotFoundError('Transaction');
        }
        return transaction;
    }

    async create(data) {
        const { bandId, type, amount, categoryId, description, bandFolderId, spreadsheetId, files, transactionDate } = data;

        // Validate input
        if (!['income', 'expense'].includes(type)) {
            throw new ValidationError('Invalid transaction type');
        }

        if (isNaN(amount) || amount <= 0) {
            throw new ValidationError('Invalid amount');
        }

        // Create transaction (transactionDate can be null)
        const transactionId = await createTransaction(bandId, type, parseFloat(amount), parseInt(categoryId), description, transactionDate || null);

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

    async update(transactionId, bandId, data) {
        const transaction = await this.getById(transactionId);

        // 404 instead of 403 to avoid leaking resource existence
        if (transaction.band_id !== bandId) {
            throw new NotFoundError('Transaction');
        }

        // Can only edit pending transactions
        if (transaction.status !== 'pending') {
            throw new ConflictError(
                'Cannot edit validated transaction'
            );
        }

        const { type, amount, categoryId, description, spreadsheetId, transactionDate, clearDate } = data;

        // Prepare update data
        const updates = {};
        if (type) updates.type = type;
        if (amount) updates.amount = parseFloat(amount);
        if (categoryId) updates.category_id = parseInt(categoryId);
        if (description !== undefined) updates.description = description;

        // Handle transaction date (clear_date checkbox takes precedence)
        if (clearDate) {
            updates.transaction_date = null;
        } else if (transactionDate !== undefined) {
            updates.transaction_date = transactionDate || null;
        }

        await updateTransaction(transactionId, updates);

        // Sync to Google Sheets
        if (spreadsheetId) {
            await syncService.syncBandTransactions(bandId, spreadsheetId);
        }
    }

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
