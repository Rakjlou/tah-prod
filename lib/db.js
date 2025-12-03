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
    },
    // Invoice tables
    {
        sql: `CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            band_id INTEGER NOT NULL,
            invoice_number TEXT UNIQUE NOT NULL,
            issue_date TEXT NOT NULL,
            service_date TEXT,
            client_name TEXT NOT NULL,
            client_address TEXT NOT NULL,
            client_siret TEXT,
            total_amount REAL NOT NULL CHECK(total_amount >= 0),
            status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'paid', 'cancelled')),
            notes TEXT,
            transaction_id INTEGER,
            payment_delay_text TEXT,
            late_penalty_text TEXT,
            recovery_fee_text TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE,
            FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
        )`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number)`
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS idx_invoices_band_id ON invoices(band_id)`
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS invoice_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            description TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 1 CHECK(quantity > 0),
            unit_price REAL NOT NULL CHECK(unit_price >= 0),
            total REAL NOT NULL CHECK(total >= 0),
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        )`
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id)`
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
// INVOICE FUNCTIONS
// ===========================

/**
 * Generate the next invoice number in format PREFIX-YYYY-NNN
 * Includes retry logic to handle race conditions
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @returns {Promise<string>} The generated invoice number
 */
const generateInvoiceNumber = async (maxRetries = 3) => {
    const prefix = await getConfig('invoice_prefix') || 'FAC';
    const year = new Date().getFullYear();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Get highest number for this year
        const result = await getOne(`
            SELECT invoice_number FROM invoices
            WHERE invoice_number LIKE ?
            ORDER BY invoice_number DESC LIMIT 1
        `, [`${prefix}-${year}-%`]);

        let nextNum = 1;
        if (result) {
            const parts = result.invoice_number.split('-');
            nextNum = parseInt(parts[2], 10) + 1;
        }

        // Format: FAC-2025-001
        const number = `${prefix}-${year}-${String(nextNum).padStart(3, '0')}`;

        // Verify uniqueness (defensive check for race conditions)
        const exists = await getOne('SELECT id FROM invoices WHERE invoice_number = ?', [number]);
        if (!exists) {
            return number;
        }

        // Collision detected - retry with exponential backoff
        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 50 * attempt));
        }
    }

    throw new Error('Failed to generate unique invoice number after multiple attempts');
};

/**
 * Create a new invoice
 * @param {Object} data - Invoice data
 * @returns {Promise<number>} The new invoice ID
 */
