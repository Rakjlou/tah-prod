const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../lib/middleware');
const {
    getAllConfig,
    getBandById,
    getAllCategories,
    seedDefaultCategories,
    createCategory,
    deleteCategory,
    createUser,
    createBand
} = require('../lib/db');
const { hashPassword } = require('../lib/auth');
const { ROLES } = require('../lib/roles');
const { createBandStructure } = require('../lib/google-drive');
const googleAuth = require('../lib/google-auth');
const configService = require('../lib/config-service');
const { generateRandomPassword } = require('../lib/helpers');

/**
 * GET /config
 * Display configuration panel
 */
router.get('/config', requireAdmin, async (req, res) => {
    await seedDefaultCategories();

    const config = await getAllConfig();
    const organizationBandId = await configService.getOrganizationBandId();
    let organizationBand = null;

    if (organizationBandId) {
        organizationBand = await getBandById(organizationBandId);
    }

    const categories = await getAllCategories();

    res.render('config', { config, organizationBandId, organizationBand, categories });
});

/**
 * POST /config
 * Update configuration
 */
router.post('/config', requireAdmin, async (req, res) => {
    for (const [key, value] of Object.entries(req.body)) {
        await configService.set(key, value);
    }

    const config = await getAllConfig();
    const organizationBandId = await configService.getOrganizationBandId();
    let organizationBand = null;

    if (organizationBandId) {
        organizationBand = await getBandById(organizationBandId);
    }

    const categories = await getAllCategories();

    res.render('config', { success: 'Configuration saved successfully', config, organizationBandId, organizationBand, categories });
});

/**
 * POST /config/create-organization
 * Create organization band
 */
router.post('/config/create-organization', requireAdmin, async (req, res) => {
    const existingOrgId = await configService.getOrganizationBandId();
    if (existingOrgId) {
        const config = await getAllConfig();
        const organizationBand = await getBandById(existingOrgId);
        const categories = await getAllCategories();
        return res.render('config', {
            error: 'Organization band already exists',
            config,
            organizationBandId: existingOrgId,
            organizationBand,
            categories
        });
    }

    const parentFolderId = await configService.getGoogleDriveFolderId();
    const authenticatedClient = await googleAuth.getAuthenticatedClient();

    const { folderId, accountingSpreadsheetId, invoicesFolderId } = await createBandStructure(
        authenticatedClient,
        'Organization',
        null,
        parentFolderId
    );

    const temporaryPassword = generateRandomPassword();
    const hashedPassword = await hashPassword(temporaryPassword);
    const userId = await createUser('organization@internal', hashedPassword, ROLES.BAND);

    const bandId = await createBand('Organization', 'organization@internal', userId, folderId, accountingSpreadsheetId, invoicesFolderId);

    await configService.setOrganizationBandId(bandId);

    const config = await getAllConfig();
    const organizationBand = await getBandById(bandId);
    const categories = await getAllCategories();

    res.render('config', {
        success: 'Organization band created successfully',
        config,
        organizationBandId: bandId,
        organizationBand,
        categories
    });
});

/**
 * POST /config/categories
 * Create a new category
 */
router.post('/config/categories', requireAdmin, async (req, res) => {
    const { name, type } = req.body;

    if (!name || !type) {
        const config = await getAllConfig();
        const organizationBandId = await configService.getOrganizationBandId();
        const organizationBand = organizationBandId ? await getBandById(organizationBandId) : null;
        const categories = await getAllCategories();

        return res.render('config', {
            error: 'Category name and type are required',
            config,
            organizationBandId,
            organizationBand,
            categories
        });
    }

    // Database operation - catch constraint violations for better UX
    try {
        await createCategory(name, type);

        const config = await getAllConfig();
        const organizationBandId = await configService.getOrganizationBandId();
        const organizationBand = organizationBandId ? await getBandById(organizationBandId) : null;
        const categories = await getAllCategories();

        res.render('config', {
            success: `Category "${name}" created successfully`,
            config,
            organizationBandId,
            organizationBand,
            categories
        });
    } catch (error) {
        // Handle database constraint errors (e.g., invalid type)
        const config = await getAllConfig();
        const organizationBandId = await configService.getOrganizationBandId();
        const organizationBand = organizationBandId ? await getBandById(organizationBandId) : null;
        const categories = await getAllCategories();

        return res.render('config', {
            error: 'Invalid category type. Must be income, expense, or both.',
            config,
            organizationBandId,
            organizationBand,
            categories
        });
    }
});

/**
 * POST /config/categories/:id/delete
 * Delete a category
 */
router.post('/config/categories/:id/delete', requireAdmin, async (req, res) => {
    const categoryId = req.params.id;
    await deleteCategory(categoryId);

    const config = await getAllConfig();
    const organizationBandId = await configService.getOrganizationBandId();
    const organizationBand = organizationBandId ? await getBandById(organizationBandId) : null;
    const categories = await getAllCategories();

    res.render('config', {
        success: 'Category deleted successfully',
        config,
        organizationBandId,
        organizationBand,
        categories
    });
});

module.exports = router;
