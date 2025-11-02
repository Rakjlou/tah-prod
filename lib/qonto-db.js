const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'tahprod.db');

/**
 * Create a link between a TAH transaction and a Qonto transaction
 * @param {number} transactionId - TAH transaction ID
 * @param {object} qontoData - Qonto transaction data (with 'side' and optional 'allocated_amount')
 * @param {number} userId - User ID who created the link
 * @returns {Promise<object>} - Created link object
 */
function createLink(transactionId, qontoData, userId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

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

        db.run(sql, params, function(err) {
            if (err) {
                db.close();
                return reject(err);
            }

            const linkId = this.lastID;

            // Retrieve the created link
            db.get(
                'SELECT * FROM qonto_transaction_links WHERE id = ?',
                [linkId],
                (err, row) => {
                    db.close();
                    if (err) {
                        return reject(err);
                    }
                    resolve(row);
                }
            );
        });
    });
}

/**
 * Delete a link by its ID
 * @param {number} linkId - Link ID to delete
 * @returns {Promise<boolean>} - True if deleted
 */
function deleteLink(linkId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        db.run(
            'DELETE FROM qonto_transaction_links WHERE id = ?',
            [linkId],
            function(err) {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(this.changes > 0);
            }
        );
    });
}

/**
 * Get all Qonto transactions linked to a TAH transaction
 * @param {number} transactionId - TAH transaction ID
 * @returns {Promise<array>} - Array of link objects
 */
function getLinkedTransactions(transactionId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        db.all(
            'SELECT * FROM qonto_transaction_links WHERE transaction_id = ? ORDER BY qonto_settled_at DESC',
            [transactionId],
            (err, rows) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(rows || []);
            }
        );
    });
}

/**
 * Check if a Qonto transaction is already linked
 * @param {string} qontoId - Qonto transaction UUID
 * @returns {Promise<{isLinked: boolean, linkedTo: array, linkIds: array}>}
 */
function isQontoLinked(qontoId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        db.all(
            'SELECT id, transaction_id FROM qonto_transaction_links WHERE qonto_id = ?',
            [qontoId],
            (err, rows) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                if (rows && rows.length > 0) {
                    resolve({
                        isLinked: true,
                        linkedTo: rows.map(r => r.transaction_id),
                        linkIds: rows.map(r => r.id)
                    });
                } else {
                    resolve({
                        isLinked: false,
                        linkedTo: [],
                        linkIds: []
                    });
                }
            }
        );
    });
}

/**
 * Get all links for multiple Qonto transaction IDs
 * Useful for checking multiple transactions at once
 * @param {array} qontoIds - Array of Qonto transaction UUIDs
 * @returns {Promise<object>} - Object mapping qonto_id to link status
 */
function checkMultipleLinks(qontoIds) {
    return new Promise((resolve, reject) => {
        if (!qontoIds || qontoIds.length === 0) {
            return resolve({});
        }

        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        const placeholders = qontoIds.map(() => '?').join(',');
        const sql = `SELECT qonto_id, id, transaction_id FROM qonto_transaction_links WHERE qonto_id IN (${placeholders})`;

        db.all(sql, qontoIds, (err, rows) => {
            db.close();
            if (err) {
                return reject(err);
            }

            // Convert to a map for easy lookup
            const linkMap = {};
            qontoIds.forEach(qid => {
                linkMap[qid] = { isLinked: false, linkedTo: [], linkIds: [] };
            });

            // Group by qonto_id since one Qonto transaction can have multiple links
            rows.forEach(row => {
                if (!linkMap[row.qonto_id].isLinked) {
                    linkMap[row.qonto_id].isLinked = true;
                }
                linkMap[row.qonto_id].linkedTo.push(row.transaction_id);
                linkMap[row.qonto_id].linkIds.push(row.id);
            });

            resolve(linkMap);
        });
    });
}

/**
 * Upsert a Qonto transaction into the cache
 * @param {object} qontoData - Qonto transaction data from API
 * @returns {Promise<number>} - Transaction ID
 */
function upsertQontoTransaction(qontoData) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

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

        db.run(sql, params, function(err) {
            db.close();
            if (err) {
                return reject(err);
            }
            resolve(this.lastID);
        });
    });
}

/**
 * Get Qonto transactions from cache with optional filters
 * @param {object} filters - Optional filters
 * @returns {Promise<array>}
 */
function getQontoTransactions(filters = {}) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

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

        db.all(sql, params, (err, rows) => {
            db.close();
            if (err) {
                return reject(err);
            }
            resolve(rows || []);
        });
    });
}

