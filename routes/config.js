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

    req.flash.success('Configuration saved successfully');
    res.redirect('/config');
});

/**
 * POST /config/create-organization
 * Create organization band
 */
router.post('/config/create-organization', requireAdmin, async (req, res) => {
    const existingOrgId = await configService.getOrganizationBandId();
    if (existingOrgId) {
        req.flash.error('Organization band already exists');
        return res.redirect('/config');
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

    req.flash.success('Organization band created successfully');
    res.redirect('/config');
});

/**
 * POST /config/categories
 * Create a new category
 */
router.post('/config/categories', requireAdmin, async (req, res) => {
    const { name, type } = req.body;

    if (!name || !type) {
        req.flash.error('Category name and type are required');
        return res.redirect('/config');
    }

    // Database operation - catch constraint violations for better UX
    try {
        await createCategory(name, type);

        req.flash.success(`Category "${name}" created successfully`);
        res.redirect('/config');
    } catch (error) {
        // Handle database constraint errors (e.g., invalid type)
        req.flash.error('Invalid category type. Must be income, expense, or both.');
        res.redirect('/config');
    }
});

/**
 * POST /config/categories/:id/delete
 * Delete a category
 */
router.post('/config/categories/:id/delete', requireAdmin, async (req, res) => {
    const categoryId = req.params.id;
    await deleteCategory(categoryId);

    req.flash.success('Category deleted successfully');
    res.redirect('/config');
});

/**
 * GET /config/invoices
 * Display invoice configuration panel
 */
router.get('/config/invoices', requireAdmin, async (req, res) => {
    const config = await getAllConfig();
    res.render('config-invoices', { config });
});

/**
 * POST /config/invoices
 * Update invoice configuration
 */
router.post('/config/invoices', requireAdmin, async (req, res) => {
    const invoiceConfigKeys = [
        'invoice_prefix',
        'association_name',
        'association_address',
        'association_siret',
        'tva_mention',
        'payment_delay_days',
        'late_penalty_rate',
        'iban',
        'bic',
        'bank_name',
        'custom_footer'
    ];

    for (const key of invoiceConfigKeys) {
        if (req.body[key] !== undefined) {
            await configService.set(key, req.body[key]);
        }
    }

    req.flash.success('Invoice configuration saved successfully');
    res.redirect('/config/invoices');
});

module.exports = router;
