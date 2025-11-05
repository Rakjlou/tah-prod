const { ROLES, hasRole } = require('../lib/roles');
const {
    getTransactionById,
    getBandById,
    getBandByUserId,
    getAllCategories,
    updateTransaction,
    getTransactionsByBand,
    getTransactionDocuments,
    deleteTransactionDocument,
    addTransactionDocument
} = require('../lib/db');
const googleAuth = require('../lib/google-auth');
const { syncTransactionsToSheet } = require('../lib/google-sheets');
const {
    getTransactionsFolderId,
    createTransactionFolder,
    uploadTransactionDocument,
    deleteFile
} = require('../lib/google-drive');
const qontoDb = require('../lib/qonto-db');

/**
 * Shared handler for transaction detail view (both bands and admins)
 */
async function handleTransactionDetail(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        const transaction = await getTransactionById(req.params.id);

        if (!transaction) {
            req.session.error = 'Transaction not found';
            return res.redirect(isAdmin ? '/admin/transactions' : '/transactions');
        }

        // Get band information
        const band = await getBandById(transaction.band_id);

        // Verify ownership for bands
        if (!isAdmin) {
            const userBand = await getBandByUserId(req.session.user.id);
            if (!userBand || transaction.band_id !== userBand.id) {
                req.session.error = 'Access denied';
                return res.redirect('/transactions');
            }
        }

        const categories = await getAllCategories();
        const documents = await getTransactionDocuments(req.params.id);

        // Fetch linked Qonto transactions if admin
        let linkedQontoTransactions = [];
        if (isAdmin) {
            try {
                linkedQontoTransactions = await qontoDb.getLinkedTransactions(transaction.id);
            } catch (error) {
                console.error('Error fetching linked Qonto transactions:', error);
                // Non-critical error, continue without Qonto data
            }
        }

        const urlPrefix = isAdmin ? '/admin/transactions' : '/transactions';
        const backUrl = isAdmin ? '/admin/transactions' : '/transactions';

        res.render('transaction-detail', {
            transaction,
            categories,
            documents,
            urlPrefix,
            backUrl,
            isAdmin,
            band,
            linkedQontoTransactions
        });
    } catch (error) {
        console.error('Error loading transaction details:', error);
        req.session.error = 'Failed to load transaction details';
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect(isAdmin ? '/admin/transactions' : '/transactions');
    }
}

/**
 * Shared handler for transaction edit (both bands and admins)
 */
async function handleTransactionEdit(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        const transaction = await getTransactionById(req.params.id);

        if (!transaction) {
            req.session.error = 'Transaction not found';
            return res.redirect(isAdmin ? '/admin/transactions' : '/transactions');
        }

        // Verify ownership for bands
        if (!isAdmin) {
            const band = await getBandByUserId(req.session.user.id);
            if (!band || transaction.band_id !== band.id) {
                req.session.error = 'Access denied';
                return res.redirect('/transactions');
            }
            // Bands can only edit pending transactions
            if (transaction.status !== 'pending') {
                req.session.error = 'Cannot edit validated transaction';
                return res.redirect('/transactions/' + req.params.id);
            }
        }

        const { type, category_id, amount, description, status, transaction_date, clear_date } = req.body;

        const updates = {
            type,
            category_id: parseInt(category_id),
            amount: parseFloat(amount),
            description
        };

        // Only admins can change status and transaction_date
        if (isAdmin) {
            if (status) updates.status = status;
            if (clear_date === 'true') {
                updates.transaction_date = null;
            } else if (transaction_date) {
                updates.transaction_date = transaction_date;
            }
        }

        await updateTransaction(req.params.id, updates);

        // Sync to Google Sheets
        const band = await getBandById(transaction.band_id);
        if (!band) {
            req.session.error = 'Associated band not found';
            return res.redirect(isAdmin ? '/admin/transactions' : '/transactions');
        }
        const transactions = await getTransactionsByBand(transaction.band_id);
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        req.session.success = 'Transaction updated successfully';
        res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + req.params.id);
    } catch (error) {
        console.error('Error updating transaction:', error);
        req.session.error = 'Failed to update transaction';
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + req.params.id);
    }
}

/**
 * Shared handler for create folder (both bands and admins)
 */
