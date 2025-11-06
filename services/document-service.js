const googleAuth = require('../lib/google-auth');
const {
    getTransactionsFolderId,
    createTransactionFolder,
    uploadTransactionDocument,
    deleteTransactionFolder
} = require('../lib/google-drive');
const { addTransactionDocument } = require('../lib/db');
const { ExternalServiceError } = require('../lib/errors');

/**
 * Document Service
 * Handles all document-related business logic (Google Drive)
 */
class DocumentService {
    /**
     * Create transaction folder and upload documents
     * @param {number} transactionId - Transaction ID
     * @param {string} description - Transaction description
     * @param {string} bandFolderId - Band's folder ID in Google Drive
     * @param {Array} files - Array of uploaded files
     * @returns {Promise<string>} Created folder ID
     */
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

    /**
     * Upload documents to existing transaction folder
     * @param {number} transactionId - Transaction ID
     * @param {string} folderId - Existing folder ID
     * @param {Array} files - Array of uploaded files
     */
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

    /**
     * Delete transaction folder from Google Drive
     * @param {string} folderId - Folder ID to delete
     */
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
