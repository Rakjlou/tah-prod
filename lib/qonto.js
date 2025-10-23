// TODO: Integrate with Qonto API when ready
// API docs: https://api-doc.qonto.com/

/**
 * Fetch bank transactions from Qonto
 * @param {string} startDate - Start date for transaction query
 * @param {string} endDate - End date for transaction query
 * @returns {Promise<Array>} Array of bank transactions
 */
async function fetchBankTransactions(startDate, endDate) {
    // Placeholder: Returns empty array
    console.log('TODO: Implement Qonto transaction fetching');
    console.log(`Query range: ${startDate} to ${endDate}`);
    return [];
}

/**
 * Sync bank balance from Qonto
 * @returns {Promise<number>} Current bank balance
 */
async function syncBankBalance() {
    // Placeholder: Returns 0
    console.log('TODO: Implement bank balance sync');
    return 0;
}

// Note: Do NOT pre-assume database structure for linking
// Qonto integration will be designed when API is explored

module.exports = {
    fetchBankTransactions,
    syncBankBalance
};
