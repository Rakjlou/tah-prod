const express = require('express');
const router = express.Router();
const { requireBand } = require('../lib/middleware');
const { getBandByUserId, getUserById, updateUserPassword } = require('../lib/db');
const { verifyPassword, hashPassword } = require('../lib/auth');

/**
 * GET /account
 * Display band account page
 */
router.get('/account', requireBand, async (req, res) => {
    try {
        const band = await getBandByUserId(req.session.user.id);

        if (!band) {
            return res.status(404).send('Band not found');
        }

        res.render('account', { band });
    } catch (error) {
        console.error('Error loading account:', error);
        req.flash.error('Failed to load account');
        res.redirect('/account');
    }
});

/**
 * POST /account/password
 * Change band password
 */
router.post('/account/password', requireBand, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    try {
        if (!currentPassword || !newPassword || !confirmPassword) {
            req.flash.error('All fields are required');
            return res.redirect('/account');
        }

        if (newPassword !== confirmPassword) {
            req.flash.error('New passwords do not match');
            return res.redirect('/account');
        }

        if (newPassword.length < 6) {
            req.flash.error('Password must be at least 6 characters');
            return res.redirect('/account');
        }

        // Verify current password
        const user = await getUserById(req.session.user.id);
        const isValid = await verifyPassword(currentPassword, user.password);

        if (!isValid) {
            req.flash.error('Current password is incorrect');
            return res.redirect('/account');
        }

        // Update password
        const hashedPassword = await hashPassword(newPassword);
        await updateUserPassword(req.session.user.id, hashedPassword);

        req.flash.success('Password changed successfully');
        res.redirect('/account');
    } catch (error) {
        console.error('Error changing password:', error);
        req.flash.error('Failed to change password');
        res.redirect('/account');
    }
});

module.exports = router;