async function handleCreateFolder(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        const transaction = await getTransactionById(req.params.id);

        if (!transaction) {
            req.session.error = 'Transaction not found';
            return res.redirect(isAdmin ? '/admin/transactions' : '/transactions');
        }

        // Verify ownership for bands
        if (!isAdmin) {
            const band = await getBandByUserId(req.session.user.id);
            if (!band || transaction.band_id !== band.id) {
                req.session.error = 'Access denied';
                return res.redirect('/transactions');
            }
        }

        if (transaction.drive_folder_id) {
            req.session.error = 'Folder already exists';
            return res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + req.params.id);
        }

        const band = await getBandById(transaction.band_id);
        if (!band) {
            req.session.error = 'Associated band not found';
            return res.redirect(isAdmin ? '/admin/transactions' : '/transactions');
        }
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        const transactionsFolderId = await getTransactionsFolderId(authenticatedClient, band.folder_id);
        const folderId = await createTransactionFolder(
            authenticatedClient,
            transactionsFolderId,
            transaction.id,
            transaction.description
        );

        await updateTransaction(req.params.id, { drive_folder_id: folderId });

        // Sync to Google Sheets to update Documents column
        const transactions = await getTransactionsByBand(transaction.band_id);
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        req.session.success = 'Documents folder created successfully';
        res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + req.params.id);
    } catch (error) {
        console.error('Error creating folder:', error);
        req.session.error = 'Failed to create documents folder';
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + req.params.id);
    }
}

/**
 * Shared handler for upload documents (both bands and admins)
 */
async function handleUploadDocuments(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        const transaction = await getTransactionById(req.params.id);

        if (!transaction) {
            req.session.error = 'Transaction not found';
            return res.redirect(isAdmin ? '/admin/transactions' : '/transactions');
        }

        // Verify ownership for bands
        if (!isAdmin) {
            const band = await getBandByUserId(req.session.user.id);
            if (!band || transaction.band_id !== band.id) {
                req.session.error = 'Access denied';
                return res.redirect('/transactions');
            }
        }

        if (!req.files || req.files.length === 0) {
            req.session.error = 'No files selected';
            return res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + req.params.id);
        }

        const band = await getBandById(transaction.band_id);
        if (!band) {
            req.session.error = 'Associated band not found';
            return res.redirect(isAdmin ? '/admin/transactions' : '/transactions');
        }
        const authenticatedClient = await googleAuth.getAuthenticatedClient();

        // Create folder if it doesn't exist
        let folderId = transaction.drive_folder_id;
        if (!folderId) {
            const transactionsFolderId = await getTransactionsFolderId(authenticatedClient, band.folder_id);
            folderId = await createTransactionFolder(authenticatedClient, transactionsFolderId, transaction.id, transaction.description);
            await updateTransaction(transaction.id, { drive_folder_id: folderId });
        }

        // Upload each file
        for (const file of req.files) {
            const driveFileId = await uploadTransactionDocument(authenticatedClient, folderId, file.buffer, file.originalname);
            await addTransactionDocument(transaction.id, driveFileId, file.originalname);
        }

        // Sync to Google Sheets (to update Documents column)
        const transactions = await getTransactionsByBand(transaction.band_id);
        await syncTransactionsToSheet(authenticatedClient, band.accounting_spreadsheet_id, transactions);

        req.session.success = `${req.files.length} document(s) uploaded successfully`;
        res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + req.params.id);
    } catch (error) {
        console.error('Error uploading documents:', error);
        req.session.error = 'Failed to upload documents';
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + req.params.id);
    }
}

/**
 * Shared handler for delete document (both bands and admins)
 */
async function handleDeleteDocument(req, res) {
    try {
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        const transaction = await getTransactionById(req.params.id);

        if (!transaction) {
            req.session.error = 'Transaction not found';
            return res.redirect(isAdmin ? '/admin/transactions' : '/transactions');
        }

        // Verify ownership for bands
        if (!isAdmin) {
            const band = await getBandByUserId(req.session.user.id);
            if (!band || transaction.band_id !== band.id) {
                req.session.error = 'Access denied';
                return res.redirect('/transactions');
            }
        }

        const documents = await getTransactionDocuments(req.params.id);
        const document = documents.find(d => d.id === parseInt(req.params.docId));

        if (!document) {
            req.session.error = 'Document not found';
            return res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + req.params.id);
        }

        // Delete from Drive
        const authenticatedClient = await googleAuth.getAuthenticatedClient();
        await deleteFile(authenticatedClient, document.drive_file_id);

        // Delete from DB
        await deleteTransactionDocument(req.params.docId);

        req.session.success = 'Document deleted successfully';
        res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + req.params.id);
    } catch (error) {
        console.error('Error deleting document:', error);
        req.session.error = 'Failed to delete document';
        const isAdmin = hasRole(req.session.user.role, ROLES.ADMIN);
        res.redirect((isAdmin ? '/admin/transactions/' : '/transactions/') + req.params.id);
    }
}

module.exports = {
    handleTransactionDetail,
    handleTransactionEdit,
    handleCreateFolder,
    handleUploadDocuments,
    handleDeleteDocument
};
