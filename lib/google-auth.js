const { google } = require('googleapis');
const crypto = require('crypto');
const configService = require('./config-service');

const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file'
];

if (!process.env.ENCRYPTION_KEY && process.env.NODE_ENV !== 'test') {
    throw new Error('ENCRYPTION_KEY environment variable is required');
}
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-only-encryption-key-32bytes';
const ALGORITHM = 'aes-256-cbc';

function encrypt(text) {
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
}

function decrypt(text) {
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

async function storeRefreshToken(refreshToken) {
    const encrypted = encrypt(refreshToken);
    await configService.set('google_refresh_token', encrypted);
}

async function getRefreshToken() {
    const encrypted = await configService.get('google_refresh_token');
    if (!encrypted) {
        return null;
    }
    try {
        return decrypt(encrypted);
    } catch (error) {
        console.error('Failed to decrypt refresh token:', error);
        return null;
    }
}

async function getAuthenticatedClient() {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
        throw new Error('No refresh token stored. Admin must authenticate with Google first.');
    }

    const googleAuth = await configService.getGoogleOAuth();
    if (!googleAuth) {
        throw new Error('Google OAuth not configured');
    }

    const oauthClient = new google.auth.OAuth2(
        googleAuth.clientId,
        googleAuth.clientSecret,
        googleAuth.redirectUri
    );

    oauthClient.setCredentials({ refresh_token: refreshToken });
    return oauthClient;
}

async function isAuthenticated() {
    const refreshToken = await getRefreshToken();
    return !!refreshToken;
}

function isInvalidGrantError(error) {
    if (!error) return false;

    // Check for GaxiosError with invalid_grant
    if (error.code === 'invalid_grant' || error.error === 'invalid_grant') {
        return true;
    }

    // Check error message
    const message = error.message?.toLowerCase() || '';
    return message.includes('invalid_grant') ||
           message.includes('token has been expired or revoked');
}

async function clearRefreshToken() {
    console.log('Clearing invalid/expired refresh token from database');
    await configService.set('google_refresh_token', null);
}

async function revokeToken() {
    const refreshToken = await getRefreshToken();

    if (refreshToken) {
        try {
            await fetch(`https://oauth2.googleapis.com/revoke?token=${refreshToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            console.log('Google OAuth token revoked successfully');
        } catch (error) {
            console.log('Token revoke request failed (may already be expired):', error.message);
        }
    }

    await clearRefreshToken();
}

module.exports = {
    storeRefreshToken,
    getRefreshToken,
    getAuthenticatedClient,
    isAuthenticated,
    isInvalidGrantError,
    clearRefreshToken,
    revokeToken,
    SCOPES
};
