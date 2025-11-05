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
 * Authentication middleware - requires any logged-in user
 */
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
}

/**
 * Admin-only authentication middleware
 */
function requireAdmin(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    if (!hasRole(req.session.user.role, ROLES.ADMIN)) {
        return res.status(403).send('Access denied');
    }
    next();
}

/**
 * Band-only authentication middleware
 */
function requireBand(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    if (!hasRole(req.session.user.role, ROLES.BAND)) {
        return res.status(403).send('Access denied');
    }
    next();
}

module.exports = {
    setLocals,
    requireAuth,
    requireAdmin,
    requireBand
};
