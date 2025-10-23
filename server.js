const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const { createUser, getUserByUsername, getUserById, updateUserPassword, getAllConfig, getAllBands, createBand, getBandById, getBandByUserId, getAllCategories, createCategory, deleteCategory, seedDefaultCategories, createTransaction, getTransactionById, getTransactionsByBand, getAllTransactionsWithBands, updateTransaction, deleteTransaction, validateTransaction, getBalanceForBand, addTransactionDocument, getTransactionDocuments, deleteTransactionDocument } = require('./lib/db');
const { verifyPassword, hashPassword } = require('./lib/auth');
const { ROLES, hasRole } = require('./lib/roles');
const { createBandStructure, getTransactionsFolderId, createTransactionFolder, uploadTransactionDocument, deleteTransactionFolder, deleteFile } = require('./lib/google-drive');
const { getOAuthClient, getAuthUrl, getTokensFromCode } = require('./lib/google-oauth');
const googleAuth = require('./lib/google-auth');
const { sendBandWelcomeEmail, sendPasswordResetEmail } = require('./lib/email');
const configService = require('./lib/config-service');
const { syncTransactionsToSheet } = require('./lib/google-sheets');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'tahprod-secret-key-2025';
const SESSION_MAX_AGE = parseInt(process.env.SESSION_MAX_AGE || '604800000', 10);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));

app.use(session({
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: path.join(__dirname, 'data')
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: SESSION_MAX_AGE
    }
}));

app.use(async (req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.isGoogleAuthenticated = await googleAuth.isAuthenticated();
    res.locals.ROLES = ROLES;
    res.locals.hasRole = (role) => {
        return req.session.user ? hasRole(req.session.user.role, role) : false;
    };

    // Check if Google is configured
    try {
        const googleOAuthConfig = await configService.getGoogleOAuth();
        res.locals.googleConfigured = !!googleOAuthConfig;
    } catch (error) {
        res.locals.googleConfigured = false;
    }

    next();
});

// Authentication middleware
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    if (!hasRole(req.session.user.role, ROLES.ADMIN)) {
        return res.status(403).send('Access denied');
    }
    next();
}

function requireBand(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    if (!hasRole(req.session.user.role, ROLES.BAND)) {
        return res.status(403).send('Access denied');
    }
    next();
}

function generateRandomPassword() {
    // Generate a 12-character password: mix of uppercase, lowercase, numbers
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    res.render('login');
});

app.post('/login', async (req, res) => {
    const { login, password } = req.body;

    try {
        const user = await getUserByUsername(login);

        if (!user) {
            return res.render('login', { error: 'Invalid credentials' });
        }

        const isValid = await verifyPassword(password, user.password);

        if (!isValid) {
            return res.render('login', { error: 'Invalid credentials' });
        }

        req.session.regenerate((err) => {
            if (err) {
                console.error('Session regeneration error:', err);
                return res.render('login', { error: 'Login failed' });
            }

            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role
            };

            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.render('login', { error: 'Login failed' });
                }
                res.redirect('/');
            });
        });
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { error: 'An error occurred' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/');
    });
});

app.get('/config', requireAdmin, async (req, res) => {
    try {
        // Seed default categories if none exist
        await seedDefaultCategories();

        const config = await getAllConfig();
        const organizationBandId = await configService.getOrganizationBandId();
        let organizationBand = null;

        if (organizationBandId) {
            organizationBand = await getBandById(organizationBandId);
        }

        const categories = await getAllCategories();

        res.render('config', { config, organizationBandId, organizationBand, categories });
    } catch (error) {
        console.error('Error loading config panel:', error);
        res.render('config', { error: 'Failed to load configuration', config: {}, organizationBandId: null, organizationBand: null, categories: [] });
    }
});

app.post('/config', requireAdmin, async (req, res) => {
    try {
        for (const [key, value] of Object.entries(req.body)) {
            await configService.set(key, value);
        }

        const config = await getAllConfig();
        const organizationBandId = await configService.getOrganizationBandId();
        let organizationBand = null;

        if (organizationBandId) {
            organizationBand = await getBandById(organizationBandId);
        }

        const categories = await getAllCategories();

        res.render('config', { success: 'Configuration saved successfully', config, organizationBandId, organizationBand, categories });
    } catch (error) {
        console.error('Error saving configuration:', error);
        const config = await getAllConfig();
        res.render('config', { error: 'Failed to save configuration', config, organizationBandId: null, organizationBand: null, categories: [] });
    }
});

