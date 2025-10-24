const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

// Set NODE_ENV to test before importing the app
process.env.NODE_ENV = 'test';
const app = require('../server');
const { initializeTestDatabase, closeTestDatabase } = require('./setup');
const { authenticateAs, createTestTransaction } = require('./helpers');
const { google } = require('googleapis');
const googleAuth = require('../lib/google-auth');

// Google is configured if we loaded it from the database during setup
let GOOGLE_CONFIGURED = false;

describe('Google Drive & Sheets Integration', () => {
    let db, testData;
    let adminAgent;

    before(async () => {
        const result = await initializeTestDatabase();
        db = result.db;
        testData = result.data;

        // Check if Google OAuth was loaded from database
        GOOGLE_CONFIGURED = Boolean(testData.googleOAuth && testData.googleOAuth.refreshToken);

        if (!GOOGLE_CONFIGURED) {
            console.log('\n⚠️  Skipping Google integration tests: OAuth not configured in database');
            console.log('   testData.googleOAuth:', testData.googleOAuth);
            console.log('   Authenticate via the web interface first, then tests will run\n');
            return;
        }

        console.log('✅ Google OAuth configured, running integration tests');

        adminAgent = await authenticateAs(app, 'admin', 'admin123');
    });

    after(async () => {
        if (db) {
            await closeTestDatabase(db);
        }
    });

    describe('Google OAuth', () => {
        it('should have OAuth configuration loaded from database', async () => {
            if (!GOOGLE_CONFIGURED) return;

            assert.ok(testData.googleOAuth.clientId, 'Should have client ID');
            assert.ok(testData.googleOAuth.clientSecret, 'Should have client secret');
            assert.ok(testData.googleOAuth.refreshToken, 'Should have refresh token');
        });

        it('should be able to get authenticated client', async () => {
            if (!GOOGLE_CONFIGURED) return;

            const client = await googleAuth.getAuthenticatedClient();
            assert.ok(client, 'Should get OAuth client');
        });
    });

    describe('Band Creation with Google Drive', () => {
        let testBandId, testBandFolderId, testBandSheetId;

        it('should create Google Drive folder structure for new band', async () => {
            if (!GOOGLE_CONFIGURED) return;
            // Create a test band
            const res = await adminAgent
                .post('/bands')
                .type('form')
                .send({
                    name: 'Google Test Band',
                    email: 'googletest@test.local' // test.local skips sharing
                })
                .expect(200);

            assert.ok(res.text.includes('created successfully'));

            // Get the band from database
            const band = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM bands WHERE name = ?',
                    ['Google Test Band'],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.ok(band, 'Band should be created');
            assert.ok(band.folder_id, 'Band should have folder_id');
            assert.ok(band.accounting_spreadsheet_id, 'Band should have accounting spreadsheet');
            assert.ok(band.invoices_folder_id, 'Band should have invoices folder');

            testBandId = band.id;
            testBandFolderId = band.folder_id;
            testBandSheetId = band.accounting_spreadsheet_id;

            // Verify folder exists in Google Drive
            const authClient = await googleAuth.getAuthenticatedClient();
            const drive = google.drive({ version: 'v3', auth: authClient });

            const folderRes = await drive.files.get({
                fileId: band.folder_id,
                fields: 'id, name, mimeType'
            });

            assert.strictEqual(folderRes.data.name, 'Tah Prod - Google Test Band');
            assert.strictEqual(folderRes.data.mimeType, 'application/vnd.google-apps.folder');
        });

        it('should create Google Sheet for band accounting', async () => {
            if (!GOOGLE_CONFIGURED) return;
            // Verify spreadsheet exists and has correct structure
            const authClient = await googleAuth.getAuthenticatedClient();
            const sheets = google.sheets({ version: 'v4', auth: authClient });

            const spreadsheetRes = await sheets.spreadsheets.get({
                spreadsheetId: testBandSheetId
            });

            assert.strictEqual(spreadsheetRes.data.properties.title, 'Accounting');
            assert.ok(spreadsheetRes.data.sheets.length > 0, 'Should have at least one sheet');
            assert.strictEqual(spreadsheetRes.data.sheets[0].properties.title, 'Transactions');

            // Verify headers are present
            const headersRes = await sheets.spreadsheets.values.get({
                spreadsheetId: testBandSheetId,
                range: 'Transactions!A1:G1'
            });

            const expectedHeaders = ['Date', 'Type', 'Category', 'Description', 'Amount', 'Status', 'Documents'];
            assert.deepStrictEqual(headersRes.data.values[0], expectedHeaders);
        });

        after(async () => {
            // Clean up test band
            if (testBandId) {
                await adminAgent.post(`/admin/bands/${testBandId}/delete`);
            }
        });
    });

    describe('Transaction Documents', () => {
        let testBandId, testBandFolderId, testTransactionId;
        let bandAgent;

        before(async () => {
            if (!GOOGLE_CONFIGURED) return;

            // Create a test band for document operations
            await adminAgent
                .post('/bands')
                .type('form')
                .send({
                    name: 'Docs Test Band',
                    email: 'docstest@test.local'
                })
                .expect(200);

            const band = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM bands WHERE name = ?',
                    ['Docs Test Band'],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            testBandId = band.id;
            testBandFolderId = band.folder_id;

            // Reset the password to something we know
            const { hashPassword } = require('../lib/auth');
            const hashedPassword = await hashPassword('testpass123');
            const { updateUserPassword } = require('../lib/db');
            await updateUserPassword(band.user_id, hashedPassword);

            // Authenticate as the band
            bandAgent = await authenticateAs(app, 'docstest@test.local', 'testpass123');

            // Create a transaction for the band
            testTransactionId = await createTestTransaction(db, testBandId, {
                description: 'Document Test Transaction',
                amount: 100,
                status: 'pending'
            });
        });

        it('should upload document to Google Drive via website API', async () => {
            if (!GOOGLE_CONFIGURED) return;

            // Upload a document via the website API
            const uploadRes = await adminAgent
                .post(`/admin/transactions/${testTransactionId}/documents`)
                .attach('documents', Buffer.from('Test document content'), 'test.txt')
                .expect(302);

            // Verify redirect indicates success
            assert.ok(uploadRes.headers.location.includes(`/admin/transactions/${testTransactionId}`));

            // Get the transaction to check drive_folder_id was set
            const transaction = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM transactions WHERE id = ?',
                    [testTransactionId],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.ok(transaction.drive_folder_id, 'Transaction should have drive_folder_id after upload');

            // Verify folder exists in Google Drive
            const authClient = await googleAuth.getAuthenticatedClient();
            const drive = google.drive({ version: 'v3', auth: authClient });

            const folderRes = await drive.files.get({
                fileId: transaction.drive_folder_id,
                fields: 'id, name, mimeType, parents'
            });

            assert.strictEqual(folderRes.data.mimeType, 'application/vnd.google-apps.folder');

            // Transaction folder should be inside the "Transactions" folder, which is inside the band folder
            // Let's verify it's nested correctly by checking if parent exists
            assert.ok(folderRes.data.parents && folderRes.data.parents.length > 0, 'Transaction folder should have a parent');

            // List files in the transaction folder
            const filesRes = await drive.files.list({
                q: `'${transaction.drive_folder_id}' in parents`,
                fields: 'files(id, name)'
            });

            assert.ok(filesRes.data.files.length > 0, 'Should have uploaded file(s)');
            const uploadedFile = filesRes.data.files.find(f => f.name === 'test.txt');
            assert.ok(uploadedFile, 'Should find test.txt in transaction folder');
        });

        it('should create transaction folder on first upload', async () => {
            if (!GOOGLE_CONFIGURED) return;

            // Create another transaction
            const txId = await createTestTransaction(db, testBandId, {
                description: 'Folder Creation Test',
                amount: 50,
                status: 'pending'
            });

            // Verify transaction has no drive_folder_id initially
            let transaction = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM transactions WHERE id = ?', [txId], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });

            assert.strictEqual(transaction.drive_folder_id, null, 'Should have no folder initially');

            // Upload first document
            await adminAgent
                .post(`/admin/transactions/${txId}/documents`)
                .attach('documents', Buffer.from('First doc'), 'first.txt')
                .expect(302);

            // Verify folder was created
            transaction = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM transactions WHERE id = ?', [txId], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });

            assert.ok(transaction.drive_folder_id, 'Should have drive_folder_id after first upload');

            // Verify folder exists in Google Drive
            const authClient = await googleAuth.getAuthenticatedClient();
            const drive = google.drive({ version: 'v3', auth: authClient });

            const folderRes = await drive.files.get({
                fileId: transaction.drive_folder_id,
                fields: 'name'
            });

            // Folder name format is: {id}_{first_3_words_lowercase}
            // e.g., "123_folder_creation_test"
            assert.ok(folderRes.data.name.includes('folder_creation_test'), 'Folder name should include first 3 words of description');
        });

        it('should delete document from Google Drive via website API', async () => {
            if (!GOOGLE_CONFIGURED) return;

            // Create a new transaction
            const txId = await createTestTransaction(db, testBandId, {
                description: 'Delete Document Test',
                amount: 75,
                status: 'pending'
            });

            // Upload a document
            await adminAgent
                .post(`/admin/transactions/${txId}/documents`)
                .attach('documents', Buffer.from('Document to delete'), 'deleteme.txt')
                .expect(302);

            // Get the transaction to find the drive_folder_id and document
            let transaction = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM transactions WHERE id = ?', [txId], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });

            assert.ok(transaction.drive_folder_id, 'Should have folder after upload');

            // Get the document from database
            const { getTransactionDocuments } = require('../lib/db');
            const documents = await getTransactionDocuments(txId);
            assert.ok(documents.length > 0, 'Should have uploaded document');
            const doc = documents[0];

            // Verify document exists in Google Drive
            const authClient = await googleAuth.getAuthenticatedClient();
            const drive = google.drive({ version: 'v3', auth: authClient });

            let fileExists = true;
            try {
                await drive.files.get({ fileId: doc.drive_file_id });
            } catch (err) {
                fileExists = false;
            }
            assert.ok(fileExists, 'Document should exist in Google Drive before deletion');

            // Delete the document via website API
            await adminAgent
                .post(`/admin/transactions/${txId}/documents/${doc.id}/delete`)
                .expect(302);

            // Verify document removed from database
            const docsAfterDelete = await getTransactionDocuments(txId);
            assert.strictEqual(docsAfterDelete.length, 0, 'Document should be removed from database');

            // Verify document deleted from Google Drive
            let fileExistsAfterDelete = true;
            try {
                await drive.files.get({ fileId: doc.drive_file_id });
            } catch (err) {
                if (err.code === 404) {
                    fileExistsAfterDelete = false;
                }
            }
            assert.strictEqual(fileExistsAfterDelete, false, 'Document should be deleted from Google Drive');
        });

        after(async () => {
            // Clean up test band
            if (testBandId) {
                await adminAgent.post(`/admin/bands/${testBandId}/delete`);
            }
        });
    });

    describe('Google Sheets Sync', () => {
        let testBandId, testBandSheetId;
        let bandAgent;

        before(async () => {
            if (!GOOGLE_CONFIGURED) return;

            // Create a test band for sheets sync
            await adminAgent
                .post('/bands')
                .type('form')
                .send({
                    name: 'Sheets Sync Band',
                    email: 'sheetsync@test.local'
                })
                .expect(200);

            const band = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM bands WHERE name = ?',
                    ['Sheets Sync Band'],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            testBandId = band.id;
            testBandSheetId = band.accounting_spreadsheet_id;

            // Reset the password to something we know
            const { hashPassword } = require('../lib/auth');
            const hashedPassword = await hashPassword('testpass123');
            const { updateUserPassword } = require('../lib/db');
            await updateUserPassword(band.user_id, hashedPassword);

            // Authenticate as the band
            bandAgent = await authenticateAs(app, 'sheetsync@test.local', 'testpass123');
        });

        it('should sync transactions to Google Sheets when created', async () => {
            if (!GOOGLE_CONFIGURED) return;

            // Create a transaction via website API as the band
            const res = await bandAgent
                .post('/transactions')
                .type('form')
                .send({
                    type: 'income',
                    amount: '500.00',
                    category_id: testData.categories.concerts,
                    description: 'Sheets Sync Test Income',
                    transaction_date: '2025-01-15'
                })
                .expect(302);

            // Wait a bit for sync (if async)
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify transaction appears in Google Sheet
            const authClient = await googleAuth.getAuthenticatedClient();
            const sheets = google.sheets({ version: 'v4', auth: authClient });

            const dataRes = await sheets.spreadsheets.values.get({
                spreadsheetId: testBandSheetId,
                range: 'Transactions!A2:G' // Skip header row
            });

            const rows = dataRes.data.values || [];
            const syncedRow = rows.find(row => row[3] === 'Sheets Sync Test Income'); // Description is in column D (index 3)

            assert.ok(syncedRow, 'Transaction should appear in Google Sheet');
            assert.strictEqual(syncedRow[1], 'Income', 'Type should be Income (capitalized)');
            assert.strictEqual(syncedRow[4], '500', 'Amount should match');
        });

        it('should update sheet when transaction is validated', async () => {
            if (!GOOGLE_CONFIGURED) return;

            // Create a pending transaction
            const txId = await createTestTransaction(db, testBandId, {
                description: 'Validation Test Transaction',
                amount: 250,
                status: 'pending'
            });

            // Validate it via admin API
            await adminAgent
                .post(`/admin/transactions/${txId}/validate`)
                .type('form')
                .send({ transaction_date: '2025-01-20' })
                .expect(302);

            // Wait for sync
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify status updated in sheet
            const authClient = await googleAuth.getAuthenticatedClient();
            const sheets = google.sheets({ version: 'v4', auth: authClient });

            const dataRes = await sheets.spreadsheets.values.get({
                spreadsheetId: testBandSheetId,
                range: 'Transactions!A2:G'
            });

            const rows = dataRes.data.values || [];
            const validatedRow = rows.find(row => row[3] === 'Validation Test Transaction');

            assert.ok(validatedRow, 'Transaction should be in sheet');
            assert.strictEqual(validatedRow[5], 'Validated', 'Status should be Validated (capitalized)');
            assert.strictEqual(validatedRow[0], '2025-01-20', 'Date should be set');
        });

        it('should update sheet when transaction is deleted', async () => {
            if (!GOOGLE_CONFIGURED) return;

            // Create a transaction
            const txId = await createTestTransaction(db, testBandId, {
                description: 'Deletion Test Transaction',
                amount: 100,
                status: 'pending'
            });

            // Wait for initial sync
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Delete it
            await adminAgent
                .post(`/admin/transactions/${txId}/delete`)
                .expect(302);

            // Wait for sync
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify transaction removed from sheet
            const authClient = await googleAuth.getAuthenticatedClient();
            const sheets = google.sheets({ version: 'v4', auth: authClient });

            const dataRes = await sheets.spreadsheets.values.get({
                spreadsheetId: testBandSheetId,
                range: 'Transactions!A2:G'
            });

            const rows = dataRes.data.values || [];
            const deletedRow = rows.find(row => row[3] === 'Deletion Test Transaction');

            assert.strictEqual(deletedRow, undefined, 'Deleted transaction should not be in sheet');
        });

        after(async () => {
            // Clean up test band
            if (testBandId) {
                await adminAgent.post(`/admin/bands/${testBandId}/delete`);
            }
        });
    });
});
