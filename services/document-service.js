const googleAuth = require('../lib/google-auth');
const {
    getTransactionsFolderId,
    createTransactionFolder,
    uploadTransactionDocument,
    deleteTransactionFolder
} = require('../lib/google-drive');
const { addTransactionDocument } = require('../lib/db');
const { ExternalServiceError } = require('../lib/errors');

class DocumentService {
    async createFolderAndUploadDocuments(transactionId, description, bandFolderId, files) {
        try {
            const authenticatedClient = await googleAuth.getAuthenticatedClient();
            const transactionsFolderId = await getTransactionsFolderId(authenticatedClient, bandFolderId);
            const folderId = await createTransactionFolder(authenticatedClient, transactionsFolderId, transactionId, description);

            // Upload each file
            for (const file of files) {
                const driveFileId = await uploadTransactionDocument(
                    authenticatedClient,
                    folderId,
                    file.buffer,
                    file.originalname
                );
                await addTransactionDocument(transactionId, driveFileId, file.originalname);
            }

            return folderId;
        } catch (error) {
            throw new ExternalServiceError('Google Drive', error);
        }
    }

    async uploadDocuments(transactionId, folderId, files) {
        try {
            const authenticatedClient = await googleAuth.getAuthenticatedClient();

            for (const file of files) {
                const driveFileId = await uploadTransactionDocument(
                    authenticatedClient,
                    folderId,
                    file.buffer,
                    file.originalname
                );
                await addTransactionDocument(transactionId, driveFileId, file.originalname);
            }
        } catch (error) {
            throw new ExternalServiceError('Google Drive', error);
        }
    }

    async deleteFolder(folderId) {
        if (!folderId) {
            return;
        }

        try {
            const authenticatedClient = await googleAuth.getAuthenticatedClient();
            await deleteTransactionFolder(authenticatedClient, folderId);
        } catch (error) {
            throw new ExternalServiceError('Google Drive', error);
        }
    }
}

module.exports = new DocumentService();
