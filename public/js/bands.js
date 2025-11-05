// Bands page JavaScript

document.getElementById('band-form')?.addEventListener('submit', function(e) {
    const submitBtn = document.getElementById('submit-btn');

    // Disable submit button and change text
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
});
