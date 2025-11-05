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
        res.render('account', { error: 'Failed to load account' });
    }
});

/**
 * POST /account/password
 * Change band password
 */
router.post('/account/password', requireBand, async (req, res) => {
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

module.exports = router;