app.post('/config/create-organization', requireAdmin, async (req, res) => {
    try {
        // Check if org already exists
        const existingOrgId = await configService.getOrganizationBandId();
        if (existingOrgId) {
            const config = await getAllConfig();
            const organizationBand = await getBandById(existingOrgId);
            return res.render('config', {
                error: 'Organization band already exists',
                config,
                organizationBandId: existingOrgId,
                organizationBand
            });
        }

        // Create organization band structure
        const parentFolderId = await configService.getGoogleDriveFolderId();
        const authenticatedClient = await googleAuth.getAuthenticatedClient();

        const { folderId, accountingSpreadsheetId, invoicesFolderId } = await createBandStructure(
            authenticatedClient,
            'Organization',
            null,
            parentFolderId
        );

        // Create user account for organization (no login needed, but keeps schema consistent)
        const temporaryPassword = generateRandomPassword();
        const hashedPassword = await hashPassword(temporaryPassword);
        const userId = await createUser('organization@internal', hashedPassword, ROLES.BAND);

        // Create band record
        const bandId = await createBand('Organization', 'organization@internal', userId, folderId, accountingSpreadsheetId, invoicesFolderId);

        // Store organization band ID in config
        await configService.setOrganizationBandId(bandId);

        const config = await getAllConfig();
        const organizationBand = await getBandById(bandId);
        const categories = await getAllCategories();

        res.render('config', {
            success: 'Organization band created successfully',
            config,
            organizationBandId: bandId,
            organizationBand,
            categories
        });
    } catch (error) {
        console.error('Error creating organization band:', error);
        const config = await getAllConfig();
        res.render('config', {
            error: 'Failed to create organization band: ' + error.message,
            config,
            organizationBandId: null,
            organizationBand: null,
            categories: []
        });
    }
});

app.post('/config/categories', requireAdmin, async (req, res) => {
    try {
        const { name, type } = req.body;

        if (!name || !type) {
            const config = await getAllConfig();
            const organizationBandId = await configService.getOrganizationBandId();
            const organizationBand = organizationBandId ? await getBandById(organizationBandId) : null;
            const categories = await getAllCategories();

            return res.render('config', {
                error: 'Category name and type are required',
                config,
                organizationBandId,
                organizationBand,
                categories
            });
        }

        await createCategory(name, type);

        const config = await getAllConfig();
        const organizationBandId = await configService.getOrganizationBandId();
        const organizationBand = organizationBandId ? await getBandById(organizationBandId) : null;
        const categories = await getAllCategories();

        res.render('config', {
            success: `Category "${name}" created successfully`,
            config,
            organizationBandId,
            organizationBand,
            categories
        });
    } catch (error) {
        console.error('Error creating category:', error);
        const config = await getAllConfig();
        const categories = await getAllCategories();

        res.render('config', {
            error: 'Failed to create category: ' + error.message,
            config,
            organizationBandId: null,
            organizationBand: null,
            categories
        });
    }
});

app.post('/config/categories/:id/delete', requireAdmin, async (req, res) => {
    try {
        const categoryId = req.params.id;
        await deleteCategory(categoryId);

        const config = await getAllConfig();
        const organizationBandId = await configService.getOrganizationBandId();
        const organizationBand = organizationBandId ? await getBandById(organizationBandId) : null;
        const categories = await getAllCategories();

        res.render('config', {
            success: 'Category deleted successfully',
            config,
            organizationBandId,
            organizationBand,
            categories
        });
    } catch (error) {
        console.error('Error deleting category:', error);
        const config = await getAllConfig();
        const categories = await getAllCategories();

        res.render('config', {
            error: 'Failed to delete category: ' + error.message,
            config,
            organizationBandId: null,
            organizationBand: null,
            categories
        });
    }
});

