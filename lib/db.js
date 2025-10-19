const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'tahprod.db');

function getDatabase() {
    return new sqlite3.Database(DB_PATH);
}

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) {
                db.close();
                return reject(err);
            }

            db.run(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
                ON users(username)
            `, (err) => {
                if (err) {
                    db.close();
                    return reject(err);
                }

                db.run(`
                    CREATE TABLE IF NOT EXISTS config (
                        key TEXT PRIMARY KEY NOT NULL,
                        value TEXT,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) {
                        db.close();
                        return reject(err);
                    }

                    db.run(`
                        CREATE UNIQUE INDEX IF NOT EXISTS idx_config_key
                        ON config(key)
                    `, (err) => {
                        if (err) {
                            db.close();
                            return reject(err);
                        }

                        db.run(`
                            CREATE TABLE IF NOT EXISTS bands (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                name TEXT NOT NULL,
                                email TEXT NOT NULL,
                                spreadsheet_id TEXT UNIQUE,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                            )
                        `, (err) => {
                            if (err) {
                                db.close();
                                return reject(err);
                            }

                            db.run(`
                                CREATE UNIQUE INDEX IF NOT EXISTS idx_bands_spreadsheet_id
                                ON bands(spreadsheet_id)
                            `, (err) => {
                                db.close();
                                if (err) {
                                    return reject(err);
                                }
                                resolve();
                            });
                        });
                    });
                });
            });
        });
    });
}

function createUser(username, hashedPassword, role = 0) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
            [username, hashedPassword, role],
            function(err) {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(this.lastID);
            }
        );
    });
}

function getUserByUsername(username) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.get(
            'SELECT * FROM users WHERE username = ?',
            [username],
            (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(row);
            }
        );
    });
}

function getConfig(key) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.get(
            'SELECT value FROM config WHERE key = ?',
            [key],
            (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(row ? row.value : null);
            }
        );
    });
}

function setConfig(key, value) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [key, value],
            function(err) {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve();
            }
        );
    });
}

function getAllConfig() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.all(
            'SELECT key, value FROM config',
            [],
            (err, rows) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                const config = {};
                rows.forEach(row => {
                    config[row.key] = row.value;
                });
                resolve(config);
            }
        );
    });
}

function createBand(name, email, spreadsheetId) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'INSERT INTO bands (name, email, spreadsheet_id) VALUES (?, ?, ?)',
            [name, email, spreadsheetId],
            function(err) {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(this.lastID);
            }
        );
    });
}

function getBandById(id) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.get(
            'SELECT * FROM bands WHERE id = ?',
            [id],
            (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(row);
            }
        );
    });
}

function getAllBands() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.all(
            'SELECT * FROM bands ORDER BY created_at DESC',
            [],
            (err, rows) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(rows);
            }
        );
    });
}

function updateBand(id, updates) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const fields = [];
        const values = [];

        if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.email !== undefined) {
            fields.push('email = ?');
            values.push(updates.email);
        }
        if (updates.spreadsheet_id !== undefined) {
            fields.push('spreadsheet_id = ?');
            values.push(updates.spreadsheet_id);
        }

        if (fields.length === 0) {
            db.close();
            return resolve();
        }

        values.push(id);

        db.run(
            `UPDATE bands SET ${fields.join(', ')} WHERE id = ?`,
            values,
            function(err) {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve();
            }
        );
    });
}

function deleteBand(id) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'DELETE FROM bands WHERE id = ?',
            [id],
            function(err) {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve();
            }
        );
    });
}

module.exports = {
    getDatabase,
    initializeDatabase,
    createUser,
    getUserByUsername,
    getConfig,
    setConfig,
    getAllConfig,
    createBand,
    getBandById,
    getAllBands,
    updateBand,
    deleteBand
};
