const { google } = require('googleapis');

async function syncTransactionsToSheet(oauthClient, spreadsheetId, transactions) {
    const sheets = google.sheets({ version: 'v4', auth: oauthClient });

    // Clear existing data (except header row)
    await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: 'Transactions!A2:G'
    });

    if (transactions.length === 0) {
        return;
    }

    // Prepare rows
    const rows = transactions.map((t, index) => {
        const date = t.transaction_date || '';
        const type = t.type.charAt(0).toUpperCase() + t.type.slice(1);
        const category = t.category_name || '';
        const description = t.description || '';
        const amount = t.amount || 0;
        const status = t.status.charAt(0).toUpperCase() + t.status.slice(1);

        // Documents link (if folder exists)
        const docsLink = t.drive_folder_id
            ? `https://drive.google.com/drive/folders/${t.drive_folder_id}`
            : '';

        // Header columns: Date | Type | Category | Description | Amount | Status | Documents
        return [date, type, category, description, amount, status, docsLink];
    });

    // Update sheet
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Transactions!A2',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: rows
        }
    });
}

async function updateTransactionInSheet(oauthClient, spreadsheetId, transactionId, transaction) {
    // For now, just resync all transactions
    // This is simpler and ensures consistency
    // TODO: Optimize to update single row if performance becomes an issue
    const { getTransactionsByBand } = require('./db');
    const transactions = await getTransactionsByBand(transaction.band_id);
    await syncTransactionsToSheet(oauthClient, spreadsheetId, transactions);
}

module.exports = {
    syncTransactionsToSheet,
    updateTransactionInSheet
};
