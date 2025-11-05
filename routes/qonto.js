const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../lib/middleware');
const { getTransactionById, getBandById } = require('../lib/db');
const qontoApi = require('../lib/qonto-api');
const qontoDb = require('../lib/qonto-db');
const qontoCache = require('../lib/qonto-cache');
const qontoValidation = require('../lib/qonto-validation');
const { syncTransactionsToSheet } = require('../lib/google-sheets');
const configService = require('../lib/config-service');

/**
 * POST /admin/test-qonto
 * Test Qonto API connection with provided credentials
 */
router.post('/admin/test-qonto', requireAdmin, async (req, res) => {
    try {
        const { login, secret } = req.body;

        if (!login || !secret) {
            return res.json({
                success: false,
                message: 'Missing login or secret key'
            });
        }

        // Temporarily set credentials in config for testing
        const originalLogin = await configService.get('qonto_api_login');
        const originalSecret = await configService.get('qonto_api_secret');

        await configService.set('qonto_api_login', login);
        await configService.set('qonto_api_secret', secret);

        try {
            // Use qonto-api.js testConnection function
            const result = await qontoApi.testConnection();

            // If test fails, restore original credentials
            if (!result.success) {
                if (originalLogin) await configService.set('qonto_api_login', originalLogin);
                if (originalSecret) await configService.set('qonto_api_secret', originalSecret);
            }

            res.json({
                success: result.success,
                message: result.message
            });
        } catch (error) {
            // Restore original credentials on error
            if (originalLogin) await configService.set('qonto_api_login', originalLogin);
            if (originalSecret) await configService.set('qonto_api_secret', originalSecret);

            throw error;
        }
    } catch (error) {
        console.error('Qonto connection test failed:', error);
        res.json({
            success: false,
            message: error.message || 'Connection failed'
        });
    }
});

/**
 * POST /admin/transactions/:id/search-qonto
 * Search for matching Qonto transactions
 */
router.post('/admin/transactions/:id/search-qonto', requireAdmin, async (req, res) => {
    try {
        const transaction = await getTransactionById(req.params.id);
        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        // Trigger auto-sync (only syncs if >1 hour since last sync)
        const syncResult = await qontoCache.autoSync();
        console.log('[Qonto Search] Auto-sync:', syncResult.synced ? `Synced ${syncResult.result.synced} new transactions` : 'Using cache (recently synced)');

        // Get all cached transactions
        const matches = await qontoCache.getCachedTransactions({ status: 'completed' });

        // Check which ones are already linked
        const qontoIds = matches.map(m => m.qonto_id);
        const linkStatus = await qontoDb.checkMultipleLinks(qontoIds);

        // Compute allocation for each Qonto transaction
        const enrichedMatches = await Promise.all(matches.map(async (match) => {
            const allocation = await qontoValidation.computeQontoAllocation(match.qonto_id);
            const signedAmount = qontoValidation.qontoAmountToSigned(match.amount, match.side);
            const directionCheck = qontoValidation.validateDirection(transaction.type, signedAmount);

            return {
                id: match.qonto_id,
                transaction_id: match.qonto_transaction_id,
                amount: match.amount,
                side: match.side,
                currency: match.currency,
                settled_at: match.settled_at,
                label: match.label,
                reference: match.reference,
                note: match.note,
                qonto_web_url: match.qonto_web_url,
                status: match.status,
                // Link status
                isLinked: linkStatus[match.qonto_id].isLinked,
                linkedTo: linkStatus[match.qonto_id].linkedTo,
                // Allocation info
                totalAllocated: allocation.allocated,
                availableAmount: allocation.available,
                isFullyAllocated: allocation.available <= 0,
                // Direction compatibility
                directionMatches: directionCheck.isValid,
                directionMessage: directionCheck.message
            };
        }));

        // Sort by settled_at (most recent first)
        enrichedMatches.sort((a, b) => {
            const dateA = new Date(a.settled_at);
            const dateB = new Date(b.settled_at);
            return dateB - dateA;
        });

        res.json({
            success: true,
            matches: enrichedMatches,
            syncInfo: syncResult.synced ? {
                synced: syncResult.result.synced,
                total: syncResult.result.total
            } : null
        });
    } catch (error) {
        console.error('Error searching Qonto transactions:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to search Qonto transactions'
        });
    }
});

/**
 * POST /admin/transactions/:id/link-qonto
 * Link selected Qonto transaction(s)
 */