app.get('/auth/google', requireAdmin, async (req, res) => {
    try {
        const googleAuth = await configService.getGoogleOAuth();

        if (!googleAuth) {
            return res.redirect('/bands?error=' + encodeURIComponent('Google OAuth not configured. Please configure it in Config section first.'));
        }

        // Store the referring page to redirect back after authentication
        const returnTo = req.headers.referer || '/bands';
        req.session.oauthReturnTo = returnTo;

        const oauthClient = getOAuthClient(googleAuth);
        const authUrl = getAuthUrl(oauthClient);
        res.redirect(authUrl);
    } catch (error) {
        console.error('Error generating auth URL:', error);
        res.redirect('/bands?error=' + encodeURIComponent('Failed to initiate Google authentication'));
    }
});

app.get('/auth/google/callback', requireAdmin, async (req, res) => {
    const { code, error } = req.query;

    // Get the return URL from session, default to /bands
    const returnTo = req.session.oauthReturnTo || '/bands';
    delete req.session.oauthReturnTo;

    if (error) {
        return res.redirect(returnTo + '?error=' + encodeURIComponent('Google authentication cancelled'));
    }

    if (!code) {
        return res.redirect(returnTo + '?error=' + encodeURIComponent('No authorization code received'));
    }

    try {
        const googleOAuthConfig = await configService.getGoogleOAuth();

        if (!googleOAuthConfig) {
            return res.redirect(returnTo + '?error=' + encodeURIComponent('Google OAuth not configured'));
        }

        const oauthClient = getOAuthClient(googleOAuthConfig);
        const tokens = await getTokensFromCode(code, oauthClient);

        // Store refresh token permanently (encrypted)
        if (tokens.refresh_token) {
            await googleAuth.storeRefreshToken(tokens.refresh_token);
        }

        res.redirect(returnTo + '?success=' + encodeURIComponent('Google authentication successful'));
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.redirect(returnTo + '?error=' + encodeURIComponent('Authentication failed: ' + error.message));
    }
});

app.get('/bands', requireAdmin, async (req, res) => {
    try {
        const bands = await getAllBands();
        res.render('bands', { bands });
    } catch (error) {
        console.error('Error loading bands:', error);
        res.render('bands', { error: 'Failed to load bands', bands: [] });
    }
});

app.post('/bands', requireAdmin, async (req, res) => {
    // Check if Google authenticated
    if (!await googleAuth.isAuthenticated()) {
        const bands = await getAllBands();
        return res.render('bands', {
            error: 'Please authenticate with Google first',
            bands
        });
    }

    try {
        const { name, email } = req.body;

        if (!name || !email) {
            const bands = await getAllBands();
            return res.render('bands', { error: 'Name and email are required', bands });
        }

        const parentFolderId = await configService.getGoogleDriveFolderId();

        if (!parentFolderId) {
            const bands = await getAllBands();
            return res.render('bands', { error: 'Google Drive folder not configured', bands });
        }

        const authenticatedClient = await googleAuth.getAuthenticatedClient();

        const { folderId, accountingSpreadsheetId, invoicesFolderId } = await createBandStructure(
            authenticatedClient,
            name,
            email,
            parentFolderId
        );

        // Create band user account
        const temporaryPassword = generateRandomPassword();
        const hashedPassword = await hashPassword(temporaryPassword);
        const userId = await createUser(email, hashedPassword, ROLES.BAND);

        // Create band record linked to the user
        await createBand(name, email, userId, folderId, accountingSpreadsheetId, invoicesFolderId);

        // Log credentials for admin to share
        await sendBandWelcomeEmail(email, email, temporaryPassword);

        const bands = await getAllBands();
        res.render('bands', {
            success: `Band "${name}" created successfully! Username: ${email} | Password: ${temporaryPassword}`,
            bands
        });
    } catch (error) {
        console.error('Error creating band:', error);
        const bands = await getAllBands();
        res.render('bands', { error: 'Failed to create band: ' + error.message, bands });
    }
});

// Band account routes
app.get('/account', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);

        if (!band) {
            return res.status(404).send('Band not found');
        }

        res.render('account', { band });
    } catch (error) {
        console.error('Error loading account:', error);
        res.render('account', { error: 'Failed to load account' });
    }
});

