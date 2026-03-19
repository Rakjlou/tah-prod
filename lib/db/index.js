const { getDatabasePath } = require('../db-wrapper');

module.exports = {
    getDatabase: () => {
        const sqlite3 = require('sqlite3').verbose();
        return new sqlite3.Database(getDatabasePath());
    },
    ...require('./schema'),
    ...require('./users'),
    ...require('./config'),
    ...require('./bands'),
    ...require('./categories'),
    ...require('./transactions'),
    ...require('./documents'),
    ...require('./invoices'),
    ...require('./credentials')
};
