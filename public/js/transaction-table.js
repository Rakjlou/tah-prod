// Transaction Table JavaScript - Make rows clickable

// This function is called with a URL prefix parameter from the template
function initializeClickableRows(detailUrlPrefix) {
    document.querySelectorAll('.clickable-row').forEach(row => {
        row.addEventListener('click', function() {
            const transactionId = this.getAttribute('data-transaction-id');
            window.location.href = detailUrlPrefix + '/' + transactionId;
        });
    });
}
