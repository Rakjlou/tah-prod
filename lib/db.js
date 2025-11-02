const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Use test database when NODE_ENV is 'test'
const DB_FILENAME = process.env.NODE_ENV === 'test' ? 'tahprod.test.db' : 'tahprod.db';
const DB_PATH = path.join(__dirname, '..', 'data', DB_FILENAME);

function getDatabase() {
    const db = new sqlite3.Database(DB_PATH);
    // Enable foreign key constraints (disabled by default in SQLite)
    db.run('PRAGMA foreign_keys = ON');
    return db;
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
                                user_id INTEGER UNIQUE NOT NULL,
                                folder_id TEXT UNIQUE,
                                accounting_spreadsheet_id TEXT UNIQUE,
                                invoices_folder_id TEXT UNIQUE,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                            )
                        `, (err) => {
                            if (err) {
                                db.close();
                                return reject(err);
                            }

                            db.run(`
                                CREATE UNIQUE INDEX IF NOT EXISTS idx_bands_folder_id
                                ON bands(folder_id)
                            `, (err) => {
                                if (err) {
                                    db.close();
                                    return reject(err);
                                }

                                db.run(`
                                    CREATE UNIQUE INDEX IF NOT EXISTS idx_bands_accounting_spreadsheet_id
                                    ON bands(accounting_spreadsheet_id)
                                `, (err) => {
                                    if (err) {
                                        db.close();
                                        return reject(err);
                                    }

                                    db.run(`
                                        CREATE UNIQUE INDEX IF NOT EXISTS idx_bands_user_id
                                        ON bands(user_id)
                                    `, (err) => {
                                        if (err) {
                                            db.close();
                                            return reject(err);
                                        }

                                        db.run(`
                                            CREATE TABLE IF NOT EXISTS transaction_categories (
                                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                name TEXT UNIQUE NOT NULL,
                                                type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'both'))
                                            )
                                        `, (err) => {
                                            if (err) {
                                                db.close();
                                                return reject(err);
                                            }

                                            db.run(`
                                                CREATE TABLE IF NOT EXISTS transactions (
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
                                                )
                                            `, (err) => {
                                                if (err) {
                                                    db.close();
                                                    return reject(err);
                                                }

                                                db.run(`
                                                    CREATE TABLE IF NOT EXISTS transaction_documents (
                                                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                        transaction_id INTEGER NOT NULL,
                                                        drive_file_id TEXT NOT NULL,
                                                        filename TEXT NOT NULL,
                                                        uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                                        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
                                                    )
                                                `, (err) => {
                                                    if (err) {
                                                        db.close();
                                                        return reject(err);
                                                    }

                                                    db.run(`
                                                        CREATE TABLE IF NOT EXISTS qonto_organizations (
                                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                            organization_slug TEXT NOT NULL UNIQUE,
                                                            bank_account_slug TEXT,
                                                            last_sync_date TEXT,
                                                            last_sync_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                                            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                        )
                                                    `, (err) => {
                                                        if (err) {
                                                            db.close();
                                                            return reject(err);
                                                        }

                                                        db.run(`
                                                            CREATE TABLE IF NOT EXISTS qonto_transactions (
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
                                                                fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                                                FOREIGN KEY (organization_id) REFERENCES qonto_organizations(id)
                                                            )
                                                        `, (err) => {
                                                            if (err) {
                                                                db.close();
                                                                return reject(err);
                                                            }

                                                            db.run(`
                                                                CREATE INDEX IF NOT EXISTS idx_qonto_transactions_settled_at
                                                                ON qonto_transactions(settled_at DESC)
                                                            `, (err) => {
                                                                if (err) {
                                                                    db.close();
                                                                    return reject(err);
                                                                }

                                                                db.run(`
                                                                    CREATE INDEX IF NOT EXISTS idx_qonto_transactions_qonto_id
                                                                    ON qonto_transactions(qonto_id)
                                                                `, (err) => {
                                                                    if (err) {
                                                                        db.close();
                                                                        return reject(err);
                                                                    }

                                                                    db.run(`
                                                                        CREATE TABLE IF NOT EXISTS qonto_transaction_links (
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
                                                                        )
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
                                        });
                                    });
                                });
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