/**
 * Get a single Qonto transaction by Qonto ID
 * @param {string} qontoId
 * @returns {Promise<object|null>}
 */
function getQontoTransactionByQontoId(qontoId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        db.get(
            'SELECT * FROM qonto_transactions WHERE qonto_id = ?',
            [qontoId],
            (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(row || null);
            }
        );
    });
}

/**
 * Get the last sync date (most recent settled_at from cached transactions)
 * @returns {Promise<string|null>}
 */
function getLastSyncDate() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        db.get(
            'SELECT MAX(settled_at) as last_sync_date FROM qonto_transactions',
            [],
            (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(row && row.last_sync_date ? row.last_sync_date : null);
            }
        );
    });
}

/**
 * Get the last sync timestamp from qonto_organizations
 * @returns {Promise<string|null>}
 */
function getLastSyncTimestamp() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        db.get(
            'SELECT last_sync_at FROM qonto_organizations ORDER BY last_sync_at DESC LIMIT 1',
            [],
            (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(row && row.last_sync_at ? row.last_sync_at : null);
            }
        );
    });
}

/**
 * Update the last sync timestamp
 * @param {string} syncDate - ISO date string
 * @returns {Promise<void>}
 */
function updateLastSyncDate(syncDate) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        // Upsert into qonto_organizations (we'll use a default org for now)
        const sql = `
            INSERT INTO qonto_organizations (id, organization_slug, last_sync_date, last_sync_at)
            VALUES (1, 'default', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                last_sync_date = excluded.last_sync_date,
                last_sync_at = CURRENT_TIMESTAMP
        `;

        db.run(sql, [syncDate], function(err) {
            db.close();
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}

/**
 * Get total count of cached Qonto transactions
 * @returns {Promise<number>}
 */
function getQontoTransactionCount() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        db.get(
            'SELECT COUNT(*) as count FROM qonto_transactions',
            [],
            (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(row ? row.count : 0);
            }
        );
    });
}

/**
 * Get the oldest cached Qonto transaction
 * @returns {Promise<object|null>}
 */
function getOldestQontoTransaction() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        db.get(
            'SELECT * FROM qonto_transactions ORDER BY settled_at ASC LIMIT 1',
            [],
            (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(row || null);
            }
        );
    });
}

/**
 * Get the newest cached Qonto transaction
 * @returns {Promise<object|null>}
 */
function getNewestQontoTransaction() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        db.get(
            'SELECT * FROM qonto_transactions ORDER BY settled_at DESC LIMIT 1',
            [],
            (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(row || null);
            }
        );
    });
}

/**
 * Clear all cached Qonto transactions
 * @returns {Promise<void>}
 */
function clearQontoCache() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        db.run('DELETE FROM qonto_transactions', [], function(err) {
            if (err) {
                db.close();
                return reject(err);
            }

            db.run('DELETE FROM qonto_organizations', [], function(err) {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    });
}

/**
 * Compute how much of a Qonto transaction is allocated across all links
 * @param {string} qontoId - Qonto transaction UUID
 * @returns {Promise<{allocated: number, available: number, qontoAmount: number, links: array}>}
 */
function getQontoAllocationByQontoId(qontoId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                return reject(err);
            }
        });

        // Get all links for this Qonto transaction
        db.all(
            `SELECT qtl.*, t.amount as website_amount, t.type as website_type
             FROM qonto_transaction_links qtl
             LEFT JOIN transactions t ON qtl.transaction_id = t.id
             WHERE qtl.qonto_id = ?`,
            [qontoId],
            (err, links) => {
                if (err) {
                    db.close();
                    return reject(err);
                }

                // Get the Qonto transaction amount
                db.get(
                    'SELECT amount FROM qonto_transactions WHERE qonto_id = ?',
                    [qontoId],
                    (err, qontoTx) => {
                        db.close();
                        if (err) {
                            return reject(err);
                        }

                        const qontoAmount = qontoTx ? qontoTx.amount : 0;
                        const qontoAbsAmount = Math.abs(qontoAmount);

                        // Sum allocated amounts (use absolute values since we're tracking capacity)
                        const allocated = links.reduce((sum, link) => {
                            return sum + Math.abs(link.allocated_amount || link.qonto_amount || 0);
                        }, 0);

                        const available = qontoAbsAmount - allocated;

                        resolve({
                            allocated,
                            available,
                            qontoAmount,
                            links
                        });
                    }
                );
            }
        );
    });
}

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
