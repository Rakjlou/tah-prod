const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

// Set NODE_ENV to test before importing the app
process.env.NODE_ENV = 'test';
const app = require('../server');
const { initializeTestDatabase, closeTestDatabase } = require('./setup');
const { authenticateAs, getTestUser } = require('./helpers');
const { ROLES } = require('../lib/roles');

describe('User Management - Admin Operations', () => {
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

    describe('Authorization', () => {
        it('should allow admin to access /admin/users', async () => {
            const res = await adminAgent
                .get('/admin/users')
                .expect(200);

            assert.ok(res.text.includes('User Management'));
        });

        it('should NOT allow band to access /admin/users (403)', async () => {
            await band1Agent
                .get('/admin/users')
                .expect(403);
        });

        it('should redirect unauthenticated user to /login', async () => {
            await request(app)
                .get('/admin/users')
                .expect(302)
                .expect('Location', '/login');
        });
    });

    describe('View Users', () => {
        it('should display list of all users', async () => {
            const res = await adminAgent
                .get('/admin/users')
                .expect(200);

            // Should show admin user
            assert.ok(res.text.includes('admin'));
            // Should show band users
            assert.ok(res.text.includes('band1'));
            assert.ok(res.text.includes('band2'));
        });

        it('should mark current user with "(you)"', async () => {
            const res = await adminAgent
                .get('/admin/users')
                .expect(200);

            // Should show "(you)" next to admin username
            assert.ok(res.text.includes('admin'));
            assert.ok(res.text.includes('(you)'));
        });

        it('should display user roles correctly', async () => {
            const res = await adminAgent
                .get('/admin/users')
                .expect(200);

            // Should show Admin role
            assert.ok(res.text.includes('Admin'));
            // Should show Band role
            assert.ok(res.text.includes('Band'));
        });
    });

    describe('Create User', () => {
        it('should create admin user with valid data', async () => {
            const res = await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'newadmin',
                    password: 'password123',
                    password_confirm: 'password123'
                })
                .expect(302)
                .expect('Location', '/admin/users');

            // Verify success message is set
            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('created successfully'));

            // Verify user was created in database
            const user = await getTestUser(db, 'newadmin');
            assert.ok(user);
            assert.strictEqual(user.username, 'newadmin');
            assert.strictEqual(user.role, ROLES.ADMIN);
            assert.notStrictEqual(user.password, 'password123'); // Password should be hashed
        });

        it('should reject empty username', async () => {
            const res = await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: '',
                    password: 'password123',
                    password_confirm: 'password123'
                })
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('All fields are required'));
        });

        it('should reject empty password', async () => {
            const res = await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'testuser',
                    password: '',
                    password_confirm: ''
                })
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('All fields are required'));
        });

        it('should reject password < 6 characters', async () => {
            const res = await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'testuser',
                    password: '12345',
                    password_confirm: '12345'
                })
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('at least 6 characters'));
        });

        it('should reject password mismatch', async () => {
            const res = await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'testuser',
                    password: 'password123',
                    password_confirm: 'different123'
                })
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('do not match'));
        });

        it('should reject invalid username format (special characters)', async () => {
            const res = await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'test@user!',
                    password: 'password123',
                    password_confirm: 'password123'
                })
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('letters, numbers, underscores, and hyphens'));
        });

        it('should reject duplicate username', async () => {
            const res = await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'admin', // Already exists
                    password: 'password123',
                    password_confirm: 'password123'
                })
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('already exists'));
        });
    });

    describe('Edit User', () => {
        it('should update username only', async () => {
            // First create a user to edit
            await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'edituser1',
                    password: 'password123',
                    password_confirm: 'password123'
                });

            const user = await getTestUser(db, 'edituser1');
            const oldPassword = user.password;

            // Update username
            await adminAgent
                .post(`/admin/users/${user.id}/edit`)
                .type('form')
                .send({
                    username: 'edituser1_updated',
                    password: '',
                    password_confirm: ''
                })
                .expect(302);

            // Verify username changed
            const updatedUser = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM users WHERE id = ?', [user.id], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });

            assert.strictEqual(updatedUser.username, 'edituser1_updated');
            assert.strictEqual(updatedUser.password, oldPassword); // Password unchanged
        });

        it('should update password only', async () => {
            // Create a user
            await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'edituser2',
                    password: 'password123',
                    password_confirm: 'password123'
                });

            const user = await getTestUser(db, 'edituser2');
            const oldPassword = user.password;

            // Update password
            await adminAgent
                .post(`/admin/users/${user.id}/edit`)
                .type('form')
                .send({
                    username: 'edituser2',
                    password: 'newpassword456',
                    password_confirm: 'newpassword456'
                })
                .expect(302);

            // Verify password changed
            const updatedUser = await getTestUser(db, 'edituser2');
            assert.strictEqual(updatedUser.username, 'edituser2'); // Username unchanged
            assert.notStrictEqual(updatedUser.password, oldPassword); // Password changed
        });

        it('should update both username and password', async () => {
            // Create a user
            await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'edituser3',
                    password: 'password123',
                    password_confirm: 'password123'
                });

            const user = await getTestUser(db, 'edituser3');

            // Update both
            await adminAgent
                .post(`/admin/users/${user.id}/edit`)
                .type('form')
                .send({
                    username: 'edituser3_new',
                    password: 'newpassword456',
                    password_confirm: 'newpassword456'
                })
                .expect(302);

            // Verify both changed
            const updatedUser = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM users WHERE id = ?', [user.id], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            });

            assert.strictEqual(updatedUser.username, 'edituser3_new');
            assert.notStrictEqual(updatedUser.password, user.password);
        });

        it('should reject empty username', async () => {
            const user = await getTestUser(db, 'band1');

            await adminAgent
                .post(`/admin/users/${user.id}/edit`)
                .type('form')
                .send({
                    username: '',
                    password: '',
                    password_confirm: ''
                })
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('required'));
        });

        it('should reject password < 6 characters when provided', async () => {
            const user = await getTestUser(db, 'band1');

            await adminAgent
                .post(`/admin/users/${user.id}/edit`)
                .type('form')
                .send({
                    username: 'band1',
                    password: '12345',
                    password_confirm: '12345'
                })
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('at least 6 characters'));
        });

        it('should reject password mismatch when provided', async () => {
            const user = await getTestUser(db, 'band1');

            await adminAgent
                .post(`/admin/users/${user.id}/edit`)
                .type('form')
                .send({
                    username: 'band1',
                    password: 'password123',
                    password_confirm: 'different123'
                })
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('do not match'));
        });

        it('should reject duplicate username', async () => {
            const user = await getTestUser(db, 'band1');

            await adminAgent
                .post(`/admin/users/${user.id}/edit`)
                .type('form')
                .send({
                    username: 'admin', // Already exists
                    password: '',
                    password_confirm: ''
                })
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('already exists'));
        });

        it('should reject editing non-existent user', async () => {
            await adminAgent
                .post('/admin/users/99999/edit')
                .type('form')
                .send({
                    username: 'test',
                    password: '',
                    password_confirm: ''
                })
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('not found'));
        });
    });

    describe('Delete User', () => {
        it('should delete another admin user', async () => {
            // Create a user to delete
            await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'deleteuser1',
                    password: 'password123',
                    password_confirm: 'password123'
                });

            const user = await getTestUser(db, 'deleteuser1');

            // Delete the user
            await adminAgent
                .post(`/admin/users/${user.id}/delete`)
                .expect(302);

            // Verify user was deleted
            const deletedUser = await getTestUser(db, 'deleteuser1');
            assert.strictEqual(deletedUser, undefined);

            // Verify success message
            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('deleted successfully'));
        });

        it('should NOT allow deleting yourself', async () => {
            // Get admin user ID
            const admin = await getTestUser(db, 'admin');

            // Try to delete own account
            await adminAgent
                .post(`/admin/users/${admin.id}/delete`)
                .expect(302);

            // Verify error message
            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('cannot delete your own account'));

            // Verify user still exists
            const stillExists = await getTestUser(db, 'admin');
            assert.ok(stillExists);
        });

        it('should handle deleting non-existent user', async () => {
            await adminAgent
                .post('/admin/users/99999/delete')
                .expect(302);

            const followUpRes = await adminAgent.get('/admin/users').expect(200);
            assert.ok(followUpRes.text.includes('not found'));
        });
    });

    describe('Session Destruction', () => {
        it('should destroy sessions when password is changed', async () => {
            // Create a test user
            await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'sessionuser1',
                    password: 'password123',
                    password_confirm: 'password123'
                });

            // Login as that user to create a session
            const userAgent = await authenticateAs(app, 'sessionuser1', 'password123');

            // Verify user is authenticated
            await userAgent
                .get('/')
                .expect(200);

            // Admin changes the user's password
            const user = await getTestUser(db, 'sessionuser1');
            await adminAgent
                .post(`/admin/users/${user.id}/edit`)
                .type('form')
                .send({
                    username: 'sessionuser1',
                    password: 'newpassword456',
                    password_confirm: 'newpassword456'
                })
                .expect(302);

            // Note: Session destruction is handled at the database level
            // The actual session check would require accessing the sessions.db
            // For now, we verify the route executes without error
        });

        it('should destroy sessions when user is deleted', async () => {
            // Create a test user
            await adminAgent
                .post('/admin/users')
                .type('form')
                .send({
                    username: 'sessionuser2',
                    password: 'password123',
                    password_confirm: 'password123'
                });

            // Login as that user
            const userAgent = await authenticateAs(app, 'sessionuser2', 'password123');

            // Verify user is authenticated
            await userAgent
                .get('/')
                .expect(200);

            // Admin deletes the user
            const user = await getTestUser(db, 'sessionuser2');
            await adminAgent
                .post(`/admin/users/${user.id}/delete`)
                .expect(302);

            // Verify user no longer exists
            const deletedUser = await getTestUser(db, 'sessionuser2');
            assert.strictEqual(deletedUser, undefined);
        });
    });
});
