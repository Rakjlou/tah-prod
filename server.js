const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const { getUserByUsername } = require('./lib/db');
const { verifyPassword } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));

app.use(session({
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: path.join(__dirname, 'data')
    }),
    secret: 'tahprod-secret-key-2025',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
