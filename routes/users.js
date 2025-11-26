const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../lib/middleware');
const {
    getAllUsers,
    getUserById,
    createUser,
    updateUser,
    updateUserPassword,
    deleteUser
} = require('../lib/db');
const { hashPassword } = require('../lib/auth');
const { ROLES } = require('../lib/roles');
const { destroyUserSessions } = require('../lib/helpers');

/**
 * GET /admin/users
 * Display user management page
 */
router.get('/admin/users', requireAdmin, async (req, res) => {
    try {
        const users = await getAllUsers();
        const currentUserId = req.session.user.id;

        res.render('admin-users', {
            users,
            currentUserId
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        req.flash.error('Failed to load users');
        res.redirect('/');
    }
});

/**
 * POST /admin/users
 * Create a new admin user
 */
router.post('/admin/users', requireAdmin, async (req, res) => {
    const { username, password, password_confirm } = req.body;

    // Validation: Required fields
    if (!username || !password || !password_confirm) {
        req.flash.error('All fields are required');
        return res.redirect('/admin/users');
    }

    // Validation: Password length
    if (password.length < 6) {
        req.flash.error('Password must be at least 6 characters');
        return res.redirect('/admin/users');
    }

    // Validation: Password match
    if (password !== password_confirm) {
        req.flash.error('Passwords do not match');
        return res.redirect('/admin/users');
    }

    // Validation: Username format (alphanumeric, underscore, hyphen)
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        req.flash.error('Username can only contain letters, numbers, underscores, and hyphens');
        return res.redirect('/admin/users');
    }

    try {
        const hashedPassword = await hashPassword(password);
        await createUser(username, hashedPassword, ROLES.ADMIN);

        req.flash.success(`Admin user "${username}" created successfully`);
        res.redirect('/admin/users');
    } catch (error) {
        // Handle unique constraint violation
        if (error.message && error.message.includes('UNIQUE constraint')) {
            req.flash.error('Username already exists');
        } else {
            console.error('Error creating user:', error);
            req.flash.error('Failed to create user');
        }
        res.redirect('/admin/users');
    }
});

/**
 * POST /admin/users/:id/edit
 * Update an existing user
 */
router.post('/admin/users/:id/edit', requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const { username, password, password_confirm } = req.body;

    try {
        // Check if user exists
        const user = await getUserById(userId);
        if (!user) {
            req.flash.error('User not found');
            return res.redirect('/admin/users');
        }

        // Validation: Username required
        if (!username) {
            req.flash.error('Username is required');
            return res.redirect('/admin/users');
        }

        // Validation: Username format
        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            req.flash.error('Username can only contain letters, numbers, underscores, and hyphens');
            return res.redirect('/admin/users');
        }

        // Update username if changed
        if (username !== user.username) {
            await updateUser(userId, { username });
        }

        // Update password if provided
        if (password) {
            // Validation: Password length
            if (password.length < 6) {
                req.flash.error('Password must be at least 6 characters');
                return res.redirect('/admin/users');
            }

            // Validation: Password match
            if (password !== password_confirm) {
                req.flash.error('Passwords do not match');
                return res.redirect('/admin/users');
            }

            const hashedPassword = await hashPassword(password);
            await updateUserPassword(userId, hashedPassword);

            // Destroy all sessions for this user (force re-login)
            await destroyUserSessions(userId, req.sessionStore);
        }

        req.flash.success('User updated successfully');
        res.redirect('/admin/users');
    } catch (error) {
        // Handle unique constraint violation
        if (error.message && error.message.includes('UNIQUE constraint')) {
            req.flash.error('Username already exists');
        } else {
            console.error('Error updating user:', error);
            req.flash.error('Failed to update user');
        }
        res.redirect('/admin/users');
    }
});

/**
 * POST /admin/users/:id/delete
 * Delete a user
 */
router.post('/admin/users/:id/delete', requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    const currentUserId = req.session.user.id;

    // Prevent deleting yourself
    if (userId === currentUserId) {
        req.flash.error('You cannot delete your own account');
        return res.redirect('/admin/users');
    }

    try {
        // Check if user exists
        const user = await getUserById(userId);
        if (!user) {
            req.flash.error('User not found');
            return res.redirect('/admin/users');
        }

        // Destroy all sessions for this user first
        await destroyUserSessions(userId, req.sessionStore);

        // Delete the user
        await deleteUser(userId);

        req.flash.success(`User "${user.username}" deleted successfully`);
        res.redirect('/admin/users');
    } catch (error) {
        console.error('Error deleting user:', error);
        req.flash.error('Failed to delete user');
        res.redirect('/admin/users');
    }
});

module.exports = router;
