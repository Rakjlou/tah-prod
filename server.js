const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const { setLocals } = require('./lib/middleware');

// Import route modules
const authRoutes = require('./routes/auth');
const configRoutes = require('./routes/config');
const bandsRoutes = require('./routes/bands');
const accountRoutes = require('./routes/account');
const transactionsRoutes = require('./routes/transactions');
const adminTransactionsRoutes = require('./routes/admin-transactions');
const qontoRoutes = require('./routes/qonto');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'tahprod-secret-key-2025';
const SESSION_MAX_AGE = parseInt(process.env.SESSION_MAX_AGE || '604800000', 10);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files and body parsing
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Session configuration
const SESSIONS_DB_DIR = path.join(__dirname, 'data');
const SESSIONS_DB_NAME = 'sessions.db';

const sessionStore = new SQLiteStore({
    db: SESSIONS_DB_NAME,
    dir: SESSIONS_DB_DIR
});

app.use(session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: SESSION_MAX_AGE
    }
}));

// Make sessionStore available to routes that need it (e.g., for destroyUserSessions)
app.use((req, res, next) => {
    req.sessionStore = sessionStore;
    next();
});

// Set common locals for all views
app.use(setLocals);

// Home route
app.get('/', (req, res) => {
    res.render('index');
});

// Mount route modules
app.use('/', authRoutes);
app.use('/', configRoutes);
app.use('/', bandsRoutes);
app.use('/', accountRoutes);
app.use('/', transactionsRoutes);
app.use('/', adminTransactionsRoutes);
app.use('/', qontoRoutes);

// Only start server if this file is run directly (not imported for testing)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

module.exports = app;
