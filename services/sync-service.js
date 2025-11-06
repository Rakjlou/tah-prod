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
        try {
            const transactions = await getTransactionsByBand(bandId);
            const authenticatedClient = await googleAuth.getAuthenticatedClient();
            await syncTransactionsToSheet(authenticatedClient, spreadsheetId, transactions);
        } catch (error) {
            // Log error but don't throw - sync failures shouldn't block the main operation
            console.error('Error syncing to Google Sheets:', error);
            // Silently fail - the main operation (create/update/delete) should succeed
        }
    }
}

module.exports = new SyncService();
