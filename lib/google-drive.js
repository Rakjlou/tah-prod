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
            sheets: [
                {
                    properties: { title: 'Transactions' },
                    data: [{
                        rowData: [{
                            values: [
                                { userEnteredValue: { stringValue: 'Validated' } },
                                { userEnteredValue: { stringValue: 'Date' } },
                                { userEnteredValue: { stringValue: 'Category' } },
                                { userEnteredValue: { stringValue: 'Description' } },
                                { userEnteredValue: { stringValue: 'Documents' } },
                                { userEnteredValue: { stringValue: 'Amount' } }
                            ]
                        }]
                    }]
                },
                {
                    properties: { title: 'Summary' },
                    data: [{
                        rowData: [
                            {
                                values: [
                                    { userEnteredValue: { stringValue: 'Metric' } },
                                    { userEnteredValue: { stringValue: 'Value' } }
                                ]
                            },
                            {
                                values: [
                                    { userEnteredValue: { stringValue: 'Current Balance' } },
                                    { userEnteredValue: { formulaValue: '=SUMIF(Transactions!A:A, TRUE, Transactions!F:F)' } }
                                ]
                            },
                            {
                                values: [
                                    { userEnteredValue: { stringValue: 'Pending Transactions Amount' } },
                                    { userEnteredValue: { formulaValue: '=SUMIF(Transactions!A:A, FALSE, Transactions!F:F)' } }
                                ]
                            }
                        ]
                    }]
                }
            ]
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
    // Skip sharing if email is falsy OR if it's a test email (ends with test.local)
    if (bandEmail && !bandEmail.endsWith('test.local')) {
        await drive.permissions.create({
            fileId: folderId,
            requestBody: {
                type: 'user',
                role: 'reader',
                emailAddress: bandEmail
            },
            sendNotificationEmail: false
        });
    }

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

async function createTransactionFolder(oauthClient, parentFolderId, transactionId, description) {
    const drive = google.drive({ version: 'v3', auth: oauthClient });

    // Extract first three words from description
    const words = description.trim().split(/\s+/).slice(0, 3).join('_').toLowerCase();
    const folderName = `${transactionId}_${words}`;

    const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
    };

    const folderResponse = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
    });

    return folderResponse.data.id;
}

async function uploadTransactionDocument(oauthClient, folderId, fileBuffer, filename) {
    const drive = google.drive({ version: 'v3', auth: oauthClient });
    const { Readable } = require('stream');

    const fileMetadata = {
        name: filename,
        parents: [folderId]
    };

    const media = {
        body: Readable.from(fileBuffer)
    };

    const fileResponse = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id'
    });

    return fileResponse.data.id;
}

async function deleteTransactionFolder(oauthClient, folderId) {
    const drive = google.drive({ version: 'v3', auth: oauthClient });

    await drive.files.delete({
        fileId: folderId
    });
}

async function deleteFile(oauthClient, fileId) {
    const drive = google.drive({ version: 'v3', auth: oauthClient });

    await drive.files.delete({
        fileId: fileId
    });
}

async function getTransactionsFolderId(oauthClient, bandFolderId) {
    const drive = google.drive({ version: 'v3', auth: oauthClient });

    // Check if Transactions folder already exists
    const query = `name='Transactions' and '${bandFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const response = await drive.files.list({
        q: query,
        fields: 'files(id, name)',
        spaces: 'drive'
    });

    if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id;
    }

    // Create Transactions folder if it doesn't exist
    const folderMetadata = {
        name: 'Transactions',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [bandFolderId]
    };

    const folderResponse = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
    });

    return folderResponse.data.id;
}

module.exports = {
    createBandStructure,
    getSpreadsheetUrl,
    getFolderUrl,
    createTransactionFolder,
    uploadTransactionDocument,
    deleteTransactionFolder,
    deleteFile,
    getTransactionsFolderId
};
