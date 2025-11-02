const https = require('https');
const configService = require('./config-service');

const QONTO_API_BASE_URL = 'thirdparty.qonto.com';

/**
 * Get Qonto API credentials from config or environment variables
 * @returns {Promise<{login: string, secret: string}>}
 */
async function getCredentials() {
    // Try config first
    const loginFromConfig = await configService.get('qonto_api_login');
    const secretFromConfig = await configService.get('qonto_api_secret');

    const login = loginFromConfig || process.env.QONTO_API_LOGIN;
    const secret = secretFromConfig || process.env.QONTO_API_SECRET;

    if (!login || !secret) {
        throw new Error('Qonto API credentials not configured');
    }

    return { login, secret };
}

/**
 * Make an authenticated request to the Qonto API
 * @param {string} path - API endpoint path
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {object} params - Query parameters
 * @returns {Promise<object>} - API response data
 */
async function apiRequest(path, method = 'GET', params = null) {
    const credentials = await getCredentials();
    const authHeader = `${credentials.login}:${credentials.secret}`;

    return new Promise((resolve, reject) => {
        let fullPath = path;
        if (params && method === 'GET') {
            const queryString = Object.entries(params)
                .map(([key, value]) => {
                    if (Array.isArray(value)) {
                        return value.map(v => `${key}[]=${encodeURIComponent(v)}`).join('&');
                    }
                    return `${key}=${encodeURIComponent(value)}`;
                })
                .join('&');
            fullPath = `${path}?${queryString}`;
        }

        const options = {
            hostname: QONTO_API_BASE_URL,
            path: fullPath,
            method: method,
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (err) {
                        reject(new Error('Failed to parse API response'));
                    }
                } else {
                    reject(new Error(`Qonto API error: ${res.statusCode} - ${data}`));
                }
            });
        });

        req.on('error', (err) => {
            reject(new Error(`Qonto API request failed: ${err.message}`));
        });

        req.end();
    });
}

/**
 * Test the Qonto API connection
 * @returns {Promise<{success: boolean, message: string, organization?: object}>}
 */
async function testConnection() {
    try {
        const data = await apiRequest('/v2/organization');
        return {
            success: true,
            message: `Connected to ${data.organization?.legal_name || 'Qonto'}`,
            organization: data.organization
        };
    } catch (err) {
        return {
            success: false,
            message: err.message
        };
    }
}

/**
 * Get organization and bank account information
 * @returns {Promise<{organization: object, bank_accounts: array}>}
 */
async function getOrganization() {
    const data = await apiRequest('/v2/organization');
    // Bank accounts are nested inside organization object, not at top level
    return {
        organization: data.organization,
        bank_accounts: data.organization?.bank_accounts || []
    };
}

/**
 * Fetch transactions from Qonto API with filters
 * Supports incremental sync via date filtering
 * @param {object} filters - Query parameters for filtering
 * @param {string} filters.settled_at_from - Fetch transactions from this date onwards (ISO 8601)
 * @param {string} filters.settled_at_to - Fetch transactions up to this date (ISO 8601)
 * @param {string} filters.status - Filter by status ('completed', 'pending', etc.)
 * @param {string} filters.bank_account_id - Filter by bank account ID
 * @returns {Promise<array>} - Array of transaction objects
 */
async function fetchTransactions(filters = {}) {
    const data = await apiRequest('/v2/transactions', 'GET', filters);
    return data.transactions || [];
}

/**
 * Search for Qonto transactions - returns ALL completed transactions
 * @returns {Promise<array>} - Array of all Qonto transactions
 */
async function searchMatchingTransactions() {
    try {
        // Get organization to find bank account
        const { bank_accounts } = await getOrganization();
        if (!bank_accounts || bank_accounts.length === 0) {
            throw new Error('No bank accounts found');
        }

        // Use first bank account
        const bankAccountId = bank_accounts[0].id;

        // Fetch ALL completed transactions - no filtering
        const filters = {
            bank_account_id: bankAccountId,
            status: ['completed']
        };

        console.log('[Qonto] Fetching all completed transactions for bank account:', bankAccountId);

        const qontoTransactions = await fetchTransactions(filters);
        console.log(`[Qonto] Fetched ${qontoTransactions.length} transactions from Qonto`);

        if (qontoTransactions.length > 0) {
            console.log('[Qonto] Sample transaction:', JSON.stringify(qontoTransactions[0], null, 2));
        }

        // Return all transactions sorted by date (most recent first)
        return qontoTransactions.sort((a, b) => {
            const dateA = new Date(a.settled_at || a.emitted_at);
            const dateB = new Date(b.settled_at || b.emitted_at);
            return dateB - dateA;
        });
    } catch (err) {
        console.error('[Qonto] Search error:', err);
        throw new Error(`Failed to search Qonto transactions: ${err.message}`);
    }
}

module.exports = {
    testConnection,
    getOrganization,
    fetchTransactions,
    searchMatchingTransactions
};
