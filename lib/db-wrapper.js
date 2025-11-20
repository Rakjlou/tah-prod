const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Use test database when NODE_ENV is 'test'
const DB_FILENAME = process.env.NODE_ENV === 'test' ? 'tahprod.test.db' : 'tahprod.db';
const DB_PATH = path.join(__dirname, '..', 'data', DB_FILENAME);

/**
 * Creates and returns a new database connection with foreign keys enabled
 * @returns {sqlite3.Database}
 */
function createConnection() {
    const db = new sqlite3.Database(DB_PATH);
    db.run('PRAGMA foreign_keys = ON');
    return db;
}

/**
 * Executes a SQL query that modifies data (INSERT, UPDATE, DELETE)
 * Returns the lastID for INSERT or number of changes
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<{lastID: number, changes: number}>}
 */
function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = createConnection();

        db.run(sql, params, function(err) {
            db.close();
            if (err) {
                return reject(err);
            }
            resolve({
                lastID: this.lastID,
                changes: this.changes
            });
        });
    });
}

/**
 * Executes a SELECT query and returns a single row
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<object|undefined>}
 */
function getOne(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = createConnection();

        db.get(sql, params, (err, row) => {
            db.close();
            if (err) {
                return reject(err);
            }
            resolve(row);
        });
    });
}

/**
 * Executes a SELECT query and returns all matching rows
 * @param {string} sql - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>}
 */
function getAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = createConnection();

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
 * Executes multiple SQL statements sequentially in a transaction
 * All operations succeed or all fail (atomic)
 * @param {Array<{sql: string, params: Array}>} operations - Array of SQL operations
 * @returns {Promise<void>}
 */
async function runTransaction(operations) {
    return new Promise((resolve, reject) => {
        const db = createConnection();

        db.serialize(() => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) {
                    db.close();
                    return reject(err);
                }

                let completed = 0;
                const total = operations.length;

                const executeNext = (index) => {
                    if (index >= total) {
                        db.run('COMMIT', (err) => {
                            db.close();
                            if (err) {
                                return reject(err);
                            }
                            resolve();
                        });
                        return;
                    }

                    const op = operations[index];
                    db.run(op.sql, op.params || [], (err) => {
                        if (err) {
                            db.run('ROLLBACK', () => {
                                db.close();
                                reject(err);
                            });
                            return;
                        }
                        executeNext(index + 1);
                    });
                };

                executeNext(0);
            });
        });
    });
}

/**
 * Executes multiple SQL statements sequentially (without transaction semantics)
 * Useful for schema creation where each statement should succeed independently
 * @param {Array<{sql: string, params: Array}>} operations - Array of SQL operations
 * @returns {Promise<void>}
 */
async function runSequential(operations) {
    return new Promise((resolve, reject) => {
        const db = createConnection();

        let index = 0;

        const executeNext = () => {
            if (index >= operations.length) {
                db.close();
                return resolve();
            }

            const op = operations[index];
            db.run(op.sql, op.params || [], (err) => {
                if (err) {
                    db.close();
                    return reject(err);
                }
                index++;
                executeNext();
            });
        };

        executeNext();
    });
}

/**
 * Get the database path (useful for testing)
 * @returns {string}
 */
function getDatabasePath() {
    return DB_PATH;
}

module.exports = {
    createConnection,
    runQuery,
    getOne,
    getAll,
    runTransaction,
    runSequential,
    getDatabasePath
};