app.post('/account/password', requireBand, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    const renderWithBand = async (data) => {
        const band = await getBandByUserId(req.session.user.id);
        return res.render('account', { band, ...data });
    };

    try {
        if (!currentPassword || !newPassword || !confirmPassword) {
            return renderWithBand({ error: 'All fields are required' });
        }

        if (newPassword !== confirmPassword) {
            return renderWithBand({ error: 'New passwords do not match' });
        }

        if (newPassword.length < 6) {
            return renderWithBand({ error: 'Password must be at least 6 characters' });
        }

        // Verify current password
        const user = await getUserById(req.session.user.id);
        const isValid = await verifyPassword(currentPassword, user.password);

        if (!isValid) {
            return renderWithBand({ error: 'Current password is incorrect' });
        }

        // Update password
        const hashedPassword = await hashPassword(newPassword);
        await updateUserPassword(req.session.user.id, hashedPassword);

        return renderWithBand({ success: 'Password changed successfully' });
    } catch (error) {
        console.error('Error changing password:', error);
        return renderWithBand({ error: 'Failed to change password' });
    }
});

// Admin password reset route
app.post('/admin/bands/:id/reset-password', requireAdmin, async (req, res) => {
    try {
        const bandId = req.params.id;
        const band = await getBandById(bandId);

        if (!band) {
            const bands = await getAllBands();
            return res.render('bands', {
                error: 'Band not found',
                bands
            });
        }

        // Generate new password
        const newPassword = generateRandomPassword();
        const hashedPassword = await hashPassword(newPassword);
        await updateUserPassword(band.user_id, hashedPassword);

        // Log credentials for admin
        await sendPasswordResetEmail(band.email, newPassword);

        const bands = await getAllBands();
        res.render('bands', {
            success: `Password reset for "${band.name}". New password: ${newPassword}`,
            bands
        });
    } catch (error) {
        console.error('Error resetting password:', error);
        const bands = await getAllBands();
        res.render('bands', {
            error: 'Failed to reset password: ' + error.message,
            bands
        });
    }
});

// Band transaction routes
app.get('/transactions', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const statusFilter = req.query.status || null;
        const transactions = await getTransactionsByBand(band.id, statusFilter);
        const balance = await getBalanceForBand(band.id);
        const pendingCount = await getTransactionsByBand(band.id, 'pending');

        res.render('transactions', {
            band,
            transactions,
            balance,
            pendingCount: pendingCount.length,
            statusFilter
        });
    } catch (error) {
        console.error('Error loading transactions:', error);
        res.render('transactions', {
            error: 'Failed to load transactions',
            transactions: [],
            balance: 0,
            pendingCount: 0,
            statusFilter: null
        });
    }
});

app.get('/transactions/new', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const categories = await getAllCategories();
        res.render('transaction-new', { band, categories });
    } catch (error) {
        console.error('Error loading new transaction form:', error);
        res.status(500).send('Failed to load form');
    }
});

app.post('/transactions', requireBand, upload.array('documents', 10), async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const { type, amount, category_id, description } = req.body;

        // Create transaction
        const transactionId = await createTransaction(band.id, type, parseFloat(amount), parseInt(category_id), description);

        // Handle document uploads if any
        if (req.files && req.files.length > 0) {
            const authenticatedClient = await googleAuth.getAuthenticatedClient();
            const transactionsFolderId = await getTransactionsFolderId(authenticatedClient, band.folder_id);
            const folderId = await createTransactionFolder(authenticatedClient, transactionsFolderId, transactionId, description);

            // Upload each file
            for (const file of req.files) {
                const driveFileId = await uploadTransactionDocument(authenticatedClient, folderId, file.buffer, file.originalname);
                await addTransactionDocument(transactionId, driveFileId, file.originalname);
            }

            // Update transaction with folder ID
            await updateTransaction(transactionId, { drive_folder_id: folderId });
        }

        // Sync to Google Sheets
        const transactions = await getTransactionsByBand(band.id);
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        res.redirect('/transactions?success=' + encodeURIComponent('Transaction created successfully'));
    } catch (error) {
        console.error('Error creating transaction:', error);
        res.redirect('/transactions/new?error=' + encodeURIComponent('Failed to create transaction: ' + error.message));
    }
});

