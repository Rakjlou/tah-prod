const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

// Set NODE_ENV to test before importing the app
process.env.NODE_ENV = 'test';
const app = require('../server');
const { initializeTestDatabase, closeTestDatabase } = require('./setup');
const { authenticateAs, createTestTransaction, getTestTransaction } = require('./helpers');

describe('Transactions - Admin Operations', () => {
    let db, testData;
    let adminAgent;

    before(async () => {
        const result = await initializeTestDatabase();
        db = result.db;
        testData = result.data;

        // Authenticate admin
        adminAgent = await authenticateAs(app, 'admin', 'admin123');
    });

    after(async () => {
        await closeTestDatabase(db);
    });

    describe('View All Transactions', () => {
        it('should show admin all band transactions', async () => {
            // Create transactions for both bands
            await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Band 1 Transaction'
            });
            await createTestTransaction(db, testData.bands.band2Id, {
                description: 'Band 2 Transaction'
            });

            const res = await adminAgent
                .get('/admin/transactions')
                .expect(200);

            assert.ok(res.text.includes('Band 1 Transaction'));
            assert.ok(res.text.includes('Band 2 Transaction'));
        });
    });

    describe('Edit Any Transaction', () => {
        it('should allow admin to edit pending transaction', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Admin Edit Pending',
                amount: 100,
                status: 'pending'
            });

            await adminAgent
                .post(`/admin/transactions/${txId}/edit`)
                .type('form')
                .send({
                    type: 'expense',
                    amount: '200.00',
                    category_id: testData.categories.equipment,
                    description: 'Admin Updated Pending',
                    transaction_date: '2025-01-30'
                })
                .expect(302);

            const updated = await getTestTransaction(db, txId);
            assert.strictEqual(updated.description, 'Admin Updated Pending');
            assert.strictEqual(updated.amount, 200);
        });

        it('should allow admin to edit validated transaction', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Admin Edit Validated',
                amount: 300,
                status: 'validated'
            });

            await adminAgent
                .post(`/admin/transactions/${txId}/edit`)
                .type('form')
                .send({
                    type: 'income',
                    amount: '400.00',
                    category_id: testData.categories.concerts,
                    description: 'Admin Updated Validated',
                    transaction_date: '2025-02-01'
                })
                .expect(302);

            const updated = await getTestTransaction(db, txId);
            assert.strictEqual(updated.description, 'Admin Updated Validated');
            assert.strictEqual(updated.amount, 400);
        });

        it('should allow admin to change transaction status', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Status Change Test',
                status: 'pending'
            });

            await adminAgent
                .post(`/admin/transactions/${txId}/edit`)
                .type('form')
                .send({
                    type: 'expense',
                    amount: '100.00',
                    category_id: testData.categories.equipment,
                    description: 'Status Change Test',
                    status: 'validated',
                    transaction_date: '2025-02-05'
                })
                .expect(302);

            const updated = await getTestTransaction(db, txId);
            assert.strictEqual(updated.status, 'validated');
        });

        it('should allow admin to clear transaction date', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Clear Date Test',
                transaction_date: '2025-01-15'
            });

            await adminAgent
                .post(`/admin/transactions/${txId}/edit`)
                .type('form')
                .send({
                    type: 'expense',
                    amount: '100.00',
                    category_id: testData.categories.equipment,
                    description: 'Clear Date Test',
                    clear_date: 'true'
                })
                .expect(302);

            const updated = await getTestTransaction(db, txId);
            assert.strictEqual(updated.transaction_date, null);
        });
    });

    describe('Validate Transaction', () => {
        it('should validate a pending transaction', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'To Be Validated',
                status: 'pending'
            });

            await adminAgent
                .post(`/admin/transactions/${txId}/validate`)
                .type('form')
                .send({ transaction_date: '2025-02-10' })
                .expect(302);

            const validated = await getTestTransaction(db, txId);
            assert.strictEqual(validated.status, 'validated');
            assert.strictEqual(validated.transaction_date, '2025-02-10');
            assert.ok(validated.validated_at);
            assert.strictEqual(validated.validated_by, testData.users.adminId);
        });

        it('should not re-validate already validated transaction', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Already Validated',
                status: 'validated'
            });

            await adminAgent
                .post(`/admin/transactions/${txId}/validate`)
                .type('form')
                .send({ transaction_date: '2025-02-12' })
                .expect(302); // Should redirect with error
        });
    });

    describe('Delete Any Transaction', () => {
        it('should allow admin to delete pending transaction', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Admin Delete Pending',
                status: 'pending'
            });

            await adminAgent
                .post(`/admin/transactions/${txId}/delete`)
                .expect(302);

            const deleted = await getTestTransaction(db, txId);
            assert.strictEqual(deleted, undefined);
        });

        it('should allow admin to delete validated transaction', async () => {
            const txId = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Admin Delete Validated',
                status: 'validated'
            });

            await adminAgent
                .post(`/admin/transactions/${txId}/delete`)
                .expect(302);

            const deleted = await getTestTransaction(db, txId);
            assert.strictEqual(deleted, undefined);
        });

        it('should allow admin to delete any band transaction', async () => {
            const txId = await createTestTransaction(db, testData.bands.band2Id, {
                description: 'Band 2 Transaction - Admin Delete'
            });

            await adminAgent
                .post(`/admin/transactions/${txId}/delete`)
                .expect(302);

            const deleted = await getTestTransaction(db, txId);
            assert.strictEqual(deleted, undefined);
        });
    });

    describe('View Transaction Details', () => {
        it('should view any band transaction detail', async () => {
            const tx1 = await createTestTransaction(db, testData.bands.band1Id, {
                description: 'Band 1 Detail'
            });
            const tx2 = await createTestTransaction(db, testData.bands.band2Id, {
                description: 'Band 2 Detail'
            });

            const res1 = await adminAgent
                .get(`/admin/transactions/${tx1}`)
                .expect(200);
            assert.ok(res1.text.includes('Band 1 Detail'));

            const res2 = await adminAgent
                .get(`/admin/transactions/${tx2}`)
                .expect(200);
            assert.ok(res2.text.includes('Band 2 Detail'));
        });
    });
});
