const request = require('supertest');
const { hashPassword } = require('../lib/auth');
const { ROLES } = require('../lib/roles');

/**
 * Helper to authenticate a user and return an agent with session cookies
 * @param {Express.Application} app - Express app instance
 * @param {string} username - Username to login as
 * @param {string} password - Password for the user
 * @returns {Promise<request.SuperAgentTest>} Authenticated agent
 */
async function authenticateAs(app, username, password) {
    const agent = request.agent(app);

    await agent
        .post('/login')
        .type('form')
        .send({ login: username, password })
        .expect(302); // Should redirect after login

    return agent;
}

/**
 * Create test transaction data with defaults
 * @param {Object} overrides - Fields to override
 * @returns {Object} Transaction data
 */
function createTransactionData(overrides = {}) {
    return {
        type: 'expense',
        amount: 100.50,
        category_id: 1,
        description: 'Test transaction',
        transaction_date: '2025-01-15',
        ...overrides
    };
}

/**
 * Create test band data with defaults
 * @param {Object} overrides - Fields to override
 * @returns {Object} Band data
 */
function createBandData(overrides = {}) {
    return {
        name: `Test Band ${Date.now()}`,
        email: `testband${Date.now()}@example.com`,
        ...overrides
    };
}

/**
 * Helper to create a user directly in the database
 * @param {Object} db - Database connection
 * @param {string} username - Username
 * @param {string} password - Plain text password
 * @param {number} role - Role bitmask
 * @returns {Promise<number>} User ID
 */
async function createTestUser(db, username, password, role = ROLES.BAND) {
    const hashedPassword = await hashPassword(password);

    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
            [username, hashedPassword, role],
            function(err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
    });
}

/**
 * Helper to create a band directly in the database
 * @param {Object} db - Database connection
 * @param {number} userId - User ID for the band
 * @param {string} name - Band name
 * @param {string} email - Band email
 * @returns {Promise<number>} Band ID
 */
async function createTestBand(db, userId, name, email) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO bands (name, email, user_id) VALUES (?, ?, ?)',
            [name, email, userId],
            function(err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
    });
}

/**
 * Helper to create a transaction directly in the database
 * @param {Object} db - Database connection
 * @param {number} bandId - Band ID
 * @param {Object} data - Transaction data
 * @returns {Promise<number>} Transaction ID
 */
async function createTestTransaction(db, bandId, data = {}) {
    const txData = createTransactionData(data);

    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO transactions (
                band_id, type, amount, category_id, description,
                transaction_date, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            [
                bandId,
                txData.type,
                txData.amount,
                txData.category_id,
                txData.description,
                txData.transaction_date,
                txData.status || 'pending'
            ],
            function(err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
    });
}

/**
 * Helper to create a category directly in the database
 * @param {Object} db - Database connection
 * @param {string} name - Category name
 * @param {string} type - Category type (income/expense/both)
 * @returns {Promise<number>} Category ID
 */
async function createTestCategory(db, name, type = 'expense') {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO transaction_categories (name, type) VALUES (?, ?)',
            [name, type],
            function(err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
    });
}

/**
 * Get a user by username
 * @param {Object} db - Database connection
 * @param {string} username - Username
 * @returns {Promise<Object>} User object
 */
async function getTestUser(db, username) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT * FROM users WHERE username = ?',
            [username],
            (err, row) => {
                if (err) return reject(err);
                resolve(row);
            }
        );
    });
}

/**
 * Get a transaction by ID
 * @param {Object} db - Database connection
 * @param {number} id - Transaction ID
 * @returns {Promise<Object>} Transaction object
 */
async function getTestTransaction(db, id) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT * FROM transactions WHERE id = ?',
            [id],
            (err, row) => {
                if (err) return reject(err);
                resolve(row);
            }
        );
    });
}

/**
 * Create test invoice data with defaults (for HTTP form submission)
 * @param {Object} overrides - Fields to override
 * @returns {Object} Invoice form data
 */
function createInvoiceData(overrides = {}) {
    return {
        issue_date: '2025-01-15',
        service_date: '2025-01-10',
        client_name: 'Test Client SARL',
        client_address: '123 Test Street\n75001 Paris',
        client_siret: '12345678901234',
        notes: 'Test invoice notes',
        item_description: ['Service 1', 'Service 2'],
        item_quantity: ['1', '2'],
        item_unit_price: ['100', '50'],
        ...overrides
    };
}

// Counter for unique invoice numbers
let invoiceCounter = 0;

/**
 * Helper to create an invoice directly in the database
 * @param {Object} db - Database connection
 * @param {number} bandId - Band ID
 * @param {Object} data - Invoice data overrides
 * @returns {Promise<number>} Invoice ID
 */
