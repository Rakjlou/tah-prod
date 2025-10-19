const { google } = require('googleapis');

async function createBandSpreadsheet(oauthClient, bandName, bandEmail, folderId) {
    const drive = google.drive({ version: 'v3', auth: oauthClient });
    const sheets = google.sheets({ version: 'v4', auth: oauthClient });

    // Create new spreadsheet with header row
    const createResponse = await sheets.spreadsheets.create({
        requestBody: {
            properties: {
                title: `${bandName} - Accounting`
            },
            sheets: [{
                properties: { title: 'Transactions' },
                data: [{
                    rowData: [{
                        values: [
                            { userEnteredValue: { stringValue: 'Date' } },
                            { userEnteredValue: { stringValue: 'Description' } },
                            { userEnteredValue: { stringValue: 'Amount' } },
                            { userEnteredValue: { stringValue: 'Balance' } },
                            { userEnteredValue: { stringValue: 'Category' } },
                            { userEnteredValue: { stringValue: 'Notes' } }
                        ]
                    }]
                }]
            }]
        }
    });

    const spreadsheetId = createResponse.data.spreadsheetId;

    // Move spreadsheet to specified folder if folderId is provided
    if (folderId && folderId.trim()) {
        await drive.files.update({
            fileId: spreadsheetId,
            addParents: folderId,
            fields: 'id, parents'
        });
    }

    // Share with band email as reader
    await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: {
            type: 'user',
            role: 'reader',
            emailAddress: bandEmail
        },
        sendNotificationEmail: false
    });

    return {
        spreadsheetId,
        url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
    };
}

function getSpreadsheetUrl(spreadsheetId) {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}

module.exports = {
    createBandSpreadsheet,
    getSpreadsheetUrl
};