app.get('/transactions/:id/edit', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const transaction = await getTransactionById(req.params.id);
        if (!transaction || transaction.band_id !== band.id) {
            return res.status(404).send('Transaction not found');
        }

        if (transaction.status !== 'pending') {
            return res.redirect('/transactions?error=' + encodeURIComponent('Cannot edit validated transaction'));
        }

        const categories = await getAllCategories();
        res.render('transaction-edit', { band, transaction, categories });
    } catch (error) {
        console.error('Error loading transaction edit form:', error);
        res.status(500).send('Failed to load form');
    }
});

app.post('/transactions/:id', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const transaction = await getTransactionById(req.params.id);
        if (!transaction || transaction.band_id !== band.id) {
            return res.status(404).send('Transaction not found');
        }

        if (transaction.status !== 'pending') {
            return res.redirect('/transactions?error=' + encodeURIComponent('Cannot edit validated transaction'));
        }

        const { amount, category_id, description } = req.body;
        await updateTransaction(req.params.id, {
            amount: parseFloat(amount),
            category_id: parseInt(category_id),
            description
        });

        // Sync to Google Sheets
        const transactions = await getTransactionsByBand(band.id);
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        res.redirect('/transactions?success=' + encodeURIComponent('Transaction updated successfully'));
    } catch (error) {
        console.error('Error updating transaction:', error);
        res.redirect('/transactions/' + req.params.id + '/edit?error=' + encodeURIComponent('Failed to update transaction'));
    }
});

app.post('/transactions/:id/delete', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const transaction = await getTransactionById(req.params.id);
        if (!transaction || transaction.band_id !== band.id) {
            return res.status(404).send('Transaction not found');
        }

        if (transaction.status !== 'pending') {
            return res.redirect('/transactions?error=' + encodeURIComponent('Cannot delete validated transaction'));
        }

        // Delete folder from Drive if exists
        if (transaction.drive_folder_id) {
            const authenticatedClient = await googleAuth.getAuthenticatedClient();
            await deleteTransactionFolder(authenticatedClient, transaction.drive_folder_id);
        }

        await deleteTransaction(req.params.id);

        // Sync to Google Sheets
        const transactions = await getTransactionsByBand(band.id);
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        res.redirect('/transactions?success=' + encodeURIComponent('Transaction deleted successfully'));
    } catch (error) {
        console.error('Error deleting transaction:', error);
        res.redirect('/transactions?error=' + encodeURIComponent('Failed to delete transaction'));
    }
});

app.get('/transactions/:id/documents', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const transaction = await getTransactionById(req.params.id);
        if (!transaction || transaction.band_id !== band.id) {
            return res.status(404).send('Transaction not found');
        }

        const documents = await getTransactionDocuments(req.params.id);

        res.render('transaction-documents', { band, transaction, documents });
    } catch (error) {
        console.error('Error loading documents:', error);
        res.status(500).send('Failed to load documents');
    }
});

app.post('/transactions/:id/documents', requireBand, upload.single('document'), async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const transaction = await getTransactionById(req.params.id);
        if (!transaction || transaction.band_id !== band.id) {
            return res.status(404).send('Transaction not found');
        }

        if (!req.file) {
            return res.redirect('/transactions/' + req.params.id + '/documents?error=' + encodeURIComponent('No file uploaded'));
        }

        const authenticatedClient = await googleAuth.getAuthenticatedClient();

        // Create folder if it doesn't exist
        let folderId = transaction.drive_folder_id;
        if (!folderId) {
            const transactionsFolderId = await getTransactionsFolderId(authenticatedClient, band.folder_id);
            folderId = await createTransactionFolder(authenticatedClient, transactionsFolderId, transaction.id, transaction.description);
            await updateTransaction(transaction.id, { drive_folder_id: folderId });
        }

        // Upload file
        const driveFileId = await uploadTransactionDocument(authenticatedClient, folderId, req.file.buffer, req.file.originalname);
        await addTransactionDocument(transaction.id, driveFileId, req.file.originalname);

        // Sync to Google Sheets (to update Documents column)
        const transactions = await getTransactionsByBand(band.id);
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        res.redirect('/transactions/' + req.params.id + '/documents?success=' + encodeURIComponent('Document uploaded successfully'));
    } catch (error) {
        console.error('Error uploading document:', error);
        res.redirect('/transactions/' + req.params.id + '/documents?error=' + encodeURIComponent('Failed to upload document'));
    }
});

