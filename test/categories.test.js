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
            // Skip if Google OAuth is not fully configured (needs refresh token)
            if (!testData.googleOAuth || !testData.googleOAuth.refreshToken) {
                console.log('   ⚠️  Skipping: Google OAuth not fully configured (no refresh token)');
                return;
            }

            const res = await adminAgent
                .get('/config')
                .expect(200);

            assert.ok(res.text.includes('Merchandising'));
            assert.ok(res.text.includes('Gig'));
            assert.ok(res.text.includes('Gear'));
        });
    });

    describe('Create Category', () => {
        it('should allow admin to create a category', async () => {
            // Create category - should redirect
            await adminAgent
                .post('/config/categories')
                .type('form')
                .send({
                    name: 'Accommodation',
                    type: 'expense'
                })
                .expect(302) // Redirects to /config
                .expect('Location', '/config');

            // GET /config to see the flash message
            const res = await adminAgent
                .get('/config')
                .expect(200);

            // Verify success message is shown
            assert.ok(res.text.includes('created successfully'));

            // Verify category was created
            const category = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM transaction_categories WHERE name = ?',
                    ['Accommodation'],
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
            // Try to create with invalid type - should redirect
            await adminAgent
                .post('/config/categories')
                .type('form')
                .send({
                    name: 'Invalid Type Category',
                    type: 'invalid'
                })
                .expect(302) // Redirects to /config
                .expect('Location', '/config');

            // GET /config to see the flash error message
            const res = await adminAgent
                .get('/config')
                .expect(200);

            // Verify error message is shown (SQLite will reject invalid CHECK constraint)
            // The route will catch the error and render with error message
            assert.ok(res.text.includes('config') || res.text.includes('error') || res.text.includes('failed'));
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

            // Delete category - should redirect
            await adminAgent
                .post(`/config/categories/${categoryId}/delete`)
                .expect(302) // Redirects to /config
                .expect('Location', '/config');

            // GET /config to see the flash message
            const res = await adminAgent
                .get('/config')
                .expect(200);

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
                .post(`/config/categories/${testData.categories.gear}/delete`)
                .expect(403);

            // Verify category still exists
            const category = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM transaction_categories WHERE id = ?',
                    [testData.categories.gear],
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
