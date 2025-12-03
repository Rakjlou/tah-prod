const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { hashPassword } = require('../lib/auth');
const { ROLES } = require('../lib/roles');
const {
    createTestUser,
    createTestBand,
    createTestCategory
} = require('./helpers');

const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'tahprod.test.db');

/**
 * Create a test SQLite database with the full schema
 * Deletes existing test database if it exists
 * @returns {Promise<sqlite3.Database>} Configured database instance
 */
async function createTestDatabase() {
    // Ensure data directory exists
    const dataDir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Delete existing test database if it exists
    if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
    }

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(TEST_DB_PATH);

        // Enable foreign keys
        db.run('PRAGMA foreign_keys = ON', (err) => {
            if (err) {
                db.close();
                return reject(err);
            }

            // Create all tables in sequence
            createTables(db)
                .then(() => resolve(db))
                .catch(err => {
                    db.close();
                    reject(err);
                });
        });
    });
}

/**
 * Create all tables in the test database
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<void>}
 */
async function createTables(db) {
    const tables = [
        // Users table
        `CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE UNIQUE INDEX idx_users_username ON users(username)`,

        // Config table
        `CREATE TABLE config (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE UNIQUE INDEX idx_config_key ON config(key)`,

        // Bands table
        `CREATE TABLE bands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            user_id INTEGER UNIQUE NOT NULL,
            folder_id TEXT UNIQUE,
            accounting_spreadsheet_id TEXT UNIQUE,
            invoices_folder_id TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`,
        `CREATE UNIQUE INDEX idx_bands_folder_id ON bands(folder_id)`,
        `CREATE UNIQUE INDEX idx_bands_accounting_spreadsheet_id ON bands(accounting_spreadsheet_id)`,
        `CREATE UNIQUE INDEX idx_bands_user_id ON bands(user_id)`,

        // Transaction categories table
        `CREATE TABLE transaction_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'both'))
        )`,

        // Transactions table
        `CREATE TABLE transactions (
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
        )`,

        // Transaction documents table
        `CREATE TABLE transaction_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            drive_file_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
        )`,

        // Qonto transactions table
        `CREATE TABLE qonto_transactions (
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
            fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,

        // Qonto transactions indices
        `CREATE INDEX idx_qonto_transactions_settled_at ON qonto_transactions(settled_at DESC)`,
        `CREATE INDEX idx_qonto_transactions_qonto_id ON qonto_transactions(qonto_id)`,

        // Qonto transaction links table
        `CREATE TABLE qonto_transaction_links (
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
        )`,

        // Invoices table
        `CREATE TABLE invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            band_id INTEGER NOT NULL,
            invoice_number TEXT UNIQUE NOT NULL,
            issue_date TEXT NOT NULL,
            service_date TEXT,
            client_name TEXT NOT NULL,
            client_address TEXT NOT NULL,
            client_siret TEXT,
            total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
            status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'paid', 'cancelled')),
            notes TEXT,
            transaction_id INTEGER,
            payment_delay_text TEXT,
            late_penalty_text TEXT,
            recovery_fee_text TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE,
            FOREIGN KEY (transaction_id) REFERENCES transactions(id)
        )`,
        `CREATE INDEX idx_invoices_band_id ON invoices(band_id)`,
        `CREATE INDEX idx_invoices_status ON invoices(status)`,
        `CREATE UNIQUE INDEX idx_invoices_number ON invoices(invoice_number)`,

        // Invoice items table
        `CREATE TABLE invoice_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            description TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 1 CHECK(quantity > 0),
            unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price >= 0),
            total REAL NOT NULL DEFAULT 0 CHECK(total >= 0),
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        )`,
        `CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id)`
    ];

    for (const sql of tables) {
        await new Promise((resolve, reject) => {
            db.run(sql, err => {
                if (err) return reject(err);
                resolve();
            });
        });
    }
}

/**
 * Seed the test database with default data
 * Creates: 1 admin, 2 bands, default categories
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<Object>} Seeded data (userIds, bandIds, categoryIds)
 */
async function seedTestData(db) {
    // Create admin user (admin has both ADMIN and BAND roles)
    const adminId = await createTestUser(db, 'admin', 'admin123', ROLES.ADMIN | ROLES.BAND);

    // Create two band users
    const band1UserId = await createTestUser(db, 'band1', 'band1pass', ROLES.BAND);
    const band2UserId = await createTestUser(db, 'band2', 'band2pass', ROLES.BAND);

    // Create two bands
    const band1Id = await createTestBand(db, band1UserId, 'Test Band 1', 'band1@test.com');
    const band2Id = await createTestBand(db, band2UserId, 'Test Band 2', 'band2@test.com');

    // Create default categories
    const categoryIds = {
        gear: await createTestCategory(db, 'Gear', 'expense'),
        travel: await createTestCategory(db, 'Travel', 'expense'),
        marketing: await createTestCategory(db, 'Marketing', 'expense'),
        studio: await createTestCategory(db, 'Studio', 'expense'),
        musicRevenue: await createTestCategory(db, 'Music revenue', 'income'),
        merchandising: await createTestCategory(db, 'Merchandising', 'both'),
        gig: await createTestCategory(db, 'Gig', 'both'),
        other: await createTestCategory(db, 'Other', 'both')
    };

    return {
        users: {
            adminId,
            band1UserId,
            band2UserId
        },
        bands: {
            band1Id,
            band2Id
        },
        categories: categoryIds
    };
}

/**
 * Load Google OAuth configuration from production database or env
 * @returns {Promise<Object|null>} OAuth config or null if not available
 */
async function loadGoogleOAuthConfig() {
    try {
        // Try to load from .env.test first
        if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
            return {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
                refreshToken: process.env.GOOGLE_REFRESH_TOKEN || null
            };
        }

        // Try to load from production database
        const path = require('path');
        const fs = require('fs');
        const prodDbPath = path.join(__dirname, '..', 'data', 'tahprod.db');

        if (!fs.existsSync(prodDbPath)) {
            return null;
        }

        return new Promise((resolve, reject) => {
            const prodDb = new sqlite3.Database(prodDbPath);

            const config = {};

            prodDb.get('SELECT value FROM config WHERE key = ?', ['google_client_id'], (err, row) => {
                if (err) {
                    prodDb.close();
                    return reject(err);
                }

                config.clientId = row ? row.value : null;

                prodDb.get('SELECT value FROM config WHERE key = ?', ['google_client_secret'], (err, row) => {
                    if (err) {
                        prodDb.close();
                        return reject(err);
                    }

                    config.clientSecret = row ? row.value : null;

                    prodDb.get('SELECT value FROM config WHERE key = ?', ['google_redirect_uri'], (err, row) => {
                        if (err) {
                            prodDb.close();
                            return reject(err);
                        }

                        config.redirectUri = row ? row.value : null;

                        prodDb.get('SELECT value FROM config WHERE key = ?', ['google_refresh_token'], (err, row) => {
                            if (err) {
                                prodDb.close();
                                return reject(err);
                            }

                            config.refreshToken = row ? row.value : null;

                            // Also load google_drive_folder_id (required for band creation)
                            prodDb.get('SELECT value FROM config WHERE key = ?', ['google_drive_folder_id'], (err, row) => {
                                prodDb.close();

                                if (err) return reject(err);

                                config.driveFolderId = row ? row.value : null;

                                // Only return config if we have the essentials
                                if (config.clientId && config.clientSecret && config.redirectUri) {
                                    resolve(config);
                                } else {
                                    resolve(null);
                                }
                            });
                        });
                    });
                });
            });
        });
    } catch (error) {
        console.warn('Could not load Google OAuth config:', error.message);
        return null;
    }
}

/**
 * Save Google OAuth config to test database
 * @param {sqlite3.Database} db - Database instance
 * @param {Object} config - OAuth configuration
 * @returns {Promise<void>}
 */
async function saveGoogleOAuthConfig(db, config) {
    const keys = {
        google_client_id: config.clientId,
        google_client_secret: config.clientSecret,
        google_redirect_uri: config.redirectUri
    };

    if (config.refreshToken) {
        keys.google_refresh_token = config.refreshToken;
    }

    if (config.driveFolderId) {
        keys.google_drive_folder_id = config.driveFolderId;
    }

    for (const [key, value] of Object.entries(keys)) {
        if (!value) continue;

        await new Promise((resolve, reject) => {
            db.run(
                'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime("now"))',
                [key, value],
                err => {
                    if (err) return reject(err);
                    resolve();
                }
            );
        });
    }
}

/**
 * Initialize a complete test database with schema and seed data
 * @returns {Promise<{db: sqlite3.Database, data: Object}>} Database and seeded data
 */
async function initializeTestDatabase() {
    const db = await createTestDatabase();
    const data = await seedTestData(db);

    // Try to load and save Google OAuth config
    const oauthConfig = await loadGoogleOAuthConfig();
    if (oauthConfig) {
        await saveGoogleOAuthConfig(db, oauthConfig);
        data.googleOAuth = oauthConfig;
    }

    return { db, data };
}

/**
 * Close and clean up a test database
 * @param {sqlite3.Database} db - Database to close
 * @returns {Promise<void>}
 */
async function closeTestDatabase(db) {
    return new Promise((resolve, reject) => {
        db.close(err => {
            if (err) return reject(err);
            resolve();
        });
    });
}

module.exports = {
    createTestDatabase,
    seedTestData,
    loadGoogleOAuthConfig,
    saveGoogleOAuthConfig,
    initializeTestDatabase,
    closeTestDatabase
};
