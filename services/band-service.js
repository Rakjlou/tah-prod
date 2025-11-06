const { getBandByUserId, getBandById, getAllCategories } = require('../lib/db');
const { NotFoundError } = require('../lib/errors');

/**
 * Band Service
 * Handles all band-related business logic
 */
class BandService {
    /**
     * Get band by user ID
     * @param {number} userId - User ID
     * @returns {Promise<Object>} Band object
     * @throws {NotFoundError} If band not found
     */
    async getBandByUser(userId) {
        const band = await getBandByUserId(userId);
        if (!band) {
            throw new NotFoundError('Groupe');
        }
        return band;
    }

    /**
     * Get band by ID
     * @param {number} bandId - Band ID
     * @returns {Promise<Object>} Band object
     * @throws {NotFoundError} If band not found
     */
    async getBandById(bandId) {
        const band = await getBandById(bandId);
        if (!band) {
            throw new NotFoundError('Groupe');
        }
        return band;
    }

    /**
     * Get all categories
     * @returns {Promise<Array>} List of categories
     */
    async getCategories() {
        return await getAllCategories();
    }

    /**
     * Verify band ownership of a transaction
     * @param {number} bandId - Band ID
     * @param {Object} transaction - Transaction object
     * @throws {NotFoundError} If transaction doesn't belong to the band
     */
    verifyBandOwnership(bandId, transaction) {
        if (!transaction || transaction.band_id !== bandId) {
            throw new NotFoundError('Transaction');
        }
    }
}

module.exports = new BandService();
