const qontoApi = require('./qonto-api');
const qontoDb = require('./qonto-db');

let syncInProgress = false;

/**
 * Get the last sync date from the database
 * @returns {Promise<string|null>} ISO date string or null if never synced
 */
async function getLastSyncDate() {
    return await qontoDb.getLastSyncDate();
}

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

    if (!force) {
        lastSyncDate = await getLastSyncDate();
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
    const transactions = await qontoApi.fetchTransactions(filters);

    // Ensure organization exists before inserting transactions (required for foreign key)
    if (transactions.length > 0 || !lastSyncDate) {
        await qontoDb.updateLastSyncDate(lastSyncDate || new Date().toISOString());
    }

    // Upsert transactions into cache
    let syncedCount = 0;
    for (const tx of transactions) {
        await qontoDb.upsertQontoTransaction(tx);
        syncedCount++;
    }

    // Update last sync date to the most recent settled_at from this batch
    if (transactions.length > 0) {
        const latestSettledAt = transactions.reduce((latest, tx) => {
            const settledAt = tx.settled_at || tx.emitted_at;
            return settledAt > latest ? settledAt : latest;
        }, lastSyncDate || '');

        await qontoDb.updateLastSyncDate(latestSettledAt);
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
 * Check if a sync is needed (no sync in last hour)
 * @returns {Promise<boolean>}
 */
async function needsSync() {
    const lastSync = await qontoDb.getLastSyncTimestamp();

    if (!lastSync) {
        return true; // Never synced
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const lastSyncDate = new Date(lastSync);

    return lastSyncDate < oneHourAgo;
}

/**
 * Sync if needed (automatic sync with 1-hour cooldown)
 * @returns {Promise<{synced: boolean, result: Object|null}>}
 */
async function autoSync() {
    if (await needsSync()) {
        const result = await syncTransactions();
        return { synced: true, result };
    }

    return { synced: false, result: null };
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
    const lastSyncDate = await getLastSyncDate();
    const lastSyncTimestamp = await qontoDb.getLastSyncTimestamp();
    const oldestTransaction = await qontoDb.getOldestQontoTransaction();
    const newestTransaction = await qontoDb.getNewestQontoTransaction();

    return {
        totalCached: totalCount,
        lastSyncDate,
        lastSyncTimestamp,
        oldestTransaction: oldestTransaction ? oldestTransaction.settled_at : null,
        newestTransaction: newestTransaction ? newestTransaction.settled_at : null
    };
}

module.exports = {
    getLastSyncDate,
    syncTransactions,
    getCachedTransactions,
    getCachedTransaction,
    refreshTransaction,
    needsSync,
    autoSync,
    clearCache,
    getCacheStats
};
