// Bands page JavaScript

document.getElementById('band-form')?.addEventListener('submit', function(e) {
    const submitBtn = document.getElementById('submit-btn');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
});
