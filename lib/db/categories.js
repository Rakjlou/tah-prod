const { runQuery, getAll } = require('../db-wrapper');
const { buildDynamicUpdate } = require('./helpers');

const createCategory = async (name, type) => {
    const result = await runQuery(
        'INSERT INTO transaction_categories (name, type) VALUES (?, ?)',
        [name, type]
    );
    return result.lastID;
};

const getAllCategories = () =>
    getAll('SELECT * FROM transaction_categories ORDER BY name ASC');

const getCategoriesByType = (type) =>
    getAll(
        'SELECT * FROM transaction_categories WHERE type = ? OR type = ? ORDER BY name ASC',
        [type, 'both']
    );

const updateCategory = async (id, updates) => {
    await buildDynamicUpdate('transaction_categories', id, updates, [
        'name',
        'type'
    ]);
};

const deleteCategory = async (id) => {
    await runQuery('DELETE FROM transaction_categories WHERE id = ?', [id]);
};

const seedDefaultCategories = async () => {
    const existing = await getAllCategories();
    if (existing.length > 0) {
        return;
    }

    const defaultCategories = [
        { name: 'Gear', type: 'expense' },
        { name: 'Travel', type: 'expense' },
        { name: 'Marketing', type: 'expense' },
        { name: 'Studio', type: 'expense' },
        { name: 'Music revenue', type: 'income' },
        { name: 'Merchandising', type: 'both' },
        { name: 'Gig', type: 'both' },
        { name: 'Other', type: 'both' }
    ];

    for (const category of defaultCategories) {
        await createCategory(category.name, category.type);
    }
};

module.exports = {
    createCategory,
    getAllCategories,
    getCategoriesByType,
    updateCategory,
    deleteCategory,
    seedDefaultCategories
};
