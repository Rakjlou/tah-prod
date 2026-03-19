const { runQuery, getOne, getAll } = require('../db-wrapper');

const getConfig = async (key) => {
    const row = await getOne('SELECT value FROM config WHERE key = ?', [key]);
    return row ? row.value : null;
};

const setConfig = async (key, value) => {
    await runQuery(
        'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [key, value]
    );
};

const getAllConfig = async () => {
    const rows = await getAll('SELECT key, value FROM config');
    const config = {};
    rows.forEach(row => {
        config[row.key] = row.value;
    });
    return config;
};

module.exports = { getConfig, setConfig, getAllConfig };
