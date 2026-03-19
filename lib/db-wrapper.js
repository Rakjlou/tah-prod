const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_FILENAME = process.env.NODE_ENV === 'test' ? 'tahprod.test.db' : 'tahprod.db';
const DB_PATH = path.join(__dirname, '..', 'data', DB_FILENAME);

// Singleton connection with WAL mode for better concurrent read performance
let db = null;

function getConnection() {
    if (!db) {
        db = new sqlite3.Database(DB_PATH);
        db.run('PRAGMA foreign_keys = ON');
    }
    return db;
}

function enableWAL() {
    return new Promise((resolve, reject) => {
        getConnection().run('PRAGMA journal_mode = WAL', (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function closeConnection() {
    if (db) {
        db.close();
        db = null;
    }
}

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        getConnection().run(sql, params, function(err) {
            if (err) return reject(err);
            resolve({
                lastID: this.lastID,
                changes: this.changes
            });
        });
    });
}

function getOne(sql, params = []) {
    return new Promise((resolve, reject) => {
        getConnection().get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function getAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        getConnection().all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

function runTransaction(operations) {
    return new Promise((resolve, reject) => {
        const conn = getConnection();

        conn.serialize(() => {
            conn.run('BEGIN TRANSACTION', (err) => {
                if (err) return reject(err);

                const executeNext = (index) => {
                    if (index >= operations.length) {
                        conn.run('COMMIT', (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                        return;
                    }

                    const op = operations[index];
                    conn.run(op.sql, op.params || [], (err) => {
                        if (err) {
                            conn.run('ROLLBACK', () => reject(err));
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

function runSequential(operations) {
    return new Promise((resolve, reject) => {
        const conn = getConnection();
        let index = 0;

        const executeNext = () => {
            if (index >= operations.length) {
                return resolve();
            }

            const op = operations[index];
            conn.run(op.sql, op.params || [], (err) => {
                if (err) return reject(err);
                index++;
                executeNext();
            });
        };

        executeNext();
    });
}

function getDatabasePath() {
    return DB_PATH;
}

// For rare cases where a separate connection is needed (e.g., sessions DB)
function createConnection() {
    const conn = new sqlite3.Database(DB_PATH);
    conn.run('PRAGMA foreign_keys = ON');
    return conn;
}

module.exports = {
    createConnection,
    getConnection,
    closeConnection,
    enableWAL,
    runQuery,
    getOne,
    getAll,
    runTransaction,
    runSequential,
    getDatabasePath
};
