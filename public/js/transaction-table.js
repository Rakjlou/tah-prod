// Transaction Table JavaScript - Make rows clickable

// This function is called with a URL prefix parameter from the template
function initializeClickableRows(detailUrlPrefix) {
    document.querySelectorAll('.table-clickable tbody tr[data-transaction-id]').forEach(row => {
        row.addEventListener('click', function() {
            const transactionId = this.getAttribute('data-transaction-id');
            window.location.href = detailUrlPrefix + '/' + transactionId;
        });
    });
}
