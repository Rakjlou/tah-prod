const { runQuery, getOne, getAll } = require('../db-wrapper');
const { buildDynamicUpdate } = require('./helpers');
const { getConfig } = require('./config');

/**
 * Generate the next invoice number in format PREFIX-YYYY-NNN
 * Includes retry logic to handle race conditions
 */
const generateInvoiceNumber = async (maxRetries = 3) => {
    const prefix = await getConfig('invoice_prefix') || 'FAC';
    const year = new Date().getFullYear();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
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

        const number = `${prefix}-${year}-${String(nextNum).padStart(3, '0')}`;

        // Defensive check for race conditions
        const exists = await getOne('SELECT id FROM invoices WHERE invoice_number = ?', [number]);
        if (!exists) {
            return number;
        }

        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 50 * attempt));
        }
    }

    throw new Error('Failed to generate unique invoice number after multiple attempts');
};

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

const getInvoiceById = (id) =>
    getOne(
        `SELECT i.*, b.name as band_name
         FROM invoices i
         LEFT JOIN bands b ON i.band_id = b.id
         WHERE i.id = ?`,
        [id]
    );

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

const deleteInvoice = async (id) => {
    await runQuery('DELETE FROM invoices WHERE id = ?', [id]);
};

const invoiceNumberExists = async (invoiceNumber) => {
    const result = await getOne('SELECT id FROM invoices WHERE invoice_number = ?', [invoiceNumber]);
    return !!result;
};

// ===========================
// INVOICE ITEM FUNCTIONS
// ===========================

const addInvoiceItem = async (data) => {
    const { invoiceId, description, quantity, unitPrice, total, sortOrder } = data;
    const result = await runQuery(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [invoiceId, description, quantity, unitPrice, total, sortOrder || 0]
    );
    return result.lastID;
};

const getInvoiceItems = (invoiceId) =>
    getAll(
        'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC, id ASC',
        [invoiceId]
    );

const updateInvoiceItem = async (id, updates) => {
    await buildDynamicUpdate('invoice_items', id, updates, [
        'description',
        'quantity',
        'unit_price',
        'total',
        'sort_order'
    ]);
};

const deleteInvoiceItem = async (id) => {
    await runQuery('DELETE FROM invoice_items WHERE id = ?', [id]);
};

const deleteInvoiceItems = async (invoiceId) => {
    await runQuery('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId]);
};

module.exports = {
    generateInvoiceNumber,
    createInvoice,
    getInvoiceById,
    getInvoicesByBand,
    getAllInvoicesWithBands,
    updateInvoice,
    deleteInvoice,
    invoiceNumberExists,
    addInvoiceItem,
    getInvoiceItems,
    updateInvoiceItem,
    deleteInvoiceItem,
    deleteInvoiceItems
};
