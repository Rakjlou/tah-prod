const qontoApi = require('./qonto-api');
const qontoDb = require('./qonto-db');

let syncInProgress = false;

/**
 * Sync Qonto transactions incrementally
 * - On first sync: Fetch all completed transactions
 * - On subsequent syncs: Fetch only transactions since last sync date
 *
 * @param {boolean} force - Force full sync (ignore last sync date)
 * @returns {Promise<{synced: number, total: number, from: string|null, to: string}>}
 */
async function syncTransactions(force = false) {
    if (syncInProgress) {
        throw new Error('Sync already in progress, please wait');
    }

    syncInProgress = true;
    try {
    let lastSyncDate = null;
    let lastSyncedQontoId = null;

    if (!force) {
        // Get the newest transaction - use its date and ID for incremental sync
        const newestTransaction = await qontoDb.getNewestQontoTransaction();
        if (newestTransaction) {
            lastSyncDate = newestTransaction.settled_at;
            lastSyncedQontoId = newestTransaction.qonto_id;
        }
    }

    // Get organization to find bank account (required by Qonto API)
    const { bank_accounts } = await qontoApi.getOrganization();
    if (!bank_accounts || bank_accounts.length === 0) {
        throw new Error('No bank accounts found in Qonto organization');
    }

    const bankAccountId = bank_accounts[0].id;

    // Prepare filters for Qonto API
    const filters = {
        bank_account_id: bankAccountId,
        status: ['completed']
    };

    // Only fetch transactions after the last sync date (if exists)
    if (lastSyncDate) {
        filters.settled_at_from = lastSyncDate;
    }

    // Fetch transactions from Qonto API
    let transactions = await qontoApi.fetchTransactions(filters);

    // Filter out the last synced transaction (to avoid re-fetching the same one)
    if (lastSyncedQontoId) {
        transactions = transactions.filter(tx => tx.id !== lastSyncedQontoId);
    }

    // Upsert transactions into cache
    let syncedCount = 0;
    for (const tx of transactions) {
        await qontoDb.upsertQontoTransaction(tx);
        syncedCount++;
    }

    // Get total count from cache
    const totalCached = await qontoDb.getQontoTransactionCount();

        return {
            synced: syncedCount,
            total: totalCached,
            from: lastSyncDate,
            to: new Date().toISOString()
        };
    } finally {
        syncInProgress = false;
    }
}

/**
 * Get cached transactions with optional filters
 * @param {Object} filters - Optional filters (date range, amount, etc.)
 * @returns {Promise<Array>}
 */
async function getCachedTransactions(filters = {}) {
    return await qontoDb.getQontoTransactions(filters);
}

/**
 * Get a single cached transaction by Qonto ID
 * @param {string} qontoId - Qonto transaction UUID
 * @returns {Promise<Object|null>}
 */
async function getCachedTransaction(qontoId) {
    return await qontoDb.getQontoTransactionByQontoId(qontoId);
}

/**
 * Force refresh a specific transaction from the API
 * @param {string} qontoId - Qonto transaction UUID
 * @returns {Promise<Object>}
 */
async function refreshTransaction(qontoId) {
    // Note: Qonto API doesn't have a "get by ID" endpoint
    // So we'll do a full sync and return the cached version
    await syncTransactions();
    return await getCachedTransaction(qontoId);
}


/**
 * Clear all cached transactions (for testing/maintenance)
 * @returns {Promise<void>}
 */
async function clearCache() {
    await qontoDb.clearQontoCache();
}

/**
 * Get cache statistics
 * @returns {Promise<Object>}
 */
async function getCacheStats() {
    const totalCount = await qontoDb.getQontoTransactionCount();
    const oldestTransaction = await qontoDb.getOldestQontoTransaction();
    const newestTransaction = await qontoDb.getNewestQontoTransaction();

    return {
        totalCached: totalCount,
        lastSyncDate: newestTransaction ? newestTransaction.settled_at : null,
        oldestTransaction: oldestTransaction ? oldestTransaction.settled_at : null,
        newestTransaction: newestTransaction ? newestTransaction.settled_at : null
    };
}

module.exports = {
    syncTransactions,
    getCachedTransactions,
    getCachedTransaction,
    refreshTransaction,
    clearCache,
    getCacheStats
};
