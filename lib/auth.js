const bcrypt = require('bcrypt');
const crypto = require('crypto');

const SALT_ROUNDS = 10;

async function hashPassword(password) {
    return await bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

function generateRandomPassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(crypto.randomInt(chars.length));
    }
    return password;
}

module.exports = {
    hashPassword,
    verifyPassword,
    generateRandomPassword
};
