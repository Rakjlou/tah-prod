const { runQuery, getOne, getAll } = require('../db-wrapper');
const { buildDynamicUpdate } = require('./helpers');

const createTransaction = async (bandId, type, amount, categoryId, description, transactionDate = null) => {
    const result = await runQuery(
        'INSERT INTO transactions (band_id, type, amount, category_id, description, transaction_date) VALUES (?, ?, ?, ?, ?, ?)',
        [bandId, type, amount, categoryId, description, transactionDate]
    );
    return result.lastID;
};

const getTransactionById = (id) =>
    getOne(
        `SELECT t.*, c.name as category_name, b.name as band_name, b.accounting_spreadsheet_id
         FROM transactions t
         LEFT JOIN transaction_categories c ON t.category_id = c.id
         LEFT JOIN bands b ON t.band_id = b.id
         WHERE t.id = ?`,
        [id]
    );

const getTransactionsByBand = (bandId, statusFilter = null) => {
    let query = `SELECT t.*, c.name as category_name
                 FROM transactions t
                 LEFT JOIN transaction_categories c ON t.category_id = c.id
                 WHERE t.band_id = ?`;
    const params = [bandId];

    if (statusFilter) {
        query += ' AND t.status = ?';
        params.push(statusFilter);
    }

    query += ' ORDER BY t.created_at DESC';

    return getAll(query, params);
};

const getAllTransactionsWithBands = (bandIdFilter = null, statusFilter = null) => {
    let query = `SELECT t.*, c.name as category_name, b.name as band_name
                 FROM transactions t
                 LEFT JOIN transaction_categories c ON t.category_id = c.id
                 LEFT JOIN bands b ON t.band_id = b.id
                 WHERE 1=1`;
    const params = [];

    if (bandIdFilter) {
        query += ' AND t.band_id = ?';
        params.push(bandIdFilter);
    }

    if (statusFilter) {
        query += ' AND t.status = ?';
        params.push(statusFilter);
    }

    query += ' ORDER BY t.created_at DESC';

    return getAll(query, params);
};

const updateTransaction = async (id, updates) => {
    await buildDynamicUpdate('transactions', id, updates, [
        'type',
        'amount',
        'category_id',
        'description',
        'status',
        'transaction_date',
        'drive_folder_id'
    ], {
        updated_at: 'CURRENT_TIMESTAMP'
    });
};

const deleteTransaction = async (id) => {
    await runQuery('DELETE FROM transactions WHERE id = ?', [id]);
};

const validateTransaction = async (id, validatedBy, transactionDate) => {
    await runQuery(
        `UPDATE transactions
         SET status = 'validated',
             validated_at = CURRENT_TIMESTAMP,
             validated_by = ?,
             transaction_date = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [validatedBy, transactionDate, id]
    );
};

const getBalanceForBand = async (bandId) => {
    const row = await getOne(
        `SELECT
            SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
            SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expense
         FROM transactions
         WHERE band_id = ? AND status = 'validated'`,
        [bandId]
    );
    const balance = (row.total_income || 0) - (row.total_expense || 0);
    return balance;
};

const getBalancesForAllBands = () =>
    getAll(
        `SELECT b.id AS band_id,
                COALESCE(SUM(CASE WHEN t.type = 'income'  AND t.status = 'validated' THEN t.amount ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN t.type = 'expense' AND t.status = 'validated' THEN t.amount ELSE 0 END), 0)
                AS balance
         FROM bands b
         LEFT JOIN transactions t ON t.band_id = b.id
         GROUP BY b.id`
    );

module.exports = {
    createTransaction,
    getTransactionById,
    getTransactionsByBand,
    getAllTransactionsWithBands,
    updateTransaction,
    deleteTransaction,
    validateTransaction,
    getBalanceForBand,
    getBalancesForAllBands
};
