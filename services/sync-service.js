const googleAuth = require('../lib/google-auth');
const { syncTransactionsToSheet } = require('../lib/google-sheets');
const { getTransactionsByBand } = require('../lib/db');
const { ExternalServiceError } = require('../lib/errors');

/**
 * Sync Service
 * Handles synchronization with external services (Google Sheets)
 */
class SyncService {
    /**
     * Sync band transactions to Google Sheets
     * @param {number} bandId - Band ID
     * @param {string} spreadsheetId - Google Sheets spreadsheet ID
     */
    async syncBandTransactions(bandId, spreadsheetId) {
        if (!spreadsheetId) return;

        try {
            const transactions = await getTransactionsByBand(bandId);
            const authenticatedClient = await googleAuth.getAuthenticatedClient();
            await syncTransactionsToSheet(authenticatedClient, spreadsheetId, transactions);
        } catch (error) {
            console.error('Error syncing to Google Sheets:', error);
        }
    }
}

module.exports = new SyncService();
