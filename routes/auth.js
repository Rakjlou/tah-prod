const express = require('express');
const router = express.Router();
const { getUserByUsername } = require('../lib/db');
const { verifyPassword } = require('../lib/auth');

/**
 * GET /login
 * Display login page
 */
router.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    res.render('login');
});

/**
 * POST /login
 * Handle login form submission
 */
router.post('/login', async (req, res) => {
    const { login, password } = req.body;

    try {
        const user = await getUserByUsername(login);

        if (!user) {
            req.flash.error('Invalid credentials');
            return res.redirect('/login');
        }

        const isValid = await verifyPassword(password, user.password);

        if (!isValid) {
            req.flash.error('Invalid credentials');
            return res.redirect('/login');
        }

        req.session.regenerate((err) => {
            if (err) {
                console.error('Session regeneration error:', err);
                req.flash.error('Login failed');
                return res.redirect('/login');
            }

            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role
            };

            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    req.flash.error('Login failed');
                    return res.redirect('/login');
                }
                res.redirect('/');
            });
        });
    } catch (error) {
        console.error('Login error:', error);
        req.flash.error('An error occurred');
        res.redirect('/login');
    }
});

/**
 * GET /logout
 * Handle logout
 */
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.redirect('/');
    });
});

module.exports = router;
