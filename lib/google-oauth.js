const { google } = require('googleapis');

const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file'
];

function getOAuthClient({ clientId, clientSecret, redirectUri }) {
    if (!clientId || !clientSecret || !redirectUri) {
        throw new Error('Google OAuth credentials not configured');
    }

    return new google.auth.OAuth2(
        clientId,
        clientSecret,
        redirectUri
    );
}

function getAuthUrl(oauthClient) {
    return oauthClient.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
}

async function getTokensFromCode(code, oauthClient) {
    const { tokens } = await oauthClient.getToken(code);
    return tokens;
}

function getAuthenticatedClient(tokens, oauthClient) {
    oauthClient.setCredentials(tokens);
    return oauthClient;
}

module.exports = {
    getOAuthClient,
    getAuthUrl,
    getTokensFromCode,
    getAuthenticatedClient
};
