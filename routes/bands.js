const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../lib/middleware');
const {
    getAllBands,
    createBand,
    getBandById,
    createUser,
    updateUserPassword,
    deleteUser,
    getUserByUsername,
    getAllBandCredentials,
    createBandCredential,
    getCredentialByUsername,
    getCredentialById,
    updateCredentialPassword,
    deleteBandCredential,
    getBalancesForAllBands
} = require('../lib/db');
const { hashPassword } = require('../lib/auth');
const { ROLES } = require('../lib/roles');
const { createBandStructure, deleteFile } = require('../lib/google-drive');
const { getOAuthClient, getAuthUrl, getTokensFromCode } = require('../lib/google-oauth');
const googleAuth = require('../lib/google-auth');
const { sendBandWelcomeEmail, sendPasswordResetEmail } = require('../lib/email');
const configService = require('../lib/config-service');
const { generateRandomPassword } = require('../lib/auth');
const { destroyUserSessions } = require('../lib/sessions');

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
    const [bands, allCredentials, balanceRows] = await Promise.all([
        getAllBands(),
        getAllBandCredentials(),
        getBalancesForAllBands()
    ]);

    const credentialsByBandId = {};
    for (const cred of allCredentials) {
        if (!credentialsByBandId[cred.band_id]) {
            credentialsByBandId[cred.band_id] = [];
        }
        credentialsByBandId[cred.band_id].push(cred);
    }

    const balanceByBandId = {};
    for (const row of balanceRows) {
        balanceByBandId[row.band_id] = row.balance;
    }

    const bandsWithBalance = bands.map(b => ({
        ...b,
        balance: balanceByBandId[b.id] || 0
    }));

    res.render('bands', { bands: bandsWithBalance, credentialsByBandId });
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

    try {
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
    } catch (error) {
        console.error('Error creating band:', error);

        // Extract meaningful error message from Google API errors
        let errorMessage = 'Failed to create band';

        if (error.code === 403 && error.cause?.message) {
            // Google API permission/sharing error with user-friendly message
            errorMessage = error.cause.message;
        } else if (error.message) {
            errorMessage = error.message;
        }

        req.flash.error(errorMessage);
        res.redirect('/bands');
    }
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

    const customPassword = req.body.password;
    const newPassword = customPassword || generateRandomPassword();
    const hashedPassword = await hashPassword(newPassword);
    await updateUserPassword(band.user_id, hashedPassword);

    await sendPasswordResetEmail(band.email, newPassword);

    if (customPassword) {
        req.flash.success(`Password reset for "${band.name}".`);
    } else {
        req.flash.success(`Password reset for "${band.name}". New password: ${newPassword}`);
    }
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

/**
 * POST /admin/bands/:id/credentials
 * Add a new credential to a band
 */
router.post('/admin/bands/:id/credentials', requireAdmin, async (req, res) => {
    const bandId = req.params.id;
    const band = await getBandById(bandId);

    if (!band) {
        req.flash.error('Band not found');
        return res.redirect('/bands');
    }

    const { label, username, password: customPassword } = req.body;

    if (!label || !username) {
        req.flash.error('Label and username are required');
        return res.redirect('/bands');
    }

    // Check uniqueness across users and band_credentials
    const existingUser = await getUserByUsername(username);
    if (existingUser) {
        req.flash.error('This username is already taken by an existing user');
        return res.redirect('/bands');
    }

    const existingCred = await getCredentialByUsername(username);
    if (existingCred) {
        req.flash.error('This username is already taken by another credential');
        return res.redirect('/bands');
    }

    const password = customPassword || generateRandomPassword();
    const hashedPassword = await hashPassword(password);
    await createBandCredential(bandId, label, username, hashedPassword);

    if (customPassword) {
        req.flash.success(`Credential added for "${band.name}". Username: ${username}`);
    } else {
        req.flash.success(`Credential added for "${band.name}". Username: ${username} | Password: ${password}`);
    }
    res.redirect('/bands');
});

/**
 * POST /admin/bands/:id/credentials/:credId/reset-password
 * Reset password for a band credential
 */
router.post('/admin/bands/:id/credentials/:credId/reset-password', requireAdmin, async (req, res) => {
    const { id: bandId, credId } = req.params;
    const credential = await getCredentialById(credId);

    if (!credential || String(credential.band_id) !== String(bandId)) {
        req.flash.error('Credential not found');
        return res.redirect('/bands');
    }

    const customPassword = req.body.password;
    const newPassword = customPassword || generateRandomPassword();
    const hashedPassword = await hashPassword(newPassword);
    await updateCredentialPassword(credId, hashedPassword);

    if (customPassword) {
        req.flash.success(`Password reset for credential "${credential.label}".`);
    } else {
        req.flash.success(`Password reset for credential "${credential.label}". New password: ${newPassword}`);
    }
    res.redirect('/bands');
});

/**
 * POST /admin/bands/:id/credentials/:credId/delete
 * Delete a band credential
 */
router.post('/admin/bands/:id/credentials/:credId/delete', requireAdmin, async (req, res) => {
    const { id: bandId, credId } = req.params;
    const credential = await getCredentialById(credId);

    if (!credential || String(credential.band_id) !== String(bandId)) {
        req.flash.error('Credential not found');
        return res.redirect('/bands');
    }

    await deleteBandCredential(credId);

    req.flash.success(`Credential "${credential.label}" deleted`);
    res.redirect('/bands');
});

module.exports = router;
