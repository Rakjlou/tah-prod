const { runQuery, getOne, getAll } = require('./db-wrapper');

// ===========================
// QONTO TRANSACTION LINK FUNCTIONS
// ===========================

/**
 * Create a link between a TAH transaction and a Qonto transaction
 * @param {number} transactionId - TAH transaction ID
 * @param {object} qontoData - Qonto transaction data (with 'side' and optional 'allocated_amount')
 * @param {number} userId - User ID who created the link
 * @returns {Promise<object>} - Created link object
 */
const createLink = async (transactionId, qontoData, userId) => {
    const signedAmount = qontoData.side === 'debit' ? -Math.abs(qontoData.amount) : Math.abs(qontoData.amount);
    const allocatedAmount = qontoData.allocated_amount !== undefined
        ? qontoData.allocated_amount
        : signedAmount;

    const sql = `
        INSERT INTO qonto_transaction_links (
            transaction_id,
            qonto_id,
            qonto_transaction_id,
            qonto_amount,
            qonto_currency,
            qonto_settled_at,
            qonto_label,
            qonto_reference,
            qonto_note,
            qonto_web_url,
            allocated_amount,
            linked_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
        transactionId,
        qontoData.id,
        qontoData.transaction_id,
        signedAmount,
        qontoData.currency,
        qontoData.settled_at,
        qontoData.label,
        qontoData.reference || null,
        qontoData.note || null,
        qontoData.qonto_web_url || null,
        allocatedAmount,
        userId
    ];

    const result = await runQuery(sql, params);

    return getOne('SELECT * FROM qonto_transaction_links WHERE id = ?', [result.lastID]);
};

/**
 * Delete a link by its ID
 * @param {number} linkId - Link ID to delete
 * @returns {Promise<boolean>} - True if deleted
 */
const deleteLink = async (linkId) => {
    const result = await runQuery('DELETE FROM qonto_transaction_links WHERE id = ?', [linkId]);
    return result.changes > 0;
};

/**
 * Get all Qonto transactions linked to a TAH transaction
 * @param {number} transactionId - TAH transaction ID
 * @returns {Promise<array>} - Array of link objects
 */
const getLinkedTransactions = (transactionId) =>
    getAll(
        'SELECT * FROM qonto_transaction_links WHERE transaction_id = ? ORDER BY qonto_settled_at DESC',
        [transactionId]
    );

/**
 * Check if a Qonto transaction is already linked
 * @param {string} qontoId - Qonto transaction UUID
 * @returns {Promise<{isLinked: boolean, linkedTo: array, linkIds: array}>}
 */
const isQontoLinked = async (qontoId) => {
    const rows = await getAll(
        'SELECT id, transaction_id FROM qonto_transaction_links WHERE qonto_id = ?',
        [qontoId]
    );

    if (rows && rows.length > 0) {
        return {
            isLinked: true,
            linkedTo: rows.map(r => r.transaction_id),
            linkIds: rows.map(r => r.id)
        };
    } else {
        return {
            isLinked: false,
            linkedTo: [],
            linkIds: []
        };
    }
};

/**
 * Get all links for multiple Qonto transaction IDs
 * Useful for checking multiple transactions at once
 * @param {array} qontoIds - Array of Qonto transaction UUIDs
 * @returns {Promise<object>} - Object mapping qonto_id to link status
 */
const checkMultipleLinks = async (qontoIds) => {
    if (!qontoIds || qontoIds.length === 0) {
        return {};
    }

    const placeholders = qontoIds.map(() => '?').join(',');
    const sql = `SELECT qonto_id, id, transaction_id FROM qonto_transaction_links WHERE qonto_id IN (${placeholders})`;

    const rows = await getAll(sql, qontoIds);

    const linkMap = {};
    qontoIds.forEach(qid => {
        linkMap[qid] = { isLinked: false, linkedTo: [], linkIds: [] };
    });

    rows.forEach(row => {
        if (!linkMap[row.qonto_id].isLinked) {
            linkMap[row.qonto_id].isLinked = true;
        }
        linkMap[row.qonto_id].linkedTo.push(row.transaction_id);
        linkMap[row.qonto_id].linkIds.push(row.id);
    });

    return linkMap;
};

// ===========================
// QONTO TRANSACTION CACHE FUNCTIONS
// ===========================

/**
 * Upsert a Qonto transaction into the cache
 * @param {object} qontoData - Qonto transaction data from API
 * @returns {Promise<number>} - Transaction ID
 */
const upsertQontoTransaction = async (qontoData) => {
    const sql = `
        INSERT INTO qonto_transactions (
            qonto_id,
            qonto_transaction_id,
            amount,
            currency,
            side,
            settled_at,
            emitted_at,
            label,
            reference,
            note,
            operation_type,
            status,
            qonto_web_url,
            raw_data,
            organization_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(qonto_id) DO UPDATE SET
            qonto_transaction_id = excluded.qonto_transaction_id,
            amount = excluded.amount,
            currency = excluded.currency,
            side = excluded.side,
            settled_at = excluded.settled_at,
            emitted_at = excluded.emitted_at,
            label = excluded.label,
            reference = excluded.reference,
            note = excluded.note,
            operation_type = excluded.operation_type,
            status = excluded.status,
            qonto_web_url = excluded.qonto_web_url,
            raw_data = excluded.raw_data,
            fetched_at = CURRENT_TIMESTAMP
    `;

    const params = [
        qontoData.id,
        qontoData.transaction_id,
        qontoData.amount,
        qontoData.currency,
        qontoData.side,
        qontoData.settled_at || qontoData.emitted_at,
        qontoData.emitted_at,
        qontoData.label,
        qontoData.reference || null,
        qontoData.note || null,
        qontoData.operation_type || null,
        qontoData.status,
        qontoData.qonto_web_url || null,
        JSON.stringify(qontoData),
        1
    ];

    const result = await runQuery(sql, params);
    return result.lastID;
};

/**
 * Get Qonto transactions from cache with optional filters
 * @param {object} filters - Optional filters
 * @returns {Promise<array>}
 */
const getQontoTransactions = (filters = {}) => {
    let sql = 'SELECT * FROM qonto_transactions WHERE 1=1';
    const params = [];

    if (filters.settled_at_from) {
        sql += ' AND settled_at >= ?';
        params.push(filters.settled_at_from);
    }

    if (filters.settled_at_to) {
        sql += ' AND settled_at <= ?';
        params.push(filters.settled_at_to);
    }

    if (filters.status) {
        sql += ' AND status = ?';
        params.push(filters.status);
    }

    sql += ' ORDER BY settled_at DESC';

    if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
    }

    return getAll(sql, params);
};

/**
 * Get a single Qonto transaction by Qonto ID
 * @param {string} qontoId
 * @returns {Promise<object|null>}
 */
const getQontoTransactionByQontoId = async (qontoId) => {
    const row = await getOne('SELECT * FROM qonto_transactions WHERE qonto_id = ?', [qontoId]);
    return row || null;
};

/**
 * Get the last sync date (most recent settled_at from cached transactions)
 * @returns {Promise<string|null>}
 */
const getLastSyncDate = async () => {
    const row = await getOne('SELECT MAX(settled_at) as last_sync_date FROM qonto_transactions');
    return row && row.last_sync_date ? row.last_sync_date : null;
};

/**
 * Get the last sync timestamp from qonto_organizations
 * @returns {Promise<string|null>}
 */
const getLastSyncTimestamp = async () => {
    const row = await getOne(
        'SELECT last_sync_at FROM qonto_organizations ORDER BY last_sync_at DESC LIMIT 1'
    );
    return row && row.last_sync_at ? row.last_sync_at : null;
};

/**
 * Update the last sync timestamp
 * @param {string} syncDate - ISO date string
 * @returns {Promise<void>}
 */
const updateLastSyncDate = async (syncDate) => {
    // Upsert into qonto_organizations (we'll use a default org for now)
    const sql = `
        INSERT INTO qonto_organizations (id, organization_slug, last_sync_date, last_sync_at)
        VALUES (1, 'default', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            last_sync_date = excluded.last_sync_date,
            last_sync_at = CURRENT_TIMESTAMP
    `;

    await runQuery(sql, [syncDate]);
};

/**
 * Get total count of cached Qonto transactions
 * @returns {Promise<number>}
 */
const getQontoTransactionCount = async () => {
    const row = await getOne('SELECT COUNT(*) as count FROM qonto_transactions');
    return row ? row.count : 0;
};

/**
 * Get the oldest cached Qonto transaction
 * @returns {Promise<object|null>}
 */
const getOldestQontoTransaction = async () => {
    const row = await getOne('SELECT * FROM qonto_transactions ORDER BY settled_at ASC LIMIT 1');
    return row || null;
};

/**
 * Get the newest cached Qonto transaction
 * @returns {Promise<object|null>}
 */
const getNewestQontoTransaction = async () => {
    const row = await getOne('SELECT * FROM qonto_transactions ORDER BY settled_at DESC LIMIT 1');
    return row || null;
};

/**
 * Clear all cached Qonto transactions
 * @returns {Promise<void>}
 */
const clearQontoCache = async () => {
    await runQuery('DELETE FROM qonto_transactions');
    await runQuery('DELETE FROM qonto_organizations');
};

/**
 * Compute how much of a Qonto transaction is allocated across all links
 * @param {string} qontoId - Qonto transaction UUID
 * @returns {Promise<{allocated: number, available: number, qontoAmount: number, links: array}>}
 */
const getQontoAllocationByQontoId = async (qontoId) => {
    // Get all links for this Qonto transaction
    const links = await getAll(
        `SELECT qtl.*, t.amount as website_amount, t.type as website_type
         FROM qonto_transaction_links qtl
         LEFT JOIN transactions t ON qtl.transaction_id = t.id
         WHERE qtl.qonto_id = ?`,
        [qontoId]
    );

    // Get the Qonto transaction amount
    const qontoTx = await getOne(
        'SELECT amount FROM qonto_transactions WHERE qonto_id = ?',
        [qontoId]
    );

    const qontoAmount = qontoTx ? qontoTx.amount : 0;
    const qontoAbsAmount = Math.abs(qontoAmount);

    // Sum allocated amounts (use absolute values since we're tracking capacity)
    const allocated = links.reduce((sum, link) => {
        return sum + Math.abs(link.allocated_amount || link.qonto_amount || 0);
    }, 0);

    const available = qontoAbsAmount - allocated;

    return {
        allocated,
        available,
        qontoAmount,
        links
    };
};

module.exports = {
    createLink,
    deleteLink,
    getLinkedTransactions,
    isQontoLinked,
    checkMultipleLinks,
    upsertQontoTransaction,
    getQontoTransactions,
    getQontoTransactionByQontoId,
    getLastSyncDate,
    getLastSyncTimestamp,
    updateLastSyncDate,
    getQontoTransactionCount,
    getOldestQontoTransaction,
    getNewestQontoTransaction,
    clearQontoCache,
    getQontoAllocationByQontoId
};
