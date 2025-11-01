const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'tahprod.db');

/**
 * Create a link between a TAH transaction and a Qonto transaction
 * @param {number} transactionId - TAH transaction ID
 * @param {object} qontoData - Qonto transaction data
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
                linked_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            transactionId,
            qontoData.id,
            qontoData.transaction_id,
            qontoData.amount,
            qontoData.currency,
            qontoData.settled_at,
            qontoData.label,
            qontoData.reference || null,
            qontoData.note || null,
            qontoData.qonto_web_url || null,
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

module.exports = {
    createLink,
    deleteLink,
    getLinkedTransactions,
    isQontoLinked,
    checkMultipleLinks
};
