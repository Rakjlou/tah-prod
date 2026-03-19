const { runQuery, getOne, getAll } = require('../db-wrapper');
const { buildDynamicUpdate } = require('./helpers');

const createUser = async (username, hashedPassword, role = 0) => {
    const result = await runQuery(
        'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
        [username, hashedPassword, role]
    );
    return result.lastID;
};

const getUserByUsername = (username) =>
    getOne('SELECT * FROM users WHERE username = ?', [username]);

const getUserById = (id) =>
    getOne('SELECT * FROM users WHERE id = ?', [id]);

const updateUserPassword = async (userId, hashedPassword) => {
    await runQuery('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
};

const deleteUser = async (userId) => {
    await runQuery('DELETE FROM users WHERE id = ?', [userId]);
};

const getAllUsers = () =>
    getAll('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');

const updateUser = async (userId, updates) => {
    await buildDynamicUpdate('users', userId, updates, ['username', 'role']);
};

module.exports = {
    createUser,
    getUserByUsername,
    getUserById,
    updateUserPassword,
    deleteUser,
    getAllUsers,
    updateUser
};