function getUserById(id) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.get(
            'SELECT * FROM users WHERE id = ?',
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

function createBand(name, email, userId, folderId, accountingSpreadsheetId, invoicesFolderId) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'INSERT INTO bands (name, email, user_id, folder_id, accounting_spreadsheet_id, invoices_folder_id) VALUES (?, ?, ?, ?, ?, ?)',
            [name, email, userId, folderId, accountingSpreadsheetId, invoicesFolderId],
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

function getBandByUserId(userId) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.get(
            'SELECT * FROM bands WHERE user_id = ?',
            [userId],
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

function updateUserPassword(userId, hashedPassword) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedPassword, userId],
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

function deleteUser(userId) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'DELETE FROM users WHERE id = ?',
            [userId],
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
        if (updates.folder_id !== undefined) {
            fields.push('folder_id = ?');
            values.push(updates.folder_id);
        }
        if (updates.accounting_spreadsheet_id !== undefined) {
            fields.push('accounting_spreadsheet_id = ?');
            values.push(updates.accounting_spreadsheet_id);
        }
        if (updates.invoices_folder_id !== undefined) {
            fields.push('invoices_folder_id = ?');
            values.push(updates.invoices_folder_id);
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

function createCategory(name, type) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'INSERT INTO transaction_categories (name, type) VALUES (?, ?)',
            [name, type],
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

function getAllCategories() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.all(
            'SELECT * FROM transaction_categories ORDER BY name ASC',
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

function getCategoriesByType(type) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.all(
            'SELECT * FROM transaction_categories WHERE type = ? OR type = ? ORDER BY name ASC',
            [type, 'both'],
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

function updateCategory(id, updates) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const fields = [];
        const values = [];

        if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.type !== undefined) {
            fields.push('type = ?');
            values.push(updates.type);
        }

        if (fields.length === 0) {
            db.close();
            return resolve();
        }

        values.push(id);

        db.run(
            `UPDATE transaction_categories SET ${fields.join(', ')} WHERE id = ?`,
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

function deleteCategory(id) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'DELETE FROM transaction_categories WHERE id = ?',
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

async function seedDefaultCategories() {
    const existing = await getAllCategories();
    if (existing.length > 0) {
        return; // Already seeded
    }

    const defaultCategories = [
        // Expenses
        { name: 'Equipment', type: 'expense' },
        { name: 'Marketing', type: 'expense' },
        { name: 'Travel', type: 'expense' },
        { name: 'Venue', type: 'expense' },
        { name: 'Other Expenses', type: 'expense' },
        // Income
        { name: 'Performance', type: 'income' },
        { name: 'Merchandise', type: 'income' },
        { name: 'Recording', type: 'income' },
        { name: 'Other Income', type: 'income' }
    ];

    for (const category of defaultCategories) {
        await createCategory(category.name, category.type);
    }
}

function createTransaction(bandId, type, amount, categoryId, description) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'INSERT INTO transactions (band_id, type, amount, category_id, description) VALUES (?, ?, ?, ?, ?)',
            [bandId, type, amount, categoryId, description],
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

function getTransactionById(id) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.get(
            `SELECT t.*, c.name as category_name, b.name as band_name
             FROM transactions t
             LEFT JOIN transaction_categories c ON t.category_id = c.id
             LEFT JOIN bands b ON t.band_id = b.id
             WHERE t.id = ?`,
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

function getTransactionsByBand(bandId, statusFilter = null) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
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

        db.all(query, params, (err, rows) => {
            db.close();
            if (err) {
                return reject(err);
            }
            resolve(rows);
        });
    });
}

function getAllTransactionsWithBands(bandIdFilter = null, statusFilter = null) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
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

        db.all(query, params, (err, rows) => {
            db.close();
            if (err) {
                return reject(err);
            }
            resolve(rows);
        });
    });
}

function updateTransaction(id, updates) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        const fields = [];
        const values = [];

        if (updates.type !== undefined) {
            fields.push('type = ?');
            values.push(updates.type);
        }
        if (updates.amount !== undefined) {
            fields.push('amount = ?');
            values.push(updates.amount);
        }
        if (updates.category_id !== undefined) {
            fields.push('category_id = ?');
            values.push(updates.category_id);
        }
        if (updates.description !== undefined) {
            fields.push('description = ?');
            values.push(updates.description);
        }
        if (updates.status !== undefined) {
            fields.push('status = ?');
            values.push(updates.status);
        }
        if (updates.transaction_date !== undefined) {
            fields.push('transaction_date = ?');
            values.push(updates.transaction_date);
        }
        if (updates.drive_folder_id !== undefined) {
            fields.push('drive_folder_id = ?');
            values.push(updates.drive_folder_id);
        }

        if (fields.length === 0) {
            db.close();
            return resolve();
        }

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        db.run(
            `UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`,
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

function deleteTransaction(id) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'DELETE FROM transactions WHERE id = ?',
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

function validateTransaction(id, validatedBy, transactionDate) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            `UPDATE transactions
             SET status = 'validated',
                 validated_at = CURRENT_TIMESTAMP,
                 validated_by = ?,
                 transaction_date = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [validatedBy, transactionDate, id],
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

function getBalanceForBand(bandId) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.get(
            `SELECT
                SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
                SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expense
             FROM transactions
             WHERE band_id = ? AND status = 'validated'`,
            [bandId],
            (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                const balance = (row.total_income || 0) - (row.total_expense || 0);
                resolve(balance);
            }
        );
    });
}

function addTransactionDocument(transactionId, driveFileId, filename) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'INSERT INTO transaction_documents (transaction_id, drive_file_id, filename) VALUES (?, ?, ?)',
            [transactionId, driveFileId, filename],
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

function getTransactionDocuments(transactionId) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.all(
            'SELECT * FROM transaction_documents WHERE transaction_id = ? ORDER BY uploaded_at DESC',
            [transactionId],
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

function deleteTransactionDocument(id) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'DELETE FROM transaction_documents WHERE id = ?',
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
    getUserById,
    updateUserPassword,
    deleteUser,
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
    deleteTransactionDocument
};
