const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'tahprod.db');

function getDatabase() {
    return new sqlite3.Database(DB_PATH);
}

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) {
                db.close();
                return reject(err);
            }

            db.run(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
                ON users(username)
            `, (err) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    });
}

function createUser(username, hashedPassword, role = 0) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.run(
            'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
            [username, hashedPassword, role],
            function(err) {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(this.lastID);
            }
        );
    });
}

function getUserByUsername(username) {
    return new Promise((resolve, reject) => {
        const db = getDatabase();

        db.get(
            'SELECT * FROM users WHERE username = ?',
            [username],
            (err, row) => {
                db.close();
                if (err) {
                    return reject(err);
                }
                resolve(row);
            }
        );
    });
}

module.exports = {
    getDatabase,
    initializeDatabase,
    createUser,
    getUserByUsername
};
