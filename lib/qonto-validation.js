const qontoDb = require('./qonto-db');
const { getTransactionById } = require('./db');

/**
 * Convert Qonto amount to signed amount based on side field
 * Qonto API returns all amounts as positive, with side indicating direction
 * @param {number} amount - Unsigned Qonto amount
 * @param {string} side - 'debit' (expense) or 'credit' (income)
 * @returns {number} Signed amount (negative for debit/expense, positive for credit/income)
 */
function qontoAmountToSigned(amount, side) {
    return side === 'debit' ? -Math.abs(amount) : Math.abs(amount);
}

/**
 * Compute the sum of all linked Qonto amounts for a website transaction
 * @param {number} transactionId - Website transaction ID
 * @returns {Promise<{total: number, count: number, links: Array}>}
 */
async function computeLinkedAmounts(transactionId) {
    const links = await qontoDb.getLinkedTransactions(transactionId);

    const total = links.reduce((sum, link) => sum + (link.allocated_amount || link.qonto_amount || 0), 0);

    return {
        total,
        count: links.length,
        links
    };
}

/**
 * Compute how much of a Qonto transaction is already allocated
 * @param {string} qontoId - Qonto transaction UUID
 * @returns {Promise<{allocated: number, available: number, qontoAmount: number, links: Array}>}
 */
async function computeQontoAllocation(qontoId) {
    const allocation = await qontoDb.getQontoAllocationByQontoId(qontoId);

    return allocation;
}

/**
 * Validate that linked Qonto amounts match the website transaction amount
 * Direction rule:
 * - If website transaction type='expense', sum of Qonto amounts should equal -amount (all negative)
 * - If website transaction type='income', sum of Qonto amounts should equal +amount (all positive)
 *
 * @param {number} websiteAmount - Website transaction amount (always positive)
 * @param {string} type - 'income' or 'expense'
 * @param {Array} qontoAmounts - Array of Qonto amounts (signed: negative for expense, positive for income)
 * @param {number} tolerance - Allowed difference (default 0.00 for exact match)
 * @returns {{isValid: boolean, difference: number, expectedTotal: number, actualTotal: number}}
 */
function validateAmountMatch(websiteAmount, type, qontoAmounts, tolerance = 0.00) {
    const actualTotal = qontoAmounts.reduce((sum, amt) => sum + amt, 0);
    const expectedTotal = type === 'expense' ? -websiteAmount : websiteAmount;
    const difference = Math.abs(actualTotal - expectedTotal);

    return {
        isValid: difference <= tolerance,
        difference,
        expectedTotal,
        actualTotal
    };
}

/**
 * Validate that the direction (income/expense) matches between website and Qonto
 * @param {string} websiteType - 'income' or 'expense'
 * @param {number} qontoAmount - Signed Qonto amount
 * @returns {{isValid: boolean, message: string}}
 */
function validateDirection(websiteType, qontoAmount) {
    const isExpense = websiteType === 'expense';
    const qontoIsNegative = qontoAmount < 0;

    if (isExpense && !qontoIsNegative) {
        return {
            isValid: false,
            message: 'Website transaction is an EXPENSE but Qonto amount is POSITIVE (income)'
        };
    }

    if (!isExpense && qontoIsNegative) {
        return {
            isValid: false,
            message: 'Website transaction is an INCOME but Qonto amount is NEGATIVE (expense)'
        };
    }

    return {
        isValid: true,
        message: 'Direction matches'
    };
}

/**
 * Check if a Qonto transaction can be linked (has enough unallocated amount)
 * @param {string} qontoId - Qonto transaction UUID
 * @param {number} qontoAmount - The Qonto transaction's total amount
 * @param {number} additionalAllocation - Amount to be allocated by the new link
 * @returns {Promise<{canLink: boolean, available: number, allocated: number, message: string}>}
 */
async function canLinkQonto(qontoId, qontoAmount, additionalAllocation) {
    const allocation = await computeQontoAllocation(qontoId);
    const qontoAbsAmount = Math.abs(qontoAmount);
    const available = qontoAbsAmount - allocation.allocated;
    const additionalAbs = Math.abs(additionalAllocation);

    if (available < additionalAbs) {
        return {
            canLink: false,
            available,
            allocated: allocation.allocated,
            message: `Qonto transaction only has ${available.toFixed(2)} € available, but trying to allocate ${additionalAbs.toFixed(2)} €`
        };
    }

    return {
        canLink: true,
        available,
        allocated: allocation.allocated,
        message: 'Sufficient funds available'
    };
}

/**
 * Validate a set of Qonto transactions before linking to a website transaction
 * @param {number} transactionId - Website transaction ID
 * @param {Array} qontoTransactions - Array of {qonto_id, qonto_amount, allocated_amount} objects to link
 * @returns {Promise<{isValid: boolean, errors: Array, warnings: Array, summary: Object}>}
 */
