const { runQuery } = require('../db-wrapper');

const ALLOWED_SQL_EXPRESSIONS = new Set(['CURRENT_TIMESTAMP']);

const buildDynamicUpdate = async (tableName, id, updates, allowedFields, autoFields = {}) => {
    const fields = [];
    const values = [];

    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            fields.push(`${field} = ?`);
            values.push(updates[field]);
        }
    }

    for (const [field, value] of Object.entries(autoFields)) {
        if (!ALLOWED_SQL_EXPRESSIONS.has(value)) {
            throw new Error(`Disallowed SQL expression in autoFields: ${value}`);
        }
        fields.push(`${field} = ${value}`);
    }

    if (fields.length === 0) {
        return;
    }

    values.push(id);
    await runQuery(`UPDATE ${tableName} SET ${fields.join(', ')} WHERE id = ?`, values);
};

module.exports = { buildDynamicUpdate };