const createInvoice = async (data) => {
    const {
        bandId,
        invoiceNumber,
        issueDate,
        serviceDate,
        clientName,
        clientAddress,
        clientSiret,
        totalAmount,
        notes,
        paymentDelayText,
        latePenaltyText,
        recoveryFeeText
    } = data;

    const result = await runQuery(
        `INSERT INTO invoices (band_id, invoice_number, issue_date, service_date, client_name, client_address, client_siret, total_amount, notes, payment_delay_text, late_penalty_text, recovery_fee_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bandId, invoiceNumber, issueDate, serviceDate || null, clientName, clientAddress, clientSiret || null, totalAmount, notes || null, paymentDelayText || null, latePenaltyText || null, recoveryFeeText || null]
    );
    return result.lastID;
};

/**
 * Get invoice by ID with band information
 * @param {number} id - Invoice ID
 * @returns {Promise<Object|null>} Invoice object or null
 */
const getInvoiceById = (id) =>
    getOne(
        `SELECT i.*, b.name as band_name
         FROM invoices i
         LEFT JOIN bands b ON i.band_id = b.id
         WHERE i.id = ?`,
        [id]
    );

/**
 * Get all invoices for a band
 * @param {number} bandId - Band ID
 * @param {string|null} statusFilter - Optional status filter
 * @returns {Promise<Array>} Array of invoices
 */
const getInvoicesByBand = (bandId, statusFilter = null) => {
    let query = `SELECT * FROM invoices WHERE band_id = ?`;
    const params = [bandId];

    if (statusFilter) {
        query += ' AND status = ?';
        params.push(statusFilter);
    }

    query += ' ORDER BY created_at DESC';
    return getAll(query, params);
};

/**
 * Get all invoices (admin view)
 * @param {number|null} bandIdFilter - Optional band filter
 * @param {string|null} statusFilter - Optional status filter
 * @returns {Promise<Array>} Array of invoices with band names
 */
const getAllInvoicesWithBands = (bandIdFilter = null, statusFilter = null) => {
    let query = `SELECT i.*, b.name as band_name
                 FROM invoices i
                 LEFT JOIN bands b ON i.band_id = b.id
                 WHERE 1=1`;
    const params = [];

    if (bandIdFilter) {
        query += ' AND i.band_id = ?';
        params.push(bandIdFilter);
    }

    if (statusFilter) {
        query += ' AND i.status = ?';
        params.push(statusFilter);
    }

    query += ' ORDER BY i.created_at DESC';
    return getAll(query, params);
};

/**
 * Update an invoice
 * @param {number} id - Invoice ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
const updateInvoice = async (id, updates) => {
    await buildDynamicUpdate('invoices', id, updates, [
        'issue_date',
        'service_date',
        'client_name',
        'client_address',
        'client_siret',
        'total_amount',
        'status',
        'notes',
        'transaction_id',
        'payment_delay_text',
        'late_penalty_text',
        'recovery_fee_text'
    ], {
        updated_at: 'CURRENT_TIMESTAMP'
    });
};

/**
 * Delete an invoice
 * @param {number} id - Invoice ID
 * @returns {Promise<void>}
 */
const deleteInvoice = async (id) => {
    await runQuery('DELETE FROM invoices WHERE id = ?', [id]);
};

/**
 * Check if invoice number exists
 * @param {string} invoiceNumber - Invoice number to check
 * @returns {Promise<boolean>} True if exists
 */
const invoiceNumberExists = async (invoiceNumber) => {
    const result = await getOne('SELECT id FROM invoices WHERE invoice_number = ?', [invoiceNumber]);
    return !!result;
};

// ===========================
// INVOICE ITEM FUNCTIONS
// ===========================

/**
 * Add an item to an invoice
 * @param {Object} data - Item data
 * @returns {Promise<number>} The new item ID
 */
const addInvoiceItem = async (data) => {
    const { invoiceId, description, quantity, unitPrice, total, sortOrder } = data;
    const result = await runQuery(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [invoiceId, description, quantity, unitPrice, total, sortOrder || 0]
    );
    return result.lastID;
};

/**
 * Get all items for an invoice
 * @param {number} invoiceId - Invoice ID
 * @returns {Promise<Array>} Array of invoice items
 */
const getInvoiceItems = (invoiceId) =>
    getAll(
        'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC, id ASC',
        [invoiceId]
    );

/**
 * Update an invoice item
 * @param {number} id - Item ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
const updateInvoiceItem = async (id, updates) => {
    await buildDynamicUpdate('invoice_items', id, updates, [
        'description',
        'quantity',
        'unit_price',
        'total',
        'sort_order'
    ]);
};

/**
 * Delete an invoice item
 * @param {number} id - Item ID
 * @returns {Promise<void>}
 */
const deleteInvoiceItem = async (id) => {
    await runQuery('DELETE FROM invoice_items WHERE id = ?', [id]);
};

/**
 * Delete all items for an invoice
 * @param {number} invoiceId - Invoice ID
 * @returns {Promise<void>}
 */
const deleteInvoiceItems = async (invoiceId) => {
    await runQuery('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
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
    deleteTransactionDocument,
    // Invoice functions
    generateInvoiceNumber,
    createInvoice,
    getInvoiceById,
    getInvoicesByBand,
    getAllInvoicesWithBands,
    updateInvoice,
    deleteInvoice,
    invoiceNumberExists,
    // Invoice item functions
    addInvoiceItem,
    getInvoiceItems,
    updateInvoiceItem,
    deleteInvoiceItem,
    deleteInvoiceItems
};
