const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

// Set NODE_ENV to test before importing the app
process.env.NODE_ENV = 'test';
const app = require('../server');
const { initializeTestDatabase, closeTestDatabase } = require('./setup');
const { authenticateAs } = require('./helpers');

describe('Authentication & Authorization', () => {
    let db, testData;

    before(async () => {
        const result = await initializeTestDatabase();
        db = result.db;
        testData = result.data;
    });

    after(async () => {
        await closeTestDatabase(db);
    });

    describe('Login', () => {
        it('should redirect to login page when not authenticated', async () => {
            await request(app)
                .get('/transactions')
                .expect(302)
                .expect('Location', '/login');
        });

        it('should login admin successfully', async () => {
            const res = await request(app)
                .post('/login')
                .type('form')
                .send({ login: 'admin', password: 'admin123' })
                .expect(302);

            assert.strictEqual(res.headers.location, '/');
        });

        it('should login band1 successfully', async () => {
            const res = await request(app)
                .post('/login')
                .type('form')
                .send({ login: 'band1', password: 'band1pass' })
                .expect(302);

            assert.strictEqual(res.headers.location, '/');
        });

        it('should reject invalid credentials', async () => {
            const res = await request(app)
                .post('/login')
                .type('form')
                .send({ login: 'admin', password: 'wrongpassword' })
                .expect(200); // Renders login page with error

            assert.ok(res.text.includes('Invalid credentials'));
        });

        it('should reject non-existent user', async () => {
            const res = await request(app)
                .post('/login')
                .type('form')
                .send({ login: 'nonexistent', password: 'password' })
                .expect(200); // Renders login page with error

            assert.ok(res.text.includes('Invalid credentials'));
        });
    });

    describe('Logout', () => {
        it('should logout successfully', async () => {
            const agent = await authenticateAs(app, 'admin', 'admin123');

            await agent
                .get('/logout')
                .expect(302)
                .expect('Location', '/');

            // Verify session is destroyed by trying to access protected route
            await agent
                .get('/config')
                .expect(302)
                .expect('Location', '/login');
        });
    });

    describe('Role-based Access Control', () => {
        it('should allow admin to access admin routes', async () => {
            const agent = await authenticateAs(app, 'admin', 'admin123');

            await agent
                .get('/config')
                .expect(200);

            await agent
                .get('/bands')
                .expect(200);
        });

        it('should deny band access to admin routes', async () => {
            const agent = await authenticateAs(app, 'band1', 'band1pass');

            await agent
                .get('/config')
                .expect(403);

            await agent
                .get('/bands')
                .expect(403);
        });

        it('should allow band to access band routes', async () => {
            const agent = await authenticateAs(app, 'band1', 'band1pass');

            await agent
                .get('/transactions')
                .expect(200);

            await agent
                .get('/account')
                .expect(200);
        });

        it('should allow admin to access both admin and band routes', async () => {
            const agent = await authenticateAs(app, 'admin', 'admin123');

            // Admin routes
            await agent
                .get('/config')
                .expect(200);

            // Admin can also access admin-specific transaction routes
            await agent
                .get('/admin/transactions')
                .expect(200);
        });
    });

    describe('Session Persistence', () => {
        it('should maintain session across requests', async () => {
            const agent = await authenticateAs(app, 'band1', 'band1pass');

            // First request
            await agent
                .get('/transactions')
                .expect(200);

            // Second request should still be authenticated
            await agent
                .get('/account')
                .expect(200);

            // Third request should still be authenticated
            await agent
                .get('/transactions')
                .expect(200);
        });

        it('should have separate sessions for different users', async () => {
            const agent1 = await authenticateAs(app, 'band1', 'band1pass');
            const agent2 = await authenticateAs(app, 'admin', 'admin123');

            // band1 should not be able to access admin routes
            await agent1
                .get('/config')
                .expect(403);

            // admin should be able to access admin routes
            await agent2
                .get('/config')
                .expect(200);
        });
    });
});
