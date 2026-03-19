const { runQuery, getOne, getAll } = require('../db-wrapper');

const createBandCredential = async (bandId, label, username, hashedPassword) => {
    const result = await runQuery(
        'INSERT INTO band_credentials (band_id, label, username, password) VALUES (?, ?, ?, ?)',
        [bandId, label, username, hashedPassword]
    );
    return result.lastID;
};

const getCredentialByUsername = (username) =>
    getOne('SELECT * FROM band_credentials WHERE username = ?', [username]);

const getCredentialsByBandId = (bandId) =>
    getAll('SELECT * FROM band_credentials WHERE band_id = ? ORDER BY created_at', [bandId]);

const getAllBandCredentials = () =>
    getAll('SELECT * FROM band_credentials ORDER BY created_at');

const getCredentialById = (id) =>
    getOne('SELECT * FROM band_credentials WHERE id = ?', [id]);

const updateCredentialPassword = async (id, hashedPassword) => {
    await runQuery('UPDATE band_credentials SET password = ? WHERE id = ?', [hashedPassword, id]);
};

const deleteBandCredential = async (id) => {
    await runQuery('DELETE FROM band_credentials WHERE id = ?', [id]);
};

module.exports = {
    createBandCredential,
    getCredentialByUsername,
    getCredentialsByBandId,
    getAllBandCredentials,
    getCredentialById,
    updateCredentialPassword,
    deleteBandCredential
};
