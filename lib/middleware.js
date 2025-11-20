const { ROLES, hasRole } = require('./roles');
const googleAuth = require('./google-auth');
const configService = require('./config-service');

/**
 * Middleware to set common locals for all views
 */
async function setLocals(req, res, next) {
    res.locals.user = req.session.user || null;
    res.locals.isGoogleAuthenticated = await googleAuth.isAuthenticated();
    res.locals.ROLES = ROLES;
    res.locals.hasRole = (role) => {
        return req.session.user ? hasRole(req.session.user.role, role) : false;
    };

    // Check if Google is configured
    try {
        const googleOAuthConfig = await configService.getGoogleOAuth();
        res.locals.googleConfigured = !!googleOAuthConfig;
    } catch (error) {
        res.locals.googleConfigured = false;
    }

    next();
}

/**
 * Generic role-based authentication middleware
 * @param {...string} allowedRoles - List of allowed roles
 * @returns {Function} Express middleware function
 *
 * @example
 * // Require any authenticated user
 * router.get('/profile', requireRole(), handler);
 *
 * // Require admin role
 * router.get('/admin', requireRole(ROLES.ADMIN), handler);
 *
 * // Require either admin or band role
 * router.get('/transactions', requireRole(ROLES.ADMIN, ROLES.BAND), handler);
 */
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        // Check if user is logged in
        if (!req.session.user) {
            req.flash.warning('You must be logged in to access this page');
            return res.redirect('/login');
        }

        // If no specific roles required, just check authentication
        if (allowedRoles.length === 0) {
            return next();
        }

        // Check if user has one of the allowed roles
        const userHasRole = allowedRoles.some(role =>
            hasRole(req.session.user.role, role)
        );

        if (!userHasRole) {
            return res.status(403).render('error', {
                statusCode: 403,
                message: 'Access denied'
            });
        }

        next();
    };
}

/**
 * Authentication middleware - requires any logged-in user
 * @deprecated Use requireRole() instead
 */
function requireAuth(req, res, next) {
    return requireRole()(req, res, next);
}

/**
 * Admin-only authentication middleware
 * @deprecated Use requireRole(ROLES.ADMIN) instead
 */
function requireAdmin(req, res, next) {
    return requireRole(ROLES.ADMIN)(req, res, next);
}

/**
 * Band-only authentication middleware
 * @deprecated Use requireRole(ROLES.BAND) instead
 */
function requireBand(req, res, next) {
    return requireRole(ROLES.BAND)(req, res, next);
}

module.exports = {
    setLocals,
    requireRole,
    requireAuth,
    requireAdmin,
    requireBand
};
