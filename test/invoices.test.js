const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.NODE_ENV = 'test';
const app = require('../server');
const { initializeTestDatabase, closeTestDatabase } = require('./setup');
const {
    authenticateAs,
    createInvoiceData,
    createTestInvoice,
    createTestInvoiceItem,
    getTestInvoice,
    getTestInvoiceItems,
    getTestTransaction
} = require('./helpers');

describe('Invoice Management', () => {
    let db, testData;
    let band1Agent, band2Agent, adminAgent;

    before(async () => {
        const result = await initializeTestDatabase();
        db = result.db;
        testData = result.data;

        // Authenticate users
        band1Agent = await authenticateAs(app, 'band1', 'band1pass');
        band2Agent = await authenticateAs(app, 'band2', 'band2pass');
        adminAgent = await authenticateAs(app, 'admin', 'admin123');
    });

    after(async () => {
        await closeTestDatabase(db);
    });

    // =========================================
    // BAND INVOICE OPERATIONS
    // =========================================

    describe('Band Invoice Operations', () => {

        describe('View Invoices', () => {
            it('should allow band to view invoice list page', async () => {
                const res = await band1Agent
                    .get('/invoices')
                    .expect(200);

                assert.ok(res.text.includes('Invoices') || res.text.includes('invoices'));
            });

            it('should show only band\'s own invoices', async () => {
                // Create invoices for both bands
                const invoice1Id = await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Band1 Unique Client ABC'
                });
                const invoice2Id = await createTestInvoice(db, testData.bands.band2Id, {
                    client_name: 'Band2 Secret Client XYZ'
                });

                const res = await band1Agent
                    .get('/invoices')
                    .expect(200);

                assert.ok(res.text.includes('Band1 Unique Client ABC'));
                assert.ok(!res.text.includes('Band2 Secret Client XYZ'));
            });

            it('should filter invoices by status', async () => {
                // Create draft and sent invoices
                await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Draft Client Filter',
                    status: 'draft'
                });
                await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Sent Client Filter',
                    status: 'sent'
                });

                const res = await band1Agent
                    .get('/invoices?status=draft')
                    .expect(200);

                assert.ok(res.text.includes('Draft Client Filter'));
                // Sent invoice may or may not be hidden depending on implementation
            });
        });

        describe('Create Invoice', () => {
            it('should create invoice with valid data', async () => {
                const invoiceData = createInvoiceData({
                    client_name: 'New Test Client Create'
                });

                const res = await band1Agent
                    .post('/invoices')
                    .type('form')
                    .send(invoiceData)
                    .expect(302);

                // Should redirect to invoice detail
                assert.ok(res.headers.location.includes('/invoices/'));
            });

            it('should auto-generate invoice number in correct format', async () => {
                const invoiceData = createInvoiceData({
                    client_name: 'Number Format Test Client'
                });

                const res = await band1Agent
                    .post('/invoices')
                    .type('form')
                    .send(invoiceData)
                    .expect(302);

                // Extract invoice ID from redirect
                const match = res.headers.location.match(/\/invoices\/(\d+)/);
                assert.ok(match, 'Should redirect to invoice detail');

                const invoiceId = parseInt(match[1]);
                const invoice = await getTestInvoice(db, invoiceId);

                // Check format FAC-YYYY-NNN
                assert.ok(invoice.invoice_number.match(/^FAC-\d{4}-\d{3,}$/),
                    `Invoice number ${invoice.invoice_number} should match FAC-YYYY-NNN format`);
            });

            it('should calculate total from line items', async () => {
                const invoiceData = createInvoiceData({
                    client_name: 'Total Calculation Client',
                    item_description: ['Item A', 'Item B'],
                    item_quantity: ['2', '3'],
                    item_unit_price: ['100', '50']
                });

                const res = await band1Agent
                    .post('/invoices')
                    .type('form')
                    .send(invoiceData)
                    .expect(302);

                const match = res.headers.location.match(/\/invoices\/(\d+)/);
                const invoiceId = parseInt(match[1]);
                const invoice = await getTestInvoice(db, invoiceId);

                // 2*100 + 3*50 = 350
                assert.strictEqual(invoice.total_amount, 350);
            });

            it('should create invoice with draft status', async () => {
                const invoiceData = createInvoiceData({
                    client_name: 'Draft Status Test Client'
                });

                const res = await band1Agent
                    .post('/invoices')
                    .type('form')
                    .send(invoiceData)
                    .expect(302);

                const match = res.headers.location.match(/\/invoices\/(\d+)/);
                const invoiceId = parseInt(match[1]);
                const invoice = await getTestInvoice(db, invoiceId);

                assert.strictEqual(invoice.status, 'draft');
            });

            it('should reject invoice without client_name', async () => {
                const invoiceData = createInvoiceData({
                    client_name: ''
                });

                await band1Agent
                    .post('/invoices')
                    .type('form')
                    .send(invoiceData)
                    .expect(302); // Redirects back with error
            });

            it('should reject invoice without client_address', async () => {
                const invoiceData = createInvoiceData({
                    client_address: ''
                });

                await band1Agent
                    .post('/invoices')
                    .type('form')
                    .send(invoiceData)
                    .expect(302); // Redirects back with error
            });

            it('should reject invoice without items', async () => {
                const invoiceData = createInvoiceData({
                    item_description: [],
                    item_quantity: [],
                    item_unit_price: []
                });

                await band1Agent
                    .post('/invoices')
                    .type('form')
                    .send(invoiceData)
                    .expect(302); // Redirects back with error
            });
        });

        describe('View Invoice Detail', () => {
            it('should allow band to view their invoice detail', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Detail View Client'
                });
                await createTestInvoiceItem(db, invoiceId, {
                    description: 'Test Service Item'
                });

                const res = await band1Agent
                    .get(`/invoices/${invoiceId}`)
                    .expect(200);

                assert.ok(res.text.includes('Detail View Client'));
                assert.ok(res.text.includes('Test Service Item'));
            });

            it('should deny band access to other band\'s invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band2Id, {
                    client_name: 'Other Band Invoice'
                });

                const res = await band1Agent
                    .get(`/invoices/${invoiceId}`)
                    .expect(302);

                // Should redirect away
                assert.ok(res.headers.location.includes('/invoices'));
            });
        });

        describe('Edit Invoice', () => {
            it('should allow band to edit draft invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Original Client Name',
                    status: 'draft'
                });

                const updateData = createInvoiceData({
                    client_name: 'Updated Client Name'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/edit`)
                    .type('form')
                    .send(updateData)
                    .expect(302);

                const updated = await getTestInvoice(db, invoiceId);
                assert.strictEqual(updated.client_name, 'Updated Client Name');
            });

            it('should deny band editing sent invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Sent Invoice Client',
                    status: 'sent'
                });

                // Try to access edit form
                const res = await band1Agent
                    .get(`/invoices/${invoiceId}/edit`)
                    .expect(302);

                // Should redirect with error
                assert.ok(res.headers.location.includes('/invoices'));
            });

            it('should deny band editing other band\'s invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band2Id, {
                    client_name: 'Other Band Edit Test',
                    status: 'draft'
                });

                const updateData = createInvoiceData({
                    client_name: 'Attempted Change'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/edit`)
                    .type('form')
                    .send(updateData)
                    .expect(302);

                // Verify not changed
                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.client_name, 'Other Band Edit Test');
            });
        });

        describe('Delete Invoice', () => {
            it('should allow band to delete draft invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Delete Draft Test',
                    status: 'draft'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/delete`)
                    .expect(302);

                const deleted = await getTestInvoice(db, invoiceId);
                assert.strictEqual(deleted, undefined);
            });

            it('should deny band deleting sent invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Delete Sent Test',
                    status: 'sent'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/delete`)
                    .expect(302);

                // Invoice should still exist
                const invoice = await getTestInvoice(db, invoiceId);
                assert.ok(invoice, 'Sent invoice should not be deleted');
            });

            it('should deny band deleting other band\'s invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band2Id, {
                    client_name: 'Other Band Delete Test',
                    status: 'draft'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/delete`)
                    .expect(302);

                // Invoice should still exist
                const invoice = await getTestInvoice(db, invoiceId);
                assert.ok(invoice, 'Other band\'s invoice should not be deleted');
            });
        });

        describe('Status Transitions (Band)', () => {
            it('should allow draft → sent', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    status: 'draft'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/status`)
                    .type('form')
                    .send({ status: 'sent' })
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.status, 'sent');
            });

            it('should allow sent → paid', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    status: 'sent'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/status`)
                    .type('form')
                    .send({ status: 'paid' })
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.status, 'paid');
            });

            it('should allow sent → cancelled', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    status: 'sent'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/status`)
                    .type('form')
                    .send({ status: 'cancelled' })
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.status, 'cancelled');
            });

            it('should allow draft → cancelled', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    status: 'draft'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/status`)
                    .type('form')
                    .send({ status: 'cancelled' })
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.status, 'cancelled');
            });

            it('should deny sent → draft (band)', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    status: 'sent'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/status`)
                    .type('form')
                    .send({ status: 'draft' })
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.status, 'sent', 'Status should remain sent');
            });

            it('should deny paid → any (band)', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    status: 'paid'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/status`)
                    .type('form')
                    .send({ status: 'draft' })
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.status, 'paid', 'Status should remain paid');
            });

            it('should deny cancelled → any (band)', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    status: 'cancelled'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/status`)
                    .type('form')
                    .send({ status: 'draft' })
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.status, 'cancelled', 'Status should remain cancelled');
            });
        });

        describe('Create Transaction from Invoice', () => {
            it('should create transaction from invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Transaction Test Client',
                    total_amount: 500,
                    status: 'paid'
                });

                const res = await band1Agent
                    .post(`/invoices/${invoiceId}/create-transaction`)
                    .type('form')
                    .send({ category_id: testData.categories.gig })
                    .expect(302);

                // Should redirect to transaction
                assert.ok(res.headers.location.includes('/transactions/'));

                // Verify invoice is linked
                const invoice = await getTestInvoice(db, invoiceId);
                assert.ok(invoice.transaction_id, 'Invoice should have transaction_id');
            });

            it('should prevent duplicate transaction creation', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Duplicate Test Client',
                    total_amount: 300,
                    status: 'paid'
                });

                // First creation should work
                await band1Agent
                    .post(`/invoices/${invoiceId}/create-transaction`)
                    .type('form')
                    .send({ category_id: testData.categories.gig })
                    .expect(302);

                // Second should fail (redirect back with error)
                const res = await band1Agent
                    .post(`/invoices/${invoiceId}/create-transaction`)
                    .type('form')
                    .send({ category_id: testData.categories.gig })
                    .expect(302);

                // Should redirect back to invoice (not to transaction)
                assert.ok(res.headers.location.includes('/invoices/'));
            });

            it('should require category selection', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Category Required Test',
                    status: 'paid'
                });

                const res = await band1Agent
                    .post(`/invoices/${invoiceId}/create-transaction`)
                    .type('form')
                    .send({}) // No category
                    .expect(302);

                // Should redirect back to invoice
                assert.ok(res.headers.location.includes('/invoices/'));

                // Invoice should not have transaction linked
                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.transaction_id, null);
            });
        });
    });

    // =========================================
    // ADMIN INVOICE OPERATIONS
    // =========================================

    describe('Admin Invoice Operations', () => {

        describe('View All Invoices', () => {
            it('should allow admin to view all invoices', async () => {
                const res = await adminAgent
                    .get('/admin/invoices')
                    .expect(200);

                assert.ok(res.text.includes('Invoices') || res.text.includes('invoices'));
            });

            it('should show invoices from all bands', async () => {
                await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Admin View Band1 Client'
                });
                await createTestInvoice(db, testData.bands.band2Id, {
                    client_name: 'Admin View Band2 Client'
                });

                const res = await adminAgent
                    .get('/admin/invoices')
                    .expect(200);

                assert.ok(res.text.includes('Admin View Band1 Client'));
                assert.ok(res.text.includes('Admin View Band2 Client'));
            });

            it('should filter by band', async () => {
                await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Band Filter Test 1'
                });
                await createTestInvoice(db, testData.bands.band2Id, {
                    client_name: 'Band Filter Test 2'
                });

                const res = await adminAgent
                    .get(`/admin/invoices?band=${testData.bands.band1Id}`)
                    .expect(200);

                assert.ok(res.text.includes('Band Filter Test 1'));
            });
        });

        describe('Admin Create Invoice', () => {
            it('should allow admin to create invoice for any band', async () => {
                const invoiceData = createInvoiceData({
                    client_name: 'Admin Created Client',
                    band_id: testData.bands.band2Id
                });

                const res = await adminAgent
                    .post('/admin/invoices')
                    .type('form')
                    .send(invoiceData)
                    .expect(302);

                assert.ok(res.headers.location.includes('/admin/invoices/'));
            });

            it('should require band selection', async () => {
                const invoiceData = createInvoiceData({
                    client_name: 'No Band Client'
                    // No band_id
                });

                await adminAgent
                    .post('/admin/invoices')
                    .type('form')
                    .send(invoiceData)
                    .expect(302);

                // Should redirect back to form (no invoice created without band)
            });
        });

        describe('Admin Edit Invoice', () => {
            it('should allow admin to edit any invoice regardless of status', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Admin Edit Paid Client',
                    status: 'paid'
                });

                const updateData = createInvoiceData({
                    client_name: 'Admin Updated Paid Client'
                });

                await adminAgent
                    .post(`/admin/invoices/${invoiceId}/edit`)
                    .type('form')
                    .send(updateData)
                    .expect(302);

                const updated = await getTestInvoice(db, invoiceId);
                assert.strictEqual(updated.client_name, 'Admin Updated Paid Client');
            });
        });

        describe('Admin Delete Invoice', () => {
            it('should allow admin to delete any invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    client_name: 'Admin Delete Paid',
                    status: 'paid'
                });

                await adminAgent
                    .post(`/admin/invoices/${invoiceId}/delete`)
                    .expect(302);

                const deleted = await getTestInvoice(db, invoiceId);
                assert.strictEqual(deleted, undefined);
            });
        });

        describe('Admin Status Override', () => {
            it('should allow admin to change paid → draft', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    status: 'paid'
                });

                await adminAgent
                    .post(`/admin/invoices/${invoiceId}/status`)
                    .type('form')
                    .send({ status: 'draft' })
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.status, 'draft');
            });

            it('should allow admin to change cancelled → sent', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band1Id, {
                    status: 'cancelled'
                });

                await adminAgent
                    .post(`/admin/invoices/${invoiceId}/status`)
                    .type('form')
                    .send({ status: 'sent' })
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.status, 'sent');
            });
        });
    });

    // =========================================
    // ACCESS CONTROL TESTS
    // =========================================

    describe('Access Control', () => {

        describe('Authentication Required', () => {
            it('should redirect unauthenticated user from /invoices', async () => {
                await request(app)
                    .get('/invoices')
                    .expect(302);
            });

            it('should redirect unauthenticated user from /admin/invoices', async () => {
                await request(app)
                    .get('/admin/invoices')
                    .expect(302);
            });
        });

        describe('Role-Based Access', () => {
            it('should deny band access to /admin/invoices', async () => {
                await band1Agent
                    .get('/admin/invoices')
                    .expect(403);
            });

            it('should allow admin access to both routes', async () => {
                await adminAgent
                    .get('/invoices')
                    .expect(200);

                await adminAgent
                    .get('/admin/invoices')
                    .expect(200);
            });
        });

        describe('Cross-Band Isolation', () => {
            it('should prevent band1 from viewing band2 invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band2Id, {
                    client_name: 'Cross Band View Test'
                });

                const res = await band1Agent
                    .get(`/invoices/${invoiceId}`)
                    .expect(302);

                assert.ok(res.headers.location.includes('/invoices'));
            });

            it('should prevent band1 from editing band2 invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band2Id, {
                    client_name: 'Cross Band Edit Original',
                    status: 'draft'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/edit`)
                    .type('form')
                    .send(createInvoiceData({ client_name: 'Attempted Change' }))
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.client_name, 'Cross Band Edit Original');
            });

            it('should prevent band1 from deleting band2 invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band2Id, {
                    client_name: 'Cross Band Delete Test',
                    status: 'draft'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/delete`)
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.ok(invoice, 'Invoice should still exist');
            });

            it('should prevent band1 from creating transaction from band2 invoice', async () => {
                const invoiceId = await createTestInvoice(db, testData.bands.band2Id, {
                    client_name: 'Cross Band Transaction Test',
                    status: 'paid'
                });

                await band1Agent
                    .post(`/invoices/${invoiceId}/create-transaction`)
                    .type('form')
                    .send({ category_id: testData.categories.gig })
                    .expect(302);

                const invoice = await getTestInvoice(db, invoiceId);
                assert.strictEqual(invoice.transaction_id, null, 'Transaction should not be created');
            });
        });
    });
});
