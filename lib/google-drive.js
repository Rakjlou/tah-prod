const { google } = require('googleapis');

async function createBandStructure(oauthClient, bandName, bandEmail, parentFolderId) {
    const drive = google.drive({ version: 'v3', auth: oauthClient });
    const sheets = google.sheets({ version: 'v4', auth: oauthClient });

    // Create band root folder: "Tah Prod - {Band Name}"
    const folderMetadata = {
        name: `Tah Prod - ${bandName}`,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
    };

    const folderResponse = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
    });

    const folderId = folderResponse.data.id;

    // Create "Accounting" spreadsheet inside band folder
    const createResponse = await sheets.spreadsheets.create({
        requestBody: {
            properties: {
                title: 'Accounting'
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

    const accountingSpreadsheetId = createResponse.data.spreadsheetId;

    // Move spreadsheet to band folder
    await drive.files.update({
        fileId: accountingSpreadsheetId,
        addParents: folderId,
        fields: 'id, parents'
    });

    // Create "Invoices" folder inside band folder
    const invoicesFolderMetadata = {
        name: 'Invoices',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [folderId]
    };

    const invoicesFolderResponse = await drive.files.create({
        requestBody: invoicesFolderMetadata,
        fields: 'id'
    });

    const invoicesFolderId = invoicesFolderResponse.data.id;

    // Share band folder with band email as reader (gives access to everything inside)
    await drive.permissions.create({
        fileId: folderId,
        requestBody: {
            type: 'user',
            role: 'reader',
            emailAddress: bandEmail
        },
        sendNotificationEmail: false
    });

    return {
        folderId,
        accountingSpreadsheetId,
        invoicesFolderId
    };
}

function getSpreadsheetUrl(spreadsheetId) {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}

function getFolderUrl(folderId) {
    return `https://drive.google.com/drive/folders/${folderId}`;
}

module.exports = {
    createBandStructure,
    getSpreadsheetUrl,
    getFolderUrl
};
