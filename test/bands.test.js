const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

// Set NODE_ENV to test before importing the app
process.env.NODE_ENV = 'test';
const app = require('../server');
const { initializeTestDatabase, closeTestDatabase } = require('./setup');
const { authenticateAs } = require('./helpers');

describe('Band Management - Admin Operations', () => {
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

    describe('View Bands', () => {
        it('should allow admin to view all bands', async () => {
            const res = await adminAgent
                .get('/bands')
                .expect(200);

            assert.ok(res.text.includes('Test Band 1'));
            assert.ok(res.text.includes('Test Band 2'));
        });

        it('should NOT allow band to view bands page', async () => {
            await band1Agent
                .get('/bands')
                .expect(403);
        });
    });

    describe('Create Band', () => {
        it('should allow admin to create and delete a band', async () => {
            // Create band
            const res = await adminAgent
                .post('/bands')
                .type('form')
                .send({
                    name: 'New Test Band',
                    email: 'newband@test.local' // Test email - skips Google Drive sharing
                })
                .expect(200); // Renders bands page with success message

            // Verify success message is shown
            assert.ok(res.text.includes('created successfully'));

            // Verify band was created
            const band = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM bands WHERE name = ?',
                    ['New Test Band'],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.ok(band);
            assert.strictEqual(band.email, 'newband@test.local');
            assert.ok(band.folder_id, 'Band should have a Google Drive folder');

            // Verify user was created
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM users WHERE id = ?',
                    [band.user_id],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.ok(user);
            assert.strictEqual(user.username, 'newband@test.local');

            // Now delete the band (cleanup + test delete functionality)
            const deleteRes = await adminAgent
                .post(`/admin/bands/${band.id}/delete`)
                .expect(200);

            assert.ok(deleteRes.text.includes('deleted'));

            // Verify band was deleted from database
            const deletedBand = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM bands WHERE id = ?',
                    [band.id],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.strictEqual(deletedBand, undefined, 'Band should be deleted from database');
        });

        it('should NOT allow band to create bands', async () => {
            await band1Agent
                .post('/bands')
                .type('form')
                .send({
                    name: 'Unauthorized Band',
                    email: 'unauthorized@test.com'
                })
                .expect(403);
        });
    });

    describe('Reset Band Password', () => {
        it('should allow admin to reset band password', async () => {
            const newPassword = 'newSecurePassword123';

            const res = await adminAgent
                .post(`/admin/bands/${testData.bands.band1Id}/reset-password`)
                .type('form')
                .send({ new_password: newPassword })
                .expect(200); // Renders bands page with success message

            // Verify success message is shown (contains the random generated password)
            assert.ok(res.text.includes('Password reset'));

            // Note: Cannot test new password login because password is randomly generated
            // and only shown in the HTML response (not easily parseable)
        });

        it('should NOT allow band to reset passwords', async () => {
            await band1Agent
                .post(`/admin/bands/${testData.bands.band2Id}/reset-password`)
                .type('form')
                .send({ new_password: 'hackedpassword' })
                .expect(403);
        });
    });

    describe('Delete Band', () => {
        it('should allow admin to delete a band', async () => {
            // Create a band to delete
            const userId = await new Promise((resolve, reject) => {
                db.run(
                    'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
                    ['deleteme@test.com', 'hashedpass', 2],
                    function(err) {
                        if (err) return reject(err);
                        resolve(this.lastID);
                    }
                );
            });

            const bandId = await new Promise((resolve, reject) => {
                db.run(
                    'INSERT INTO bands (name, email, user_id) VALUES (?, ?, ?)',
                    ['Delete Me Band', 'deleteme@test.com', userId],
                    function(err) {
                        if (err) return reject(err);
                        resolve(this.lastID);
                    }
                );
            });

            const res = await adminAgent
                .post(`/admin/bands/${bandId}/delete`)
                .expect(200); // Renders bands page with success message

            // Verify success message is shown
            assert.ok(res.text.includes('deleted'));

            // Verify band was deleted
            const band = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM bands WHERE id = ?',
                    [bandId],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.strictEqual(band, undefined);

            // Verify user was also deleted (cascade)
            const user = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM users WHERE id = ?',
                    [userId],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.strictEqual(user, undefined);
        });

        it('should NOT allow band to delete bands', async () => {
            await band1Agent
                .post(`/admin/bands/${testData.bands.band2Id}/delete`)
                .expect(403);

            // Verify band still exists
            const band = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT * FROM bands WHERE id = ?',
                    [testData.bands.band2Id],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            assert.ok(band);
        });
    });
});