app.post('/transactions/:transactionId/documents/:docId/delete', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);
        if (!band) {
            return res.status(404).send('Band not found');
        }

        const transaction = await getTransactionById(req.params.transactionId);
        if (!transaction || transaction.band_id !== band.id) {
            return res.status(404).send('Transaction not found');
        }

        const documents = await getTransactionDocuments(req.params.transactionId);
        const document = documents.find(d => d.id === parseInt(req.params.docId));

        if (!document) {
            return res.status(404).send('Document not found');
        }

        // Delete from Drive
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await deleteFile(authenticatedClient, document.drive_file_id);

        // Delete from DB
        await deleteTransactionDocument(req.params.docId);

        res.redirect('/transactions/' + req.params.transactionId + '/documents?success=' + encodeURIComponent('Document deleted successfully'));
    } catch (error) {
        console.error('Error deleting document:', error);
        res.redirect('/transactions/' + req.params.transactionId + '/documents?error=' + encodeURIComponent('Failed to delete document'));
    }
});

// Admin transaction routes
app.get('/admin/transactions', requireAdmin, async (req, res) => {
    try {
        const bandFilter = req.query.band ? parseInt(req.query.band) : null;
        const statusFilter = req.query.status || null;

        const transactions = await getAllTransactionsWithBands(bandFilter, statusFilter);
        const bands = await getAllBands();
        const organizationBandId = await configService.getOrganizationBandId();

        res.render('admin-transactions', {
            transactions,
            bands,
            organizationBandId,
            bandFilter,
            statusFilter
        });
    } catch (error) {
        console.error('Error loading admin transactions:', error);
        res.render('admin-transactions', {
            error: 'Failed to load transactions',
            transactions: [],
            bands: [],
            organizationBandId: null,
            bandFilter: null,
            statusFilter: null
        });
    }
});

app.post('/admin/transactions/:id/validate', requireAdmin, async (req, res) => {
    try {
        const { transaction_date } = req.body;
        const transaction = await getTransactionById(req.params.id);

        if (!transaction) {
            return res.redirect('/admin/transactions?error=' + encodeURIComponent('Transaction not found'));
        }

        if (transaction.status === 'validated') {
            return res.redirect('/admin/transactions?error=' + encodeURIComponent('Transaction already validated'));
        }

        await validateTransaction(req.params.id, req.session.user.id, transaction_date);

        // Sync to Google Sheets
        const band = await getBandById(transaction.band_id);
        const transactions = await getTransactionsByBand(transaction.band_id);
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        res.redirect('/admin/transactions?success=' + encodeURIComponent('Transaction validated successfully'));
    } catch (error) {
        console.error('Error validating transaction:', error);
        res.redirect('/admin/transactions?error=' + encodeURIComponent('Failed to validate transaction'));
    }
});

app.post('/admin/transactions/:id/delete', requireAdmin, async (req, res) => {
    try {
        const transaction = await getTransactionById(req.params.id);

        if (!transaction) {
            return res.redirect('/admin/transactions?error=' + encodeURIComponent('Transaction not found'));
        }

        // Delete folder from Drive if exists
        if (transaction.drive_folder_id) {
            const authenticatedClient = await googleAuth.getAuthenticatedClient();
            await deleteTransactionFolder(authenticatedClient, transaction.drive_folder_id);
        }

        await deleteTransaction(req.params.id);

        // Sync to Google Sheets
        const band = await getBandById(transaction.band_id);
        const transactions = await getTransactionsByBand(transaction.band_id);
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        res.redirect('/admin/transactions?success=' + encodeURIComponent('Transaction deleted successfully'));
    } catch (error) {
        console.error('Error deleting transaction:', error);
        res.redirect('/admin/transactions?error=' + encodeURIComponent('Failed to delete transaction'));
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
