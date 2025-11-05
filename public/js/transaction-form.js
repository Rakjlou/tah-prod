// Transaction Form JavaScript

function toggleTransactionDate() {
    const dateInput = document.getElementById('transaction_date');
    const clearCheckbox = document.getElementById('clear_date');

    if (clearCheckbox.checked) {
        dateInput.value = '';
        dateInput.disabled = true;
    } else {
        dateInput.disabled = false;
    }
}

function filterCategories() {
    const selectedType = document.querySelector('input[name="type"]:checked').value;
    const categorySelect = document.getElementById('category_id');
    const options = categorySelect.querySelectorAll('option');

    // Save current selection
    const currentValue = categorySelect.value;

    options.forEach(option => {
        if (option.value === '') {
            option.style.display = '';
            return;
        }

        const categoryType = option.getAttribute('data-type');
        // Show if type matches or category is 'both'
        if (categoryType === selectedType || categoryType === 'both') {
            option.style.display = '';
        } else {
            option.style.display = 'none';
        }
    });

    // Restore selection if it's still visible
    if (currentValue) {
        const selectedOption = categorySelect.querySelector(`option[value="${currentValue}"]`);
        if (selectedOption && selectedOption.style.display !== 'none') {
            categorySelect.value = currentValue;
        } else {
            // If current selection is now hidden, reset to empty
            categorySelect.value = '';
        }
    }
}

// Filter on page load
document.addEventListener('DOMContentLoaded', function() {
    filterCategories();
});

// Show loading state on submit
document.getElementById('transaction-form')?.addEventListener('submit', function(e) {
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';
});
