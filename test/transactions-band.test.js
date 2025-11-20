const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

// Set NODE_ENV to test before importing the app
process.env.NODE_ENV = 'test';
const app = require('../server');
const { initializeTestDatabase, closeTestDatabase } = require('./setup');
const { authenticateAs, createTestTransaction, getTestTransaction } = require('./helpers');

describe('Transactions - Band Operations', () => {
    let db, testData;
    let band1Agent, band2Agent;

    before(async () => {
        const result = await initializeTestDatabase();
        db = result.db;
        testData = result.data;

        // Authenticate both bands
        band1Agent = await authenticateAs(app, 'band1', 'band1pass');
        band2Agent = await authenticateAs(app, 'band2', 'band2pass');
    });

    after(async () => {
        await closeTestDatabase(db);
    });

    describe('View Transactions', () => {
        it('should show band their own transactions', async () => {
            // Create a transaction for band1
            await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Band 1 Test Transaction'
            });

            const res = await band1Agent
                .get('/transactions')
                .expect(200);

            assert.ok(res.text.includes('Band 1 Test Transaction'));
        });

        it('should not show other band transactions', async () => {
            // Create a transaction for band2
            await createTestTransaction(db, testData.bands.band2Id, {
                description: 'Band 2 Private Transaction'
            });

            const res = await band1Agent
                .get('/transactions')
                .expect(200);

            assert.ok(!res.text.includes('Band 2 Private Transaction'));
        });
    });

    describe('Create Transaction', () => {
        it('should create a new transaction successfully', async () => {
            const res = await band1Agent
                .post('/transactions')
                .field('type', 'income')
                .field('amount', '250.00')
                .field('category_id', testData.categories.gig)
                .field('description', 'Concert Revenue')
                .field('transaction_date', '2025-01-20')
                .expect(302);

            assert.ok(res.headers.location.includes('/transactions'));

            // Verify transaction was created
            const dbRes = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM transactions WHERE description = ? AND band_id = ?',
                    ['Concert Revenue', testData.bands.band1Id],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.ok(dbRes);
            assert.strictEqual(dbRes.type, 'income');
            assert.strictEqual(dbRes.amount, 250);
            assert.strictEqual(dbRes.status, 'pending');
        });

        it('should reject invalid transaction type', async () => {
            await band1Agent
                .post('/transactions')
                .field('type', 'invalid')
                .field('amount', '100')
                .field('category_id', testData.categories.gear)
                .field('description', 'Invalid Type')
                .field('transaction_date', '2025-01-20')
                .expect(302); // Should redirect with error
        });

        it('should reject negative amount', async () => {
            await band1Agent
                .post('/transactions')
                .field('type', 'expense')
                .field('amount', '-50')
                .field('category_id', testData.categories.gear)
                .field('description', 'Negative Amount')
                .field('transaction_date', '2025-01-20')
                .expect(302); // Should redirect with error
        });
    });

    describe('Edit Pending Transaction', () => {
        it('should allow band to edit their own pending transaction', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Original Description',
                amount: 100,
                status: 'pending'
            });

            await band1Agent
                .post(`/transactions/${txId}/edit`)
                .type('form')
                .send({
                    type: 'expense',
                    amount: '150.00',
                    category_id: testData.categories.gear,
                    description: 'Updated Description',
                    transaction_date: '2025-01-25'
                })
                .expect(302);

            const updated = await getTestTransaction(db, txId);
            assert.strictEqual(updated.description, 'Updated Description');
            assert.strictEqual(updated.amount, 150);
        });

        it('should NOT allow band to edit validated transaction', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Validated Transaction',
                status: 'validated'
            });

            const res = await band1Agent
                .post(`/transactions/${txId}/edit`)
                .type('form')
                .send({
                    type: 'expense',
                    amount: '200.00',
                    category_id: testData.categories.gear,
                    description: 'Attempting to edit validated',
                    transaction_date: '2025-01-25'
                })
                .expect(302);

            // Verify transaction was NOT updated
            const tx = await getTestTransaction(db, txId);
            assert.strictEqual(tx.description, 'Validated Transaction');
        });
    });

    describe('Delete Transaction', () => {
        it('should allow band to delete their own pending transaction', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'To Be Deleted',
                status: 'pending'
            });

            await band1Agent
                .post(`/transactions/${txId}/delete`)
                .expect(302);

            // Verify deletion
            const deleted = await getTestTransaction(db, txId);
            assert.strictEqual(deleted, undefined);
        });

        it('should NOT allow band to delete validated transaction', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Validated - Should Not Delete',
                status: 'validated'
            });

            await band1Agent
                .post(`/transactions/${txId}/delete`)
                .expect(302);

            // Verify NOT deleted
            const tx = await getTestTransaction(db, txId);
            assert.ok(tx); // Should still exist
        });
    });

    describe('View Transaction Details', () => {
        it('should view own transaction detail', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Detail View Test'
            });

            const res = await band1Agent
                .get(`/transactions/${txId}`)
                .expect(200);

            assert.ok(res.text.includes('Detail View Test'));
        });

        it('should NOT view other band transaction detail', async () => {
            const txId = await createTestTransaction(db, testData.bands.band2Id, {
                description: 'Band 2 Transaction'
            });

            await band1Agent
                .get(`/transactions/${txId}`)
                .expect(302); // Redirects with error (consistent with other access control tests)
        });
    });
});
