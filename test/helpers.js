const request = require('supertest');
const { hashPassword } = require('../lib/auth');
const { ROLES } = require('../lib/roles');

async function authenticateAs(app, username, password) {
    const agent = request.agent(app);

    await agent
        .post('/login')
        .type('form')
        .send({ login: username, password })
        .expect(302); // Should redirect after login

    return agent;
}

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

function createBandData(overrides = {}) {
    return {
        name: `Test Band ${Date.now()}`,
        email: `testband${Date.now()}@example.com`,
        ...overrides
    };
}

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
