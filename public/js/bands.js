// Bands page JavaScript

document.getElementById('band-form')?.addEventListener('submit', function(e) {
    const submitBtn = document.getElementById('submit-btn');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
});

function toggleCredentials(bandId) {
    var row = document.getElementById('credentials-' + bandId);
    if (row) {
        row.style.display = row.style.display === 'none' ? '' : 'none';
    }
}
