const { getConfig, setConfig } = require('./db');

class ConfigService {
    constructor() {
        this.memo = {}; // Simple in-memory store for memoized values
    }

    async get(key) {
        // If we've already fetched this key, return memoized value
        if (key in this.memo) {
            return this.memo[key];
        }

        // Otherwise fetch from DB and memoize
        const value = await getConfig(key);
        this.memo[key] = value;
        return value;
    }

    async set(key, value) {
        // Save to DB
        await setConfig(key, value);
        // Update memoized value
        this.memo[key] = value;
    }

    // Convenience method for Google OAuth credentials
    async getGoogleOAuth() {
        const clientId = await this.get('google_client_id');
        const clientSecret = await this.get('google_client_secret');
        const redirectUri = await this.get('google_redirect_uri');

        if (!clientId || !clientSecret || !redirectUri) {
            return null;
        }

        return { clientId, clientSecret, redirectUri };
    }

    async getGoogleDriveFolderId() {
        const folderId = await this.get('google_drive_folder_id');

        if (!folderId || !folderId.trim()) {
            throw new Error('Google Drive folder ID is required but not configured');
        }

        return folderId;
    }

    async getOrganizationBandId() {
        const bandId = await this.get('org_band_id');
        return bandId ? parseInt(bandId, 10) : null;
    }

    async setOrganizationBandId(bandId) {
        await this.set('org_band_id', bandId.toString());
    }
}

module.exports = new ConfigService();
