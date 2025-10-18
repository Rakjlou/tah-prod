const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const { getUserByUsername, getAllConfig, setConfig } = require('./lib/db');
const { verifyPassword } = require('./lib/auth');
const { ROLES, hasRole } = require('./lib/roles');

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

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.ROLES = ROLES;
    res.locals.hasRole = (role) => {
        return req.session.user ? hasRole(req.session.user.role, role) : false;
    };
    next();
});

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

app.get('/admin', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    if (!hasRole(req.session.user.role, ROLES.ADMIN)) {
        return res.status(403).send('Access denied');
    }

    try {
        const config = await getAllConfig();
        res.render('admin', { config });
    } catch (error) {
        console.error('Error loading admin panel:', error);
        res.render('admin', { error: 'Failed to load configuration', config: {} });
    }
});

app.post('/admin', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    if (!hasRole(req.session.user.role, ROLES.ADMIN)) {
        return res.status(403).send('Access denied');
    }

    try {
        for (const [key, value] of Object.entries(req.body)) {
            await setConfig(key, value);
        }

        const config = await getAllConfig();
        res.render('admin', { success: 'Configuration saved successfully', config });
    } catch (error) {
        console.error('Error saving configuration:', error);
        const config = await getAllConfig();
        res.render('admin', { error: 'Failed to save configuration', config });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
