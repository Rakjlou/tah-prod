const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const SESSIONS_DB_PATH = path.join(__dirname, '..', 'data', 'sessions.db');

/**
 * Destroys all sessions for a specific user
 * @param {number} userId - The user ID
 * @param {object} sessionStore - The session store instance
 * @returns {Promise<void>}
 */
function destroyUserSessions(userId, sessionStore) {
    return new Promise((resolve, reject) => {
        const sessionsDb = new sqlite3.Database(SESSIONS_DB_PATH);

        sessionsDb.all('SELECT sid, sess FROM sessions', [], (err, rows) => {
            if (err) {
                sessionsDb.close();
                return reject(err);
            }

            const destroyPromises = [];
            rows.forEach(row => {
                try {
                    const sessionData = JSON.parse(row.sess);
                    if (sessionData && sessionData.user && sessionData.user.id === userId) {
                        destroyPromises.push(
                            new Promise((res, rej) => {
                                sessionStore.destroy(row.sid, (err) => {
                                    if (err) rej(err);
                                    else res();
                                });
                            })
                        );
                    }
                } catch (parseError) {
                    // Skip invalid session data
                }
            });

            Promise.all(destroyPromises)
                .then(() => {
                    sessionsDb.close();
                    resolve();
                })
                .catch((err) => {
                    sessionsDb.close();
                    reject(err);
                });
        });
    });
}

/**
 * Generates a random 12-character password
 * @returns {string}
 */
function generateRandomPassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

module.exports = {
    destroyUserSessions,
    generateRandomPassword
};
