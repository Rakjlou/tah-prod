const { runQuery, getAll } = require('../db-wrapper');

const addTransactionDocument = async (transactionId, driveFileId, filename) => {
    const result = await runQuery(
        'INSERT INTO transaction_documents (transaction_id, drive_file_id, filename) VALUES (?, ?, ?)',
        [transactionId, driveFileId, filename]
    );
    return result.lastID;
};

const getTransactionDocuments = (transactionId) =>
    getAll(
        'SELECT * FROM transaction_documents WHERE transaction_id = ? ORDER BY uploaded_at DESC',
        [transactionId]
    );

const deleteTransactionDocument = async (id) => {
    await runQuery('DELETE FROM transaction_documents WHERE id = ?', [id]);
};

module.exports = {
    addTransactionDocument,
    getTransactionDocuments,
    deleteTransactionDocument
};
