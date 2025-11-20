const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

// Set NODE_ENV to test before importing the app
process.env.NODE_ENV = 'test';
const app = require('../server');
const { initializeTestDatabase, closeTestDatabase } = require('./setup');
const { authenticateAs, createTestTransaction, getTestTransaction } = require('./helpers');

describe('Transactions - Cross-Band Access Control', () => {
    let db, testData;
    let band1Agent, band2Agent;
    let band1TransactionId, band2TransactionId;

    before(async () => {
        const result = await initializeTestDatabase();
        db = result.db;
        testData = result.data;

        // Authenticate both bands
        band1Agent = await authenticateAs(app, 'band1', 'band1pass');
        band2Agent = await authenticateAs(app, 'band2', 'band2pass');

        // Create transactions for both bands
        band1TransactionId = await createTestTransaction(db, testData.bands.band1Id, {
            description: 'Band 1 Private Transaction',
            status: 'pending'
        });

        band2TransactionId = await createTestTransaction(db, testData.bands.band2Id, {
            description: 'Band 2 Private Transaction',
            status: 'pending'
        });
    });

    after(async () => {
        await closeTestDatabase(db);
    });

    describe('View Restrictions', () => {
        it('should NOT allow band1 to view band2 transaction detail', async () => {
            await band1Agent
                .get(`/transactions/${band2TransactionId}`)
                .expect(302); // Redirects with error
        });

        it('should NOT allow band2 to view band1 transaction detail', async () => {
            await band2Agent
                .get(`/transactions/${band1TransactionId}`)
                .expect(302); // Redirects with error
        });

        it('should allow band to view their own transaction', async () => {
            await band1Agent
                .get(`/transactions/${band1TransactionId}`)
                .expect(200);

            await band2Agent
                .get(`/transactions/${band2TransactionId}`)
                .expect(200);
        });
    });

    describe('Edit Restrictions', () => {
        it('should NOT allow band1 to edit band2 transaction', async () => {
            const originalTx = await getTestTransaction(db, band2TransactionId);

            await band1Agent
                .post(`/transactions/${band2TransactionId}/edit`)
                .type('form')
                .send({
                    type: 'expense',
                    amount: '999.99',
                    category_id: testData.categories.gear,
                    description: 'Attempting to hijack band2 transaction',
                    transaction_date: '2025-01-01'
                })
                .expect(302); // Redirects with error

            // Verify transaction was NOT modified
            const currentTx = await getTestTransaction(db, band2TransactionId);
            assert.strictEqual(currentTx.description, originalTx.description);
            assert.strictEqual(currentTx.amount, originalTx.amount);
        });

        it('should NOT allow band2 to edit band1 transaction', async () => {
            const originalTx = await getTestTransaction(db, band1TransactionId);

            await band2Agent
                .post(`/transactions/${band1TransactionId}/edit`)
                .type('form')
                .send({
                    type: 'income',
                    amount: '888.88',
                    category_id: testData.categories.gig,
                    description: 'Attempting to hijack band1 transaction',
                    transaction_date: '2025-01-01'
                })
                .expect(302); // Redirects with error

            // Verify transaction was NOT modified
            const currentTx = await getTestTransaction(db, band1TransactionId);
            assert.strictEqual(currentTx.description, originalTx.description);
            assert.strictEqual(currentTx.amount, originalTx.amount);
        });
    });

    describe('Delete Restrictions', () => {
        it('should NOT allow band1 to delete band2 transaction', async () => {
            // Should get 404 or 302 (not found or redirect)
            const res = await band1Agent
                .post(`/transactions/${band2TransactionId}/delete`);

            assert.ok(res.status === 404 || res.status === 302);

            // Verify transaction still exists
            const tx = await getTestTransaction(db, band2TransactionId);
            assert.ok(tx);
        });

        it('should NOT allow band2 to delete band1 transaction', async () => {
            // Should get 404 or 302 (not found or redirect)
            const res = await band2Agent
                .post(`/transactions/${band1TransactionId}/delete`);

            assert.ok(res.status === 404 || res.status === 302);

            // Verify transaction still exists
            const tx = await getTestTransaction(db, band1TransactionId);
            assert.ok(tx);
        });
    });

    describe('Document Upload Restrictions', () => {
        it('should NOT allow band1 to upload documents to band2 transaction', async () => {
            await band1Agent
                .post(`/transactions/${band2TransactionId}/documents`)
                .attach('documents', Buffer.from('fake file'), 'malicious.pdf')
                .expect(302); // Redirects with error
        });

        it('should NOT allow band2 to upload documents to band1 transaction', async () => {
            await band2Agent
                .post(`/transactions/${band1TransactionId}/documents`)
                .attach('documents', Buffer.from('fake file'), 'malicious.pdf')
                .expect(302); // Redirects with error
        });
    });

    describe('Folder Creation Restrictions', () => {
        it('should NOT allow band1 to create folder for band2 transaction', async () => {
            await band1Agent
                .post(`/transactions/${band2TransactionId}/create-folder`)
                .expect(302); // Redirects with error
        });

        it('should NOT allow band2 to create folder for band1 transaction', async () => {
            await band2Agent
                .post(`/transactions/${band1TransactionId}/create-folder`)
                .expect(302); // Redirects with error
        });
    });

    describe('Non-existent Transaction', () => {
        it('should return 404 or redirect for non-existent transaction', async () => {
            const nonExistentId = 99999;

            const res = await band1Agent
                .get(`/transactions/${nonExistentId}`)
                .expect(302);

            // Should redirect to transaction list with error
            assert.ok(res.headers.location.includes('/transactions'));
        });
    });
});
