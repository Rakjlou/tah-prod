// Bands page JavaScript

document.getElementById('band-form')?.addEventListener('submit', function(e) {
    const submitBtn = document.getElementById('submit-btn');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
});

function toggleCredentials(bandId) {
    var row = document.getElementById('credentials-' + bandId);
    var btn = document.getElementById('credentials-toggle-' + bandId);
    if (!row) return;
    var willShow = row.style.display === 'none';
    row.style.display = willShow ? '' : 'none';
    if (btn) {
        btn.textContent = willShow ? '\u25BE' : '\u25B8'; // ▾ / ▸
        btn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
    }
}
