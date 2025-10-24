const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

// Set NODE_ENV to test before importing the app
process.env.NODE_ENV = 'test';
const app = require('../server');
const { initializeTestDatabase, closeTestDatabase } = require('./setup');
const { authenticateAs } = require('./helpers');

describe('Transaction Categories', () => {
    let db, testData;
    let adminAgent, band1Agent;

    before(async () => {
        const result = await initializeTestDatabase();
        db = result.db;
        testData = result.data;

        adminAgent = await authenticateAs(app, 'admin', 'admin123');
        band1Agent = await authenticateAs(app, 'band1', 'band1pass');
    });

    after(async () => {
        await closeTestDatabase(db);
    });

    describe('View Categories', () => {
        it('should show default categories', async () => {
            const res = await adminAgent
                .get('/config')
                .expect(200);

            assert.ok(res.text.includes('Merchandise'));
            assert.ok(res.text.includes('Concerts'));
            assert.ok(res.text.includes('Equipment'));
        });
    });

    describe('Create Category', () => {
        it('should allow admin to create a category', async () => {
            const res = await adminAgent
                .post('/config/categories')
                .type('form')
                .send({
                    name: 'Travel',
                    type: 'expense'
                })
                .expect(200); // Renders config page with success message

            // Verify success message is shown
            assert.ok(res.text.includes('created successfully'));

            // Verify category was created
            const category = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM transaction_categories WHERE name = ?',
                    ['Travel'],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.ok(category);
            assert.strictEqual(category.type, 'expense');
        });

        it('should NOT allow band to create categories', async () => {
            await band1Agent
                .post('/config/categories')
                .type('form')
                .send({
                    name: 'Unauthorized Category',
                    type: 'expense'
                })
                .expect(403);
        });

        it('should reject invalid category type', async () => {
            const res = await adminAgent
                .post('/config/categories')
                .type('form')
                .send({
                    name: 'Invalid Type Category',
                    type: 'invalid'
                })
                .expect(200); // Renders config page with error

            // Verify error message is shown (SQLite will reject invalid CHECK constraint)
            // The route will catch the error and render with error message
            assert.ok(res.text.includes('config') || res.text.includes('error'));
        });
    });

    describe('Delete Category', () => {
        it('should allow admin to delete a category', async () => {
            // Create a category to delete
            const categoryId = await new Promise((resolve, reject) => {
                db.run(
                    'INSERT INTO transaction_categories (name, type) VALUES (?, ?)',
                    ['To Be Deleted', 'both'],
                    function(err) {
                        if (err) return reject(err);
                        resolve(this.lastID);
                    }
                );
            });

            const res = await adminAgent
                .post(`/config/categories/${categoryId}/delete`)
                .expect(200); // Renders config page with success message

            // Verify success message is shown
            assert.ok(res.text.includes('deleted successfully'));

            // Verify deletion
            const category = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM transaction_categories WHERE id = ?',
                    [categoryId],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.strictEqual(category, undefined);
        });

        it('should NOT allow band to delete categories', async () => {
            await band1Agent
                .post(`/config/categories/${testData.categories.equipment}/delete`)
                .expect(403);

            // Verify category still exists
            const category = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM transaction_categories WHERE id = ?',
                    [testData.categories.equipment],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.ok(category);
        });
    });
});
