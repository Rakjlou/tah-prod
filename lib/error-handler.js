const { AppError } = require('./errors');

/**
 * Flash message middleware
 * Stores messages in session and makes them available to views
 */
function flashMiddleware(req, res, next) {
    // Get flash messages from session
    res.locals.successMessage = req.session.successMessage;
    res.locals.errorMessage = req.session.errorMessage;
    res.locals.warningMessage = req.session.warningMessage;

    // Clear messages from session after reading
    delete req.session.successMessage;
    delete req.session.errorMessage;
    delete req.session.warningMessage;

    // Add helper functions to set flash messages
    req.flash = {
        success: (message) => {
            req.session.successMessage = message;
        },
        error: (message) => {
            req.session.errorMessage = message;
        },
        warning: (message) => {
            req.session.warningMessage = message;
        }
    };

    next();
}

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res, next) {
    res.status(404).render('error', {
        statusCode: 404,
        message: 'Page not found'
    });
}

/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
    // Log error for debugging
    console.error('Error:', err);

    // Default to 500 Internal Server Error
    let statusCode = 500;
    let userMessage = 'An error occurred';

    // If it's an operational error (AppError), use its properties
    if (err.isOperational) {
        statusCode = err.statusCode;
        userMessage = err.userMessage;
    }

    // For AJAX requests, return JSON
    if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.status(statusCode).json({
            success: false,
            error: userMessage
        });
    }

    // For regular requests with redirectUrl, use flash message and redirect
    if (err.redirectUrl) {
        req.flash.error(userMessage);
        return res.redirect(err.redirectUrl);
    }

    // For regular requests, render error page
    res.status(statusCode).render('error', {
        statusCode,
        message: userMessage
    });
}

module.exports = {
    flashMiddleware,
    notFoundHandler,
    errorHandler
};