async function createTestInvoice(db, bandId, data = {}) {
    invoiceCounter++;
    const invoiceNumber = data.invoice_number || `FAC-2025-${String(invoiceCounter).padStart(4, '0')}-${Date.now()}`;
    const defaults = {
        issue_date: '2025-01-15',
        service_date: '2025-01-10',
        client_name: 'Test Client SARL',
        client_address: '123 Test Street, 75001 Paris',
        client_siret: null,
        total_amount: 200,
        status: 'draft',
        notes: null
    };
    const invoiceData = { ...defaults, ...data };

    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO invoices (
                band_id, invoice_number, issue_date, service_date,
                client_name, client_address, client_siret, total_amount,
                status, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            [
                bandId,
                invoiceNumber,
                invoiceData.issue_date,
                invoiceData.service_date,
                invoiceData.client_name,
                invoiceData.client_address,
                invoiceData.client_siret,
                invoiceData.total_amount,
                invoiceData.status,
                invoiceData.notes
            ],
            function(err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
    });
}

/**
 * Helper to add an item to an invoice
 * @param {Object} db - Database connection
 * @param {number} invoiceId - Invoice ID
 * @param {Object} item - Item data
 * @returns {Promise<number>} Item ID
 */
async function createTestInvoiceItem(db, invoiceId, item = {}) {
    const defaults = {
        description: 'Test Service',
        quantity: 1,
        unit_price: 100,
        total: 100,
        sort_order: 0
    };
    const itemData = { ...defaults, ...item };

    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO invoice_items (
                invoice_id, description, quantity, unit_price, total, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
                invoiceId,
                itemData.description,
                itemData.quantity,
                itemData.unit_price,
                itemData.total,
                itemData.sort_order
            ],
            function(err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
    });
}

/**
 * Get an invoice by ID
 * @param {Object} db - Database connection
 * @param {number} id - Invoice ID
 * @returns {Promise<Object>} Invoice object
 */
async function getTestInvoice(db, id) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT * FROM invoices WHERE id = ?',
            [id],
            (err, row) => {
                if (err) return reject(err);
                resolve(row);
            }
        );
    });
}

/**
 * Get invoice items by invoice ID
 * @param {Object} db - Database connection
 * @param {number} invoiceId - Invoice ID
 * @returns {Promise<Array>} Array of invoice items
 */
async function getTestInvoiceItems(db, invoiceId) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order',
            [invoiceId],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
}

/**
 * Create test Qonto transaction data with defaults
 * @param {Object} overrides - Fields to override
 * @returns {Object} Qonto transaction data
 */
function createQontoTransactionData(overrides = {}) {
    return {
        id: `qonto-${Date.now()}`,
        transaction_id: `tx-${Date.now()}`,
        amount: -100.00,
        currency: 'EUR',
        settled_at: new Date().toISOString(),
        emitted_at: new Date().toISOString(),
        label: 'Test Qonto Transaction',
        reference: 'REF-TEST',
        note: 'Test note',
        qonto_web_url: `https://app.qonto.com/transactions/qonto-${Date.now()}`,
        status: 'completed',
        ...overrides
    };
}

/**
 * Create a Qonto transaction link directly in the database
 * @param {Object} db - Database connection
 * @param {number} transactionId - TAH transaction ID
 * @param {Object} qontoData - Qonto transaction data
 * @param {number} userId - User ID who created the link
 * @returns {Promise<number>} Link ID
 */
async function createTestQontoLink(db, transactionId, qontoData = {}, userId = 1) {
    const qonto = createQontoTransactionData(qontoData);

    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO qonto_transaction_links (
                transaction_id, qonto_id, qonto_transaction_id,
                qonto_amount, qonto_currency, qonto_settled_at,
                qonto_label, qonto_reference, qonto_note,
                qonto_web_url, linked_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                transactionId,
                qonto.id,
                qonto.transaction_id,
                qonto.amount,
                qonto.currency,
                qonto.settled_at,
                qonto.label,
                qonto.reference || null,
                qonto.note || null,
                qonto.qonto_web_url || null,
                userId
            ],
            function(err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
    });
}

/**
 * Get all Qonto links for a transaction
 * @param {Object} db - Database connection
 * @param {number} transactionId - TAH transaction ID
 * @returns {Promise<Array>} Array of link objects
 */
async function getTestQontoLinks(db, transactionId) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM qonto_transaction_links WHERE transaction_id = ?',
            [transactionId],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
}

module.exports = {
    authenticateAs,
    createTransactionData,
    createBandData,
    createTestUser,
    createTestBand,
    createTestTransaction,
    createTestCategory,
    getTestUser,
    getTestTransaction,
    createQontoTransactionData,
    createTestQontoLink,
    getTestQontoLinks,
    // Invoice helpers
    createInvoiceData,
    createTestInvoice,
    createTestInvoiceItem,
    getTestInvoice,
    getTestInvoiceItems
};
