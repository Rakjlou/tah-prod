const { runQuery, getOne, getAll, runSequential, getDatabasePath } = require('./db-wrapper');

/**
 * Database schema definition
 * Each operation will be executed sequentially
 */
const SCHEMA_OPERATIONS = [
    {
        sql: `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_config_key ON config(key)`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS bands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            user_id INTEGER UNIQUE NOT NULL,
            folder_id TEXT UNIQUE,
            accounting_spreadsheet_id TEXT UNIQUE,
            invoices_folder_id TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_bands_folder_id ON bands(folder_id)`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_bands_accounting_spreadsheet_id ON bands(accounting_spreadsheet_id)`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_bands_user_id ON bands(user_id)`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS transaction_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'both'))
        )`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            band_id INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
            amount REAL NOT NULL CHECK(amount > 0),
            category_id INTEGER NOT NULL,
            description TEXT NOT NULL,
            transaction_date TEXT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'validated')),
            validated_at TEXT NULL,
            validated_by INTEGER NULL,
            drive_folder_id TEXT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE,
            FOREIGN KEY (category_id) REFERENCES transaction_categories(id),
            FOREIGN KEY (validated_by) REFERENCES users(id)
        )`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS transaction_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            drive_file_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
        )`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS qonto_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qonto_id TEXT NOT NULL UNIQUE,
            qonto_transaction_id TEXT,
            amount REAL NOT NULL CHECK (amount >= 0),
            currency TEXT NOT NULL,
            side TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
            settled_at TEXT NOT NULL,
            emitted_at TEXT,
            label TEXT,
            reference TEXT,
            note TEXT,
            operation_type TEXT,
            status TEXT NOT NULL,
            qonto_web_url TEXT,
            raw_data TEXT,
            organization_id INTEGER,
            fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS idx_qonto_transactions_settled_at ON qonto_transactions(settled_at DESC)`
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS idx_qonto_transactions_qonto_id ON qonto_transactions(qonto_id)`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS qonto_transaction_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            qonto_id TEXT NOT NULL,
            qonto_transaction_id TEXT,
            qonto_amount REAL,
            qonto_currency TEXT,
            qonto_settled_at TEXT,
            qonto_label TEXT,
            qonto_reference TEXT,
            qonto_note TEXT,
            qonto_web_url TEXT,
            allocated_amount REAL,
            linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            linked_by INTEGER,
            FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
            FOREIGN KEY (linked_by) REFERENCES users(id)
        )`
    }
];

/**
 * Initialize database schema
 * @returns {Promise<void>}
 */
async function initializeDatabase() {
    return runSequential(SCHEMA_OPERATIONS);
}

// ===========================
// USER FUNCTIONS
// ===========================

const createUser = async (username, hashedPassword, role = 0) => {
    const result = await runQuery(
        'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
        [username, hashedPassword, role]
    );
    return result.lastID;
};

const getUserByUsername = (username) =>
    getOne('SELECT * FROM users WHERE username = ?', [username]);

const getUserById = (id) =>
    getOne('SELECT * FROM users WHERE id = ?', [id]);

const updateUserPassword = async (userId, hashedPassword) => {
    await runQuery('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
};

const deleteUser = async (userId) => {
    await runQuery('DELETE FROM users WHERE id = ?', [userId]);
};

/**
 * Get all users (excluding passwords)
 * @returns {Promise<Array>} Array of all users
 */
const getAllUsers = () =>
    getAll('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');

/**
 * Update user details (username and/or role)
 * @param {number} userId - User ID
 * @param {Object} updates - Object with username and/or role fields
 * @returns {Promise<void>}
 */
const updateUser = async (userId, updates) => {
    await buildDynamicUpdate('users', userId, updates, ['username', 'role']);
};

// ===========================
// CONFIG FUNCTIONS
// ===========================

const getConfig = async (key) => {
    const row = await getOne('SELECT value FROM config WHERE key = ?', [key]);
    return row ? row.value : null;
};

const setConfig = async (key, value) => {
    await runQuery(
        'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [key, value]
    );
};

const getAllConfig = async () => {
    const rows = await getAll('SELECT key, value FROM config');
    const config = {};
    rows.forEach(row => {
        config[row.key] = row.value;
    });
    return config;
};

// ===========================
// BAND FUNCTIONS
// ===========================

const createBand = async (name, email, userId, folderId, accountingSpreadsheetId, invoicesFolderId) => {
    const result = await runQuery(
        'INSERT INTO bands (name, email, user_id, folder_id, accounting_spreadsheet_id, invoices_folder_id) VALUES (?, ?, ?, ?, ?, ?)',
        [name, email, userId, folderId, accountingSpreadsheetId, invoicesFolderId]
    );
    return result.lastID;
};

const getBandById = (id) =>
    getOne('SELECT * FROM bands WHERE id = ?', [id]);

const getAllBands = () =>
    getAll('SELECT * FROM bands ORDER BY created_at DESC');

const getBandByUserId = (userId) =>
    getOne('SELECT * FROM bands WHERE user_id = ?', [userId]);

// ===========================
// GENERIC UPDATE HELPER
// ===========================

/**
 * Generic helper to build and execute dynamic UPDATE queries
 * @param {string} tableName - The table to update
 * @param {number} id - The record ID
 * @param {Object} updates - Object with fields to update
 * @param {Array<string>} allowedFields - Array of allowed field names
 * @param {Object} autoFields - Object of auto-set fields (e.g., {updated_at: 'CURRENT_TIMESTAMP'})
 */
const buildDynamicUpdate = async (tableName, id, updates, allowedFields, autoFields = {}) => {
    const fields = [];
    const values = [];

    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            fields.push(`${field} = ?`);
            values.push(updates[field]);
        }
    }

    for (const [field, value] of Object.entries(autoFields)) {
        fields.push(`${field} = ${value}`);
    }

    if (fields.length === 0) {
        return;
    }

    values.push(id);
    await runQuery(`UPDATE ${tableName} SET ${fields.join(', ')} WHERE id = ?`, values);
};

const updateBand = async (id, updates) => {
    await buildDynamicUpdate('bands', id, updates, [
        'name',
        'email',
        'folder_id',
        'accounting_spreadsheet_id',
        'invoices_folder_id'
    ]);
};

const deleteBand = async (id) => {
    await runQuery('DELETE FROM bands WHERE id = ?', [id]);
};

// ===========================
// CATEGORY FUNCTIONS
// ===========================

const createCategory = async (name, type) => {
    const result = await runQuery(
        'INSERT INTO transaction_categories (name, type) VALUES (?, ?)',
        [name, type]
    );
    return result.lastID;
};

const getAllCategories = () =>
    getAll('SELECT * FROM transaction_categories ORDER BY name ASC');

const getCategoriesByType = (type) =>
    getAll(
        'SELECT * FROM transaction_categories WHERE type = ? OR type = ? ORDER BY name ASC',
        [type, 'both']
    );

const updateCategory = async (id, updates) => {
    await buildDynamicUpdate('transaction_categories', id, updates, [
        'name',
        'type'
    ]);
};

const deleteCategory = async (id) => {
    await runQuery('DELETE FROM transaction_categories WHERE id = ?', [id]);
};

const seedDefaultCategories = async () => {
    const existing = await getAllCategories();
    if (existing.length > 0) {
        return; // Already seeded
    }

    const defaultCategories = [
        // Expenses
        { name: 'Gear', type: 'expense' },
        { name: 'Travel', type: 'expense' },
        { name: 'Marketing', type: 'expense' },
        { name: 'Studio', type: 'expense' },
        // Income
        { name: 'Music revenue', type: 'income' },
        // Both
        { name: 'Merchandising', type: 'both' },
        { name: 'Gig', type: 'both' },
        { name: 'Other', type: 'both' }
    ];

    for (const category of defaultCategories) {
        await createCategory(category.name, category.type);
    }
};

// ===========================
// TRANSACTION FUNCTIONS
// ===========================

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

// ===========================
// TRANSACTION DOCUMENT FUNCTIONS
// ===========================

const addTransactionDocument = async (transactionId, driveFileId, filename) => {
    const result = await runQuery(
        'INSERT INTO transaction_documents (transaction_id, drive_file_id, filename) VALUES (?, ?, ?)',
        [transactionId, driveFileId, filename]
    );
    return result.lastID;
};

const getTransactionDocuments = (transactionId) =>
    getAll(
        'SELECT * FROM transaction_documents WHERE transaction_id = ? ORDER BY uploaded_at DESC',
        [transactionId]
    );

const deleteTransactionDocument = async (id) => {
    await runQuery('DELETE FROM transaction_documents WHERE id = ?', [id]);
};

// ===========================
// EXPORTS
// ===========================

module.exports = {
    // For backward compatibility (used in helpers.js for session management)
    getDatabase: () => {
        const sqlite3 = require('sqlite3').verbose();
        return new sqlite3.Database(getDatabasePath());
    },
    initializeDatabase,
    createUser,
    getUserByUsername,
    getUserById,
    updateUserPassword,
    deleteUser,
    getAllUsers,
    updateUser,
    getConfig,
    setConfig,
    getAllConfig,
    createBand,
    getBandById,
    getAllBands,
    getBandByUserId,
    updateBand,
    deleteBand,
    createCategory,
    getAllCategories,
    getCategoriesByType,
    updateCategory,
    deleteCategory,
    seedDefaultCategories,
    createTransaction,
    getTransactionById,
    getTransactionsByBand,
    getAllTransactionsWithBands,
    updateTransaction,
    deleteTransaction,
    validateTransaction,
    getBalanceForBand,
    addTransactionDocument,
    getTransactionDocuments,
    deleteTransactionDocument
};
