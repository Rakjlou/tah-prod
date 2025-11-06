/**
 * Custom error classes for better error handling and user-friendly messages
 */

/**
 * Base application error class
 */
class AppError extends Error {
    constructor(message, statusCode = 500, userMessage = null) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.userMessage = userMessage || message;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Not found error (404)
 */
class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(
            `${resource} not found`,
            404,
            `${resource} not found`
        );
    }
}

/**
 * Validation error (400)
 */
class ValidationError extends AppError {
    constructor(message, userMessage = null) {
        super(
            message,
            400,
            userMessage || 'Invalid data'
        );
    }
}

/**
 * Unauthorized error (401)
 */
class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super(
            message,
            401,
            'Unauthorized'
        );
    }
}

/**
 * Forbidden error (403)
 */
class ForbiddenError extends AppError {
    constructor(message = 'Forbidden') {
        super(
            message,
            403,
            'Access denied'
        );
    }
}

/**
 * Conflict error (409)
 */
class ConflictError extends AppError {
    constructor(message, userMessage = null) {
        super(
            message,
            409,
            userMessage || 'Conflict detected'
        );
    }
}

/**
 * External service error (502)
 */
class ExternalServiceError extends AppError {
    constructor(serviceName, originalError = null) {
        super(
            `External service error: ${serviceName}`,
            502,
            `External service error: ${serviceName}`
        );
        this.serviceName = serviceName;
        this.originalError = originalError;
    }
}

module.exports = {
    AppError,
    NotFoundError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    ConflictError,
    ExternalServiceError
};