async function validateLinking(transactionId, qontoTransactions) {
    const errors = [];
    const warnings = [];

    // Get website transaction
    const transaction = await getTransactionById(transactionId);
    if (!transaction) {
        errors.push('Website transaction not found');
        return { isValid: false, errors, warnings, summary: {} };
    }

    // Get existing links
    const existingLinks = await computeLinkedAmounts(transactionId);

    // Compute what the new total would be using allocated amounts
    const newAllocatedAmounts = qontoTransactions.map(qt => qt.allocated_amount);
    const newTotal = newAllocatedAmounts.reduce((sum, amt) => sum + amt, 0);
    const combinedTotal = existingLinks.total + newTotal;

    // Validate direction for each new Qonto transaction
    for (const qt of qontoTransactions) {
        const directionCheck = validateDirection(transaction.type, qt.allocated_amount);
        if (!directionCheck.isValid) {
            errors.push(`Qonto ${qt.qonto_id}: ${directionCheck.message}`);
        }
    }

    // Validate that allocated amounts are positive (not zero or negative)
    for (const qt of qontoTransactions) {
        const allocatedAmount = Math.abs(qt.allocated_amount);
        if (allocatedAmount <= 0) {
            errors.push(`Qonto ${qt.qonto_id}: Allocated amount must be greater than zero (got ${allocatedAmount.toFixed(2)} €)`);
        }
    }

    // Validate that each Qonto transaction has enough available amount
    for (const qt of qontoTransactions) {
        const allocatedAmount = Math.abs(qt.allocated_amount);
        const canLink = await canLinkQonto(qt.qonto_id, qt.qonto_amount, allocatedAmount);

        if (!canLink.canLink) {
            errors.push(`Qonto ${qt.qonto_id}: ${canLink.message}`);
        }
    }

    // Validate combined amount matching using allocated amounts
    const allAllocatedAmounts = [...existingLinks.links.map(l => l.allocated_amount || l.qonto_amount), ...newAllocatedAmounts];
    const amountCheck = validateAmountMatch(transaction.amount, transaction.type, allAllocatedAmounts);

    if (!amountCheck.isValid) {
        errors.push(
            `Amount mismatch: Expected ${amountCheck.expectedTotal.toFixed(2)} €, ` +
            `but sum of allocated amounts is ${amountCheck.actualTotal.toFixed(2)} € ` +
            `(difference: ${amountCheck.difference.toFixed(2)} €)`
        );
    }

    const summary = {
        websiteAmount: transaction.amount,
        websiteType: transaction.type,
        existingQontoTotal: existingLinks.total,
        newQontoTotal: newTotal,
        combinedQontoTotal: combinedTotal,
        expectedQontoTotal: transaction.type === 'expense' ? -transaction.amount : transaction.amount,
        difference: amountCheck.difference,
        isAmountMatch: amountCheck.isValid
    };

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        summary
    };
}

/**
 * Get all transactions with amount/direction discrepancies
 * @returns {Promise<Array>} Array of transactions with validation issues
 */
async function getDiscrepancies() {
    const { getAllTransactionsWithBands } = require('./db');
    const allTransactions = await getAllTransactionsWithBands();

    const discrepancies = [];

    for (const tx of allTransactions) {
        const linkedAmounts = await computeLinkedAmounts(tx.id);

        // Skip if no links
        if (linkedAmounts.count === 0) {
            continue;
        }

        // Check amount match using allocated amounts
        const allocatedAmounts = linkedAmounts.links.map(l => l.allocated_amount || l.qonto_amount);
        const amountCheck = validateAmountMatch(tx.amount, tx.type, allocatedAmounts);

        // Check direction for each link
        const directionIssues = [];
        for (const link of linkedAmounts.links) {
            const amountToCheck = link.allocated_amount || link.qonto_amount;
            const dirCheck = validateDirection(tx.type, amountToCheck);
            if (!dirCheck.isValid) {
                directionIssues.push({
                    qontoId: link.qonto_id,
                    message: dirCheck.message
                });
            }
        }

        // If there are any issues, add to discrepancies
        if (!amountCheck.isValid || directionIssues.length > 0) {
            discrepancies.push({
                transaction: tx,
                linkedAmounts: linkedAmounts.total,
                expectedAmount: tx.type === 'expense' ? -tx.amount : tx.amount,
                difference: amountCheck.difference,
                isAmountMatch: amountCheck.isValid,
                directionIssues,
                linkCount: linkedAmounts.count
            });
        }
    }

    return discrepancies;
}

/**
 * Get validation status for a single transaction
 * @param {number} transactionId
 * @returns {Promise<{hasLinks: boolean, isValid: boolean, amountMatch: Object, directionIssues: Array}>}
 */
async function getTransactionValidationStatus(transactionId) {
    const transaction = await getTransactionById(transactionId);
    if (!transaction) {
        return null;
    }

    const linkedAmounts = await computeLinkedAmounts(transactionId);

    if (linkedAmounts.count === 0) {
        return {
            hasLinks: false,
            isValid: true,
            amountMatch: null,
            directionIssues: []
        };
    }

    const allocatedAmounts = linkedAmounts.links.map(l => l.allocated_amount || l.qonto_amount);
    const amountCheck = validateAmountMatch(transaction.amount, transaction.type, allocatedAmounts);

    const directionIssues = [];
    for (const link of linkedAmounts.links) {
        const amountToCheck = link.allocated_amount || link.qonto_amount;
        const dirCheck = validateDirection(transaction.type, amountToCheck);
        if (!dirCheck.isValid) {
            directionIssues.push({
                qontoId: link.qonto_id,
                message: dirCheck.message
            });
        }
    }

    return {
        hasLinks: true,
        isValid: amountCheck.isValid && directionIssues.length === 0,
        amountMatch: {
            expected: amountCheck.expectedTotal,
            actual: amountCheck.actualTotal,
            difference: amountCheck.difference,
            isValid: amountCheck.isValid
        },
        directionIssues,
        linkCount: linkedAmounts.count
    };
}

module.exports = {
    qontoAmountToSigned,
    computeLinkedAmounts,
    computeQontoAllocation,
    validateAmountMatch,
    validateDirection,
    canLinkQonto,
    validateLinking,
    getDiscrepancies,
    getTransactionValidationStatus
};
