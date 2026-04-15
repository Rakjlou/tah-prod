async function forceFetchQonto() {
    const button = document.getElementById('force-fetch-btn');
    const resultDiv = document.getElementById('qonto-fetch-result');
    const originalText = button.textContent;

    button.disabled = true;
    button.textContent = 'Fetching...';
    resultDiv.textContent = 'Syncing with Qonto...';
    resultDiv.style.color = 'white';

    try {
        const response = await fetch('/admin/qonto/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.success) {
            const msg = data.synced > 0
                ? `\u2713 Synced ${data.synced} new transaction${data.synced === 1 ? '' : 's'} (total: ${data.total})`
                : '\u2713 No new transactions (already up to date)';
            resultDiv.textContent = msg;
            resultDiv.style.color = '#4caf50';
            setTimeout(() => window.location.reload(), 800);
        } else {
            resultDiv.textContent = '\u2717 ' + (data.message || 'Sync failed');
            resultDiv.style.color = '#f44336';
            button.disabled = false;
            button.textContent = originalText;
        }
    } catch (err) {
        resultDiv.textContent = '\u2717 ' + err.message;
        resultDiv.style.color = '#f44336';
        button.disabled = false;
        button.textContent = originalText;
    }
}
