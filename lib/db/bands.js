const { runQuery, getOne, getAll } = require('../db-wrapper');
const { buildDynamicUpdate } = require('./helpers');

const createBand = async (name, email, userId, folderId, accountingSpreadsheetId, invoicesFolderId) => {
    const result = await runQuery(
        'INSERT INTO bands (name, email, user_id, folder_id, accounting_spreadsheet_id, invoices_folder_id) VALUES (?, ?, ?, ?, ?, ?)',
        [name, email, userId, folderId, accountingSpreadsheetId, invoicesFolderId]
    );
    return result.lastID;
};

const getBandById = (id) =>
    getOne('SELECT * FROM bands WHERE id = ?', [id]);

const getAllBands = () =>
    getAll('SELECT * FROM bands ORDER BY created_at DESC');

const getBandByUserId = (userId) =>
    getOne('SELECT * FROM bands WHERE user_id = ?', [userId]);

const updateBand = async (id, updates) => {
    await buildDynamicUpdate('bands', id, updates, [
        'name',
        'email',
        'folder_id',
        'accounting_spreadsheet_id',
        'invoices_folder_id'
    ]);
};

const deleteBand = async (id) => {
    await runQuery('DELETE FROM bands WHERE id = ?', [id]);
};

module.exports = {
    createBand,
    getBandById,
    getAllBands,
    getBandByUserId,
    updateBand,
    deleteBand
};
