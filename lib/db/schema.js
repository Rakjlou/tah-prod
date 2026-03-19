const { runSequential } = require('../db-wrapper');

const SCHEMA_OPERATIONS = [
    {
        sql: `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_config_key ON config(key)`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS bands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            user_id INTEGER UNIQUE NOT NULL,
            folder_id TEXT UNIQUE,
            accounting_spreadsheet_id TEXT UNIQUE,
            invoices_folder_id TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_bands_folder_id ON bands(folder_id)`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_bands_accounting_spreadsheet_id ON bands(accounting_spreadsheet_id)`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_bands_user_id ON bands(user_id)`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS transaction_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'both'))
        )`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS transactions (
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
        )`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS transaction_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            drive_file_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
        )`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS qonto_transactions (
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
        )`
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS idx_qonto_transactions_settled_at ON qonto_transactions(settled_at DESC)`
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS idx_qonto_transactions_qonto_id ON qonto_transactions(qonto_id)`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS qonto_transaction_links (
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
        )`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            band_id INTEGER NOT NULL,
            invoice_number TEXT UNIQUE NOT NULL,
            issue_date TEXT NOT NULL,
            service_date TEXT,
            client_name TEXT NOT NULL,
            client_address TEXT NOT NULL,
            client_siret TEXT,
            total_amount REAL NOT NULL CHECK(total_amount >= 0),
            status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'paid', 'cancelled')),
            notes TEXT,
            transaction_id INTEGER,
            payment_delay_text TEXT,
            late_penalty_text TEXT,
            recovery_fee_text TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE,
            FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
        )`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number)`
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS idx_invoices_band_id ON invoices(band_id)`
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS invoice_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            description TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 1 CHECK(quantity > 0),
            unit_price REAL NOT NULL CHECK(unit_price >= 0),
            total REAL NOT NULL CHECK(total >= 0),
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
        )`
    },
    {
        sql: `CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id)`
    },
    {
        sql: `CREATE TABLE IF NOT EXISTS band_credentials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            band_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE
        )`
    },
    {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_band_credentials_username ON band_credentials(username)`
    }
];

async function initializeDatabase() {
    return runSequential(SCHEMA_OPERATIONS);
}

module.exports = { SCHEMA_OPERATIONS, initializeDatabase };
