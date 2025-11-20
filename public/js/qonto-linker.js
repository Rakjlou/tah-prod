// Qonto Linker - JavaScript for linking website transactions to Qonto bank transactions

let currentMatches = [];

async function searchQontoMatches() {
    const searchBtn = document.getElementById('search-qonto-btn');
    const loadingDiv = document.getElementById('qonto-loading');
    const errorDiv = document.getElementById('qonto-error');
    const matchesDiv = document.getElementById('qonto-matches');

    searchBtn.disabled = true;
    loadingDiv.classList.remove('hidden');
    errorDiv.classList.add('hidden');
    matchesDiv.classList.add('hidden');

    try {
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

    const tableClone = tableTemplate.content.cloneNode(true);
    const tbody = tableClone.getElementById('qonto-table-body');

    matches.forEach(match => {
        const isLinked = match.isLinked;
        const isFullyAllocated = match.isFullyAllocated || false;
        const available = match.availableAmount !== undefined ? match.availableAmount.toFixed(2) : 'N/A';
        const directionMatches = match.directionMatches !== undefined ? match.directionMatches : true;

        // Skip transactions with wrong direction - don't display them at all
        if (!directionMatches) {
            return;
        }

        const disableCheckbox = isFullyAllocated;

        const rowClone = rowTemplate.content.cloneNode(true);
        const row = rowClone.querySelector('tr');

        if (disableCheckbox) {
            row.classList.add('qonto-row-disabled');
        }

        const checkbox = rowClone.querySelector('.qonto-checkbox');
        checkbox.dataset.qontoId = match.id;
        if (disableCheckbox) {
            checkbox.disabled = true;
        }

        rowClone.querySelector('.qonto-date').textContent = match.settled_at ? new Date(match.settled_at).toLocaleDateString() : '-';

        // Format available cell with full amount shown below (smaller, greyed out)
        const availableCell = rowClone.querySelector('.qonto-available');
        if (isFullyAllocated) {
            availableCell.classList.add('fully-allocated');
        }

        // Display amounts as negative for debits
        const displayAvailable = match.side === 'debit' ? `-${available}` : available;
        const displayAmount = match.side === 'debit' ? `-${match.amount}` : match.amount;

        // Only show "out of" if available is different from full amount
        const showOutOf = Math.abs(parseFloat(available) - parseFloat(match.amount)) > 0.01;

        // Create the two-line display: available on top, full amount below (if different)
        if (showOutOf) {
            availableCell.innerHTML = `
                <div class="qonto-available-primary">${displayAvailable} €${isFullyAllocated ? ' (Full)' : ''}</div>
                <div class="qonto-amount-secondary">out of ${displayAmount} ${match.currency || 'EUR'}</div>
            `;
        } else {
            availableCell.innerHTML = `
                <div class="qonto-available-primary">${displayAvailable} €${isFullyAllocated ? ' (Full)' : ''}</div>
            `;
        }

        rowClone.querySelector('.qonto-label').textContent = match.label || '-';
        rowClone.querySelector('.qonto-reference').textContent = match.reference || '-';
        rowClone.querySelector('.qonto-status').textContent = match.status || 'completed';

        tbody.appendChild(rowClone);
    });

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

        // If there were partial errors, show them
        if (data.errors && data.errors.length > 0) {
            const errorMessages = data.errors.map(e => e.message).join('\n');
            alert(`Some transactions could not be linked:\n${errorMessages}`);
        }

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

function getTransactionIdFromUrl() {
    const pathParts = window.location.pathname.split('/');
    const transactionsIndex = pathParts.indexOf('transactions');
    if (transactionsIndex !== -1 && pathParts.length > transactionsIndex + 1) {
        return pathParts[transactionsIndex + 1];
    }
    return null;
}
