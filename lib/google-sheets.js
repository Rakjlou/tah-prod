const { google } = require('googleapis');

function getFolderNameFromTransaction(transactionId, description) {
    // Extract first three words from description
    const words = description.trim().split(/\s+/).slice(0, 3).join('_').toLowerCase();
    return `${transactionId}_${words}`;
}

async function syncTransactionsToSheet(oauthClient, spreadsheetId, transactions) {
    const sheets = google.sheets({ version: 'v4', auth: oauthClient });

    // Get the actual sheet ID for the "Transactions" tab
    const spreadsheetInfo = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties'
    });

    const transactionsSheet = spreadsheetInfo.data.sheets.find(
        sheet => sheet.properties.title === 'Transactions'
    );

    if (!transactionsSheet) {
        throw new Error('Transactions sheet not found');
    }

    const transactionsSheetId = transactionsSheet.properties.sheetId;

    // Clear existing data (except header row)
    await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: 'Transactions!A2:F'
    });

    if (transactions.length === 0) {
        return;
    }

    // Sort transactions: pending first, then by date descending
    const sortedTransactions = [...transactions].sort((a, b) => {
        // Pending transactions always come first
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;

        // Within same status, sort by date descending (most recent first)
        const dateA = a.transaction_date ? new Date(a.transaction_date) : new Date(0);
        const dateB = b.transaction_date ? new Date(b.transaction_date) : new Date(0);
        return dateB - dateA;
    });

    // Prepare rows
    const rows = sortedTransactions.map((t) => {
        const validated = t.status === 'validated';
        const date = t.transaction_date || '';
        const category = t.category_name || '';
        const description = t.description || '';
        const amount = (t.type === 'expense' ? -1 : 1) * (t.amount || 0);

        // Documents column - hyperlink to folder with folder name as text
        let docsValue = '';
        if (t.drive_folder_id) {
            const folderName = getFolderNameFromTransaction(t.id, t.description);
            const folderUrl = `https://drive.google.com/drive/folders/${t.drive_folder_id}`;
            // Escape double quotes to prevent formula injection
            const escapedFolderName = folderName.replace(/"/g, '""');
            docsValue = `=HYPERLINK("${folderUrl}"; "${escapedFolderName}")`;
        }

        // Header columns: Validated | Date | Category | Description | Documents | Amount
        return [validated, date, category, description, docsValue, amount];
    });

    // Update sheet values
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Transactions!A2',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: rows
        }
    });

    // Apply formatting using batchUpdate
    const requests = [
        // Format column A (Validated) as checkboxes
        {
            repeatCell: {
                range: {
                    sheetId: transactionsSheetId,
                    startColumnIndex: 0,
                    endColumnIndex: 1,
                    startRowIndex: 1,
                    endRowIndex: 1 + sortedTransactions.length
                },
                cell: {
                    dataValidation: {
                        condition: {
                            type: 'BOOLEAN'
                        }
                    }
                },
                fields: 'dataValidation'
            }
        },
        // Format column B (Date) as dates
        {
            repeatCell: {
                range: {
                    sheetId: transactionsSheetId,
                    startColumnIndex: 1,
                    endColumnIndex: 2,
                    startRowIndex: 1,
                    endRowIndex: 1 + sortedTransactions.length
                },
                cell: {
                    userEnteredFormat: {
                        numberFormat: {
                            type: 'DATE'
                        }
                    }
                },
                fields: 'userEnteredFormat.numberFormat'
            }
        },
        // Format column F (Amount) as currency
        {
            repeatCell: {
                range: {
                    sheetId: transactionsSheetId,
                    startColumnIndex: 5,
                    endColumnIndex: 6,
                    startRowIndex: 1,
                    endRowIndex: 1 + sortedTransactions.length
                },
                cell: {
                    userEnteredFormat: {
                        numberFormat: {
                            type: 'CURRENCY'
                        }
                    }
                },
                fields: 'userEnteredFormat.numberFormat'
            }
        }
    ];

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests
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
