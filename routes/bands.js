const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../lib/middleware');
const {
    getAllBands,
    createBand,
    getBandById,
    createUser,
    updateUserPassword,
    deleteUser
} = require('../lib/db');
const { hashPassword } = require('../lib/auth');
const { ROLES } = require('../lib/roles');
const { createBandStructure, deleteFile } = require('../lib/google-drive');
const { getOAuthClient, getAuthUrl, getTokensFromCode } = require('../lib/google-oauth');
const googleAuth = require('../lib/google-auth');
const { sendBandWelcomeEmail, sendPasswordResetEmail } = require('../lib/email');
const configService = require('../lib/config-service');
const { generateRandomPassword, destroyUserSessions } = require('../lib/helpers');

/**
 * GET /auth/google
 * Initiate Google OAuth flow
 */
router.get('/auth/google', requireAdmin, async (req, res) => {
    const googleAuthConfig = await configService.getGoogleOAuth();

    if (!googleAuthConfig) {
        req.flash.error('Google OAuth not configured. Please configure it in Config section first.');
        return res.redirect('/bands');
    }

    const returnTo = req.headers.referer || '/bands';
    req.session.oauthReturnTo = returnTo;

    const oauthClient = getOAuthClient(googleAuthConfig);
    const authUrl = getAuthUrl(oauthClient);
    res.redirect(authUrl);
});

/**
 * GET /auth/google/callback
 * Handle Google OAuth callback
 */
router.get('/auth/google/callback', requireAdmin, async (req, res) => {
    const { code, error } = req.query;

    const returnTo = req.session.oauthReturnTo || '/bands';
    delete req.session.oauthReturnTo;

    if (error) {
        req.flash.error('Google authentication cancelled');
        return res.redirect(returnTo);
    }

    if (!code) {
        req.flash.error('No authorization code received');
        return res.redirect(returnTo);
    }

    const googleOAuthConfig = await configService.getGoogleOAuth();

    if (!googleOAuthConfig) {
        req.flash.error('Google OAuth not configured');
        return res.redirect(returnTo);
    }

    const oauthClient = getOAuthClient(googleOAuthConfig);
    const tokens = await getTokensFromCode(code, oauthClient);

    // Store refresh token permanently (encrypted)
    if (tokens.refresh_token) {
        await googleAuth.storeRefreshToken(tokens.refresh_token);
    }

    req.flash.success('Google authentication successful');
    res.redirect(returnTo);
});

/**
 * GET /bands
 * Display bands list
 */
router.get('/bands', requireAdmin, async (req, res) => {
    const bands = await getAllBands();
    res.render('bands', { bands });
});

/**
 * POST /bands
 * Create a new band
 */
router.post('/bands', requireAdmin, async (req, res) => {
    // Check if Google authenticated
    if (!await googleAuth.isAuthenticated()) {
        req.flash.error('Please authenticate with Google first');
        return res.redirect('/bands');
    }

    const { name, email } = req.body;

    if (!name || !email) {
        req.flash.error('Name and email are required');
        return res.redirect('/bands');
    }

    const parentFolderId = await configService.getGoogleDriveFolderId();

    if (!parentFolderId) {
        req.flash.error('Google Drive folder not configured');
        return res.redirect('/bands');
    }

    const authenticatedClient = await googleAuth.getAuthenticatedClient();

    const { folderId, accountingSpreadsheetId, invoicesFolderId } = await createBandStructure(
        authenticatedClient,
        name,
        email,
        parentFolderId
    );

    const temporaryPassword = generateRandomPassword();
    const hashedPassword = await hashPassword(temporaryPassword);
    const userId = await createUser(email, hashedPassword, ROLES.BAND);

    await createBand(name, email, userId, folderId, accountingSpreadsheetId, invoicesFolderId);

    await sendBandWelcomeEmail(email, email, temporaryPassword);

    req.flash.success(`Band "${name}" created successfully! Username: ${email} | Password: ${temporaryPassword}`);
    res.redirect('/bands');
});

/**
 * POST /admin/bands/:id/reset-password
 * Reset band password
 */
router.post('/admin/bands/:id/reset-password', requireAdmin, async (req, res) => {
    const bandId = req.params.id;
    const band = await getBandById(bandId);

    if (!band) {
        req.flash.error('Band not found');
        return res.redirect('/bands');
    }

    const newPassword = generateRandomPassword();
    const hashedPassword = await hashPassword(newPassword);
    await updateUserPassword(band.user_id, hashedPassword);

    await sendPasswordResetEmail(band.email, newPassword);

    req.flash.success(`Password reset for "${band.name}". New password: ${newPassword}`);
    res.redirect('/bands');
});

/**
 * POST /admin/bands/:id/delete
 * Delete a band
 */
router.post('/admin/bands/:id/delete', requireAdmin, async (req, res) => {
    const bandId = req.params.id;
    const band = await getBandById(bandId);

    if (!band) {
        req.flash.error('Band not found');
        return res.redirect('/bands');
    }

    let driveDeleteError = null;
    if (band.folder_id) {
        try {
            const oauthClient = await googleAuth.getAuthenticatedClient();
            await deleteFile(oauthClient, band.folder_id);
        } catch (driveError) {
            console.error('Error deleting Google Drive folder:', driveError);
            // If it's an invalid grant, let it bubble up to global handler
            if (googleAuth.isInvalidGrantError(driveError)) {
                throw driveError;
            }
            driveDeleteError = driveError.message;
            // Continue with deletion even if Drive cleanup fails
        }
    }

    await destroyUserSessions(band.user_id, req.sessionStore);

    await deleteUser(band.user_id);

    const successMessage = driveDeleteError
        ? `Band "${band.name}" has been deleted (Warning: Google Drive folder could not be deleted: ${driveDeleteError})`
        : `Band "${band.name}" has been deleted`;

    req.flash.success(successMessage);
    res.redirect('/bands');
});

module.exports = router;
