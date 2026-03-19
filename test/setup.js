const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { ROLES } = require('../lib/roles');
const { closeConnection } = require('../lib/db-wrapper');
const { initializeDatabase } = require('../lib/db');
const {
    createTestUser,
    createTestBand,
    createTestCategory
} = require('./helpers');

const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'tahprod.test.db');

async function createTestDatabase() {
    const dataDir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
    }

    // Reset the singleton connection so it picks up the fresh DB file
    closeConnection();

    // Use the app's schema (single source of truth)
    await initializeDatabase();

    // Return a raw connection for test-specific operations (seeding, verification)
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(TEST_DB_PATH);
        db.run('PRAGMA foreign_keys = ON', (err) => {
            if (err) {
                db.close();
                return reject(err);
            }
            resolve(db);
        });
    });
}

async function seedTestData(db) {
    const adminId = await createTestUser(db, 'admin', 'admin123', ROLES.ADMIN | ROLES.BAND);
    const band1UserId = await createTestUser(db, 'band1', 'band1pass', ROLES.BAND);
    const band2UserId = await createTestUser(db, 'band2', 'band2pass', ROLES.BAND);

    const band1Id = await createTestBand(db, band1UserId, 'Test Band 1', 'band1@test.com');
    const band2Id = await createTestBand(db, band2UserId, 'Test Band 2', 'band2@test.com');

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
        users: { adminId, band1UserId, band2UserId },
        bands: { band1Id, band2Id },
        categories: categoryIds
    };
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

async function loadGoogleOAuthConfig() {
    try {
        // Start with env vars, then fill gaps from the production database
        const config = {
            clientId: process.env.GOOGLE_CLIENT_ID || null,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
            redirectUri: process.env.GOOGLE_REDIRECT_URI || null,
            refreshToken: process.env.GOOGLE_REFRESH_TOKEN || null,
            driveFolderId: null
        };

        const prodDbPath = path.join(__dirname, '..', 'data', 'tahprod.db');
        if (fs.existsSync(prodDbPath)) {
            const prodDb = new sqlite3.Database(prodDbPath);
            try {
                const dbKeys = {
                    clientId: 'google_client_id',
                    clientSecret: 'google_client_secret',
                    redirectUri: 'google_redirect_uri',
                    refreshToken: 'google_refresh_token',
                    driveFolderId: 'google_drive_folder_id'
                };

                for (const [field, key] of Object.entries(dbKeys)) {
                    if (!config[field]) {
                        config[field] = (await dbGet(prodDb, 'SELECT value FROM config WHERE key = ?', [key]))?.value || null;
                    }
                }
            } finally {
                prodDb.close();
            }
        }

        if (config.clientId && config.clientSecret && config.redirectUri) {
            return config;
        }
        return null;
    } catch (error) {
        console.warn('Could not load Google OAuth config:', error.message);
        return null;
    }
}

async function saveGoogleOAuthConfig(db, config) {
    const keys = {
        google_client_id: config.clientId,
        google_client_secret: config.clientSecret,
        google_redirect_uri: config.redirectUri
    };

    if (config.refreshToken) keys.google_refresh_token = config.refreshToken;
    if (config.driveFolderId) keys.google_drive_folder_id = config.driveFolderId;

    for (const [key, value] of Object.entries(keys)) {
        if (!value) continue;
        await new Promise((resolve, reject) => {
            db.run(
                'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime("now"))',
                [key, value],
                err => err ? reject(err) : resolve()
            );
        });
    }
}

async function initializeTestDatabase() {
    const db = await createTestDatabase();
    const data = await seedTestData(db);

    const oauthConfig = await loadGoogleOAuthConfig();
    if (oauthConfig) {
        await saveGoogleOAuthConfig(db, oauthConfig);
        data.googleOAuth = oauthConfig;
    }

    return { db, data };
}

async function closeTestDatabase(db) {
    return new Promise((resolve, reject) => {
        db.close(err => err ? reject(err) : resolve());
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
