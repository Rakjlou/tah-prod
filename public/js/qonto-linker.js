// Qonto Linker - JavaScript for linking website transactions to Qonto bank transactions

let currentMatches = [];

async function searchQontoMatches() {
    const searchBtn = document.getElementById('search-qonto-btn');
    const loadingDiv = document.getElementById('qonto-loading');
    const errorDiv = document.getElementById('qonto-error');
    const matchesDiv = document.getElementById('qonto-matches');

    // Reset UI
    searchBtn.disabled = true;
    loadingDiv.classList.remove('hidden');
    errorDiv.classList.add('hidden');
    matchesDiv.classList.add('hidden');

    try {
        // Get transaction ID from URL
        const transactionId = getTransactionIdFromUrl();
        const response = await fetch(`/admin/transactions/${transactionId}/search-qonto`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to search Qonto transactions');
        }

        currentMatches = data.matches || [];

        if (currentMatches.length === 0) {
            errorDiv.textContent = 'No completed Qonto transactions found in your account.';
            errorDiv.classList.remove('hidden');
        } else {
            displayMatches(currentMatches);
            matchesDiv.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error searching Qonto:', error);
        errorDiv.textContent = error.message || 'Failed to search Qonto transactions';
        errorDiv.classList.remove('hidden');
    } finally {
        loadingDiv.classList.add('hidden');
        searchBtn.disabled = false;
    }
}

function displayMatches(matches) {
    const contentDiv = document.getElementById('qonto-matches-content');
    const tableTemplate = document.getElementById('qonto-table-template');
    const rowTemplate = document.getElementById('qonto-row-template');

    // Clone the table template
    const tableClone = tableTemplate.content.cloneNode(true);
    const tbody = tableClone.getElementById('qonto-table-body');

    matches.forEach(match => {
        const isLinked = match.isLinked;
        const linkedNote = isLinked ? ` (linked to #${match.linkedTo.join(', #')})` : '';
        const isFullyAllocated = match.isFullyAllocated || false;
        const available = match.availableAmount !== undefined ? match.availableAmount.toFixed(2) : 'N/A';
        const directionMatches = match.directionMatches !== undefined ? match.directionMatches : true;

        // Disable checkbox if fully allocated or direction doesn't match
        const disableCheckbox = isFullyAllocated || !directionMatches;

        // Clone the row template
        const rowClone = rowTemplate.content.cloneNode(true);
        const row = rowClone.querySelector('tr');

        // Apply row class if disabled
        if (disableCheckbox) {
            row.classList.add('qonto-row-disabled');
        }

        // Fill in the row data
        const checkbox = rowClone.querySelector('.qonto-checkbox');
        checkbox.dataset.qontoId = match.id;
        if (disableCheckbox) {
            checkbox.disabled = true;
        }

        rowClone.querySelector('.qonto-date').textContent = match.settled_at ? new Date(match.settled_at).toLocaleDateString() : '-';
        rowClone.querySelector('.qonto-amount').textContent = `${match.amount} ${match.currency || 'EUR'}`;

        const availableCell = rowClone.querySelector('.qonto-available');
        if (isFullyAllocated) {
            availableCell.classList.add('fully-allocated');
        }
        availableCell.textContent = `${available} €${isFullyAllocated ? ' (Full)' : ''}`;

        const directionCell = rowClone.querySelector('.qonto-direction');
        const directionIcon = document.createElement('span');
        directionIcon.className = directionMatches ? 'direction-match' : 'direction-mismatch';
        directionIcon.textContent = directionMatches ? '✓' : '✗';
        directionCell.appendChild(directionIcon);

        rowClone.querySelector('.qonto-label').textContent = (match.label || '-') + linkedNote;
        rowClone.querySelector('.qonto-reference').textContent = match.reference || '-';
        rowClone.querySelector('.qonto-status').textContent = match.status || 'completed';

        tbody.appendChild(rowClone);
    });

    // Clear and append the new table
    contentDiv.innerHTML = '';
    contentDiv.appendChild(tableClone);
}

function toggleSelectAll() {
    const selectAll = document.getElementById('select-all-qonto');
    const checkboxes = document.querySelectorAll('.qonto-checkbox');

    checkboxes.forEach(cb => {
        cb.checked = selectAll.checked;
    });
}

async function linkSelected() {
    const checkboxes = document.querySelectorAll('.qonto-checkbox:checked:not([disabled])');

    if (checkboxes.length === 0) {
        alert('Please select at least one Qonto transaction to link');
        return;
    }

    const selectedIds = Array.from(checkboxes).map(cb => cb.dataset.qontoId);
    const selectedTransactions = currentMatches.filter(m => selectedIds.includes(m.id));

    const linkBtn = document.getElementById('link-selected-btn');
    linkBtn.disabled = true;
    linkBtn.textContent = 'Validating...';

    try {
        const transactionId = getTransactionIdFromUrl();
        const response = await fetch(`/admin/transactions/${transactionId}/link-qonto`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                qontoTransactions: selectedTransactions
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            // Validation failed - show detailed error messages
            if (data.errors && data.errors.length > 0) {
                let errorMsg = 'Validation Failed:\n\n';
                errorMsg += data.errors.join('\n');
                if (data.summary) {
                    errorMsg += '\n\nSummary:\n';
                    errorMsg += `Website Amount: ${data.summary.websiteAmount} € (${data.summary.websiteType})\n`;
                    errorMsg += `Expected Qonto Total: ${data.summary.expectedQontoTotal.toFixed(2)} €\n`;
                    errorMsg += `Actual Qonto Total: ${data.summary.combinedQontoTotal.toFixed(2)} €\n`;
                    errorMsg += `Difference: ${data.summary.difference.toFixed(2)} €\n`;
                }
                alert(errorMsg);
            } else {
                throw new Error(data.error || 'Failed to link Qonto transactions');
            }
            linkBtn.disabled = false;
            linkBtn.textContent = 'Link Selected';
            return;
        }

        // Show success results
        let successMsg = '';
        if (data.linked && data.linked.length > 0) {
            successMsg = `Successfully linked ${data.linked.length} Qonto transaction(s)!\n\n`;
        }

        if (data.validation) {
            successMsg += 'Validation Summary:\n';
            successMsg += `Website Amount: ${data.validation.websiteAmount} € (${data.validation.websiteType})\n`;
            successMsg += `Qonto Total: ${data.validation.combinedQontoTotal.toFixed(2)} €\n`;
            successMsg += `Difference: ${data.validation.difference.toFixed(2)} €\n`;
            successMsg += data.validation.isAmountMatch ? '✓ Amounts match!' : '⚠ Amounts do not match';
        }

        if (data.errors && data.errors.length > 0) {
            const errorMessages = data.errors.map(e => e.message).join('\n');
            successMsg += `\n\nSome transactions could not be linked:\n${errorMessages}`;
        }

        alert(successMsg);

        // Reload page to show updated links
        window.location.reload();
    } catch (error) {
        console.error('Error linking Qonto transactions:', error);
        alert(error.message || 'Failed to link Qonto transactions');
        linkBtn.disabled = false;
        linkBtn.textContent = 'Link Selected';
    }
}

async function unlinkQonto(linkId) {
    if (!confirm('Are you sure you want to unlink this Qonto transaction?')) {
        return;
    }

    try {
        const response = await fetch(`/admin/qonto-links/${linkId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to unlink Qonto transaction');
        }

        alert('Qonto transaction unlinked successfully');
        window.location.reload();
    } catch (error) {
        console.error('Error unlinking Qonto transaction:', error);
        alert(error.message || 'Failed to unlink Qonto transaction');
    }
}

// Helper function to get transaction ID from URL
function getTransactionIdFromUrl() {
    const pathParts = window.location.pathname.split('/');
    const transactionsIndex = pathParts.indexOf('transactions');
    if (transactionsIndex !== -1 && pathParts.length > transactionsIndex + 1) {
        return pathParts[transactionsIndex + 1];
    }
    return null;
}
