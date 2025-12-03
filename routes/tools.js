const express = require('express');
const router = express.Router();
const { requireRole } = require('../lib/middleware');
const { ROLES } = require('../lib/roles');

/**
 * GET /tools
 * Display tools landing page (accessible by both bands and admins)
 */
router.get('/tools', requireRole(ROLES.BAND, ROLES.ADMIN), async (req, res) => {
    const tools = [
        {
            name: 'Invoices',
            description: 'Create and manage invoices compliant with French standards for associations loi 1901.',
            href: req.session.user.role & ROLES.ADMIN ? '/admin/invoices' : '/invoices',
            icon: 'document'
        }
    ];

    res.render('tools', { tools });
});

module.exports = router;