router.post('/admin/transactions/:id/link-qonto', requireAdmin, async (req, res) => {
    try {
        const transaction = await getTransactionById(req.params.id);
        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const { qontoTransactions } = req.body; // Array of Qonto transaction objects

        if (!Array.isArray(qontoTransactions) || qontoTransactions.length === 0) {
            return res.status(400).json({ error: 'No Qonto transactions provided' });
        }

        // Get existing links to calculate remaining needed amount
        const existingLinks = await qontoValidation.computeLinkedAmounts(transaction.id);
        const expectedTotal = transaction.type === 'expense' ? -transaction.amount : transaction.amount;
        const remainingNeeded = Math.abs(expectedTotal - existingLinks.total);

        // Prepare data for validation with smart allocation
        let amountLeftToAllocate = remainingNeeded;
        const qontoDataForValidation = qontoTransactions.map(qt => {
            const fullSignedAmount = qontoValidation.qontoAmountToSigned(qt.amount, qt.side);

            // Check if direction matches before auto-allocating
            const directionMatches = (transaction.type === 'expense' && qt.side === 'debit') ||
                                    (transaction.type === 'income' && qt.side === 'credit');

            // If allocated_amount is explicitly provided, use it
            // Otherwise, intelligently allocate only what's needed (and only if direction matches)
            let allocatedAmount;
            if (qt.allocated_amount !== undefined) {
                allocatedAmount = qt.allocated_amount;
            } else if (directionMatches) {
                // Auto-allocate: use the minimum of (what's needed, what's available in this Qonto tx)
                allocatedAmount = Math.min(amountLeftToAllocate, Math.abs(fullSignedAmount));
                amountLeftToAllocate -= allocatedAmount;
            } else {
                // Direction doesn't match, allocate 0 (will fail validation with clear message)
                allocatedAmount = 0;
            }

            const signedAllocatedAmount = qt.side === 'debit' ? -Math.abs(allocatedAmount) : Math.abs(allocatedAmount);

            return {
                qonto_id: qt.id,
                qonto_amount: fullSignedAmount,
                allocated_amount: signedAllocatedAmount
            };
        });

        // Validate the linking BEFORE creating any links
        const validation = await qontoValidation.validateLinking(transaction.id, qontoDataForValidation);

        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                errors: validation.errors,
                warnings: validation.warnings,
                summary: validation.summary
            });
        }

        // All validations passed, create the links
        const linked = [];
        const errors = [];

        for (let i = 0; i < qontoTransactions.length; i++) {
            const qontoTx = qontoTransactions[i];
            const validationData = qontoDataForValidation[i];

            try {
                // Merge original transaction data with calculated allocated_amount (keep it signed)
                const qontoTxWithAllocation = {
                    ...qontoTx,
                    allocated_amount: validationData.allocated_amount
                };

                const link = await qontoDb.createLink(
                    transaction.id,
                    qontoTxWithAllocation,
                    req.session.user.id
                );
                linked.push(link);
            } catch (error) {
                errors.push({
                    qonto_id: qontoTx.id,
                    message: error.message
                });
            }
        }

        // If we successfully linked transactions, sync to Google Sheets
        if (linked.length > 0) {
            try {
                const band = await getBandById(transaction.band_id);
                if (band && band.accounting_spreadsheet_id) {
                    await syncTransactionsToSheet(band.id, band.accounting_spreadsheet_id);
                    console.log('[Qonto Link] Synced to Google Sheets for band:', band.name);
                }
            } catch (syncError) {
                console.error('[Qonto Link] Failed to sync to Google Sheets:', syncError);
                // Don't fail the whole operation if sheets sync fails
            }
        }

        res.json({
            success: true,
            linked,
            errors,
            validation: validation.summary
        });
    } catch (error) {
        console.error('Error linking Qonto transactions:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to link Qonto transactions'
        });
    }
});

/**
 * DELETE /admin/qonto-links/:linkId
 * Unlink a Qonto transaction
 */
router.delete('/admin/qonto-links/:linkId', requireAdmin, async (req, res) => {
    try {
        const deleted = await qontoDb.deleteLink(req.params.linkId);

        if (!deleted) {
            return res.status(404).json({ error: 'Link not found' });
        }

        res.json({
            success: true,
            message: 'Qonto transaction unlinked successfully'
        });
    } catch (error) {
        console.error('Error unlinking Qonto transaction:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to unlink Qonto transaction'
        });
    }
});

module.exports = router;
