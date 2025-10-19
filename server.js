const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const { getUserByUsername, getAllConfig, getAllBands, createBand } = require('./lib/db');
const { verifyPassword } = require('./lib/auth');
const { ROLES, hasRole } = require('./lib/roles');
const { createBandSpreadsheet } = require('./lib/google-sheets');
const { getOAuthClient, getAuthUrl, getTokensFromCode, getAuthenticatedClient } = require('./lib/google-oauth');
const configService = require('./lib/config-service');

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
    res.locals.isGoogleAuthenticated = !!(req.session.googleTokens);
    res.locals.ROLES = ROLES;
    res.locals.hasRole = (role) => {
        return req.session.user ? hasRole(req.session.user.role, role) : false;
    };

    // Check if Google is configured
    try {
        const googleAuth = await configService.getGoogleOAuth();
        res.locals.googleConfigured = !!googleAuth;
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
        const config = await getAllConfig();
        res.render('config', { config });
    } catch (error) {
        console.error('Error loading config panel:', error);
        res.render('config', { error: 'Failed to load configuration', config: {} });
    }
});

app.post('/config', requireAdmin, async (req, res) => {
    try {
        for (const [key, value] of Object.entries(req.body)) {
            await configService.set(key, value);
        }

        const config = await getAllConfig();
        res.render('config', { success: 'Configuration saved successfully', config });
    } catch (error) {
        console.error('Error saving configuration:', error);
        const config = await getAllConfig();
        res.render('config', { error: 'Failed to save configuration', config });
    }
});

app.get('/auth/google', requireAdmin, async (req, res) => {
    try {
        const googleAuth = await configService.getGoogleOAuth();

        if (!googleAuth) {
            return res.redirect('/bands?error=' + encodeURIComponent('Google OAuth not configured. Please configure it in Config section first.'));
        }

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

    if (error) {
        return res.redirect('/bands?error=' + encodeURIComponent('Google authentication cancelled'));
    }

    if (!code) {
        return res.redirect('/bands?error=' + encodeURIComponent('No authorization code received'));
    }

    try {
        const googleAuth = await configService.getGoogleOAuth();

        if (!googleAuth) {
            return res.redirect('/bands?error=' + encodeURIComponent('Google OAuth not configured'));
        }

        const oauthClient = getOAuthClient(googleAuth);
        const tokens = await getTokensFromCode(code, oauthClient);
        req.session.googleTokens = tokens;
        res.redirect('/bands?success=' + encodeURIComponent('Google authentication successful'));
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.redirect('/bands?error=' + encodeURIComponent('Authentication failed: ' + error.message));
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
    if (!req.session.googleTokens) {
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

        const googleAuth = await configService.getGoogleOAuth();

        if (!googleAuth) {
            const bands = await getAllBands();
            return res.render('bands', { error: 'Google OAuth not configured', bands });
        }

        const oauthClient = getOAuthClient(googleAuth);
        const authenticatedClient = getAuthenticatedClient(req.session.googleTokens, oauthClient);
        const folderId = await configService.getGoogleDriveFolderId();

        const { spreadsheetId } = await createBandSpreadsheet(authenticatedClient, name, email, folderId);

        await createBand(name, email, spreadsheetId);

        const bands = await getAllBands();
        res.render('bands', { success: `Band "${name}" created successfully!`, bands });
    } catch (error) {
        console.error('Error creating band:', error);
        const bands = await getAllBands();
        res.render('bands', { error: 'Failed to create band: ' + error.message, bands });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
