/**
 * Nav Dropdown Component
 * Simple dropdown navigation with arrow cycling
 */

function initializeNavDropdown(dropdownElement) {
    const button = dropdownElement.querySelector('.nav-dropdown-button');
    const buttonText = dropdownElement.querySelector('.nav-dropdown-text');
    const menu = dropdownElement.querySelector('.nav-dropdown-menu');
    const leftArrow = dropdownElement.querySelector('[data-arrow="left"]');
    const rightArrow = dropdownElement.querySelector('[data-arrow="right"]');
    const items = Array.from(dropdownElement.querySelectorAll('.nav-dropdown-item'));

    // Get initial state
    const initialText = buttonText.textContent.trim();
    let currentIndex = items.findIndex(item => item.classList.contains('active'));
    if (currentIndex === -1) currentIndex = 0; // Default to first item

    let candidateIndex = currentIndex;
    let isCycling = false;

    // Toggle dropdown menu on button click
    function toggleMenu(event) {
        // Don't toggle if clicking on arrows
        if (event.target.closest('[data-arrow]')) {
            return;
        }

        // If cycling, navigate to candidate
        if (isCycling) {
            const candidateItem = items[candidateIndex];
            if (candidateItem) {
                window.location.href = candidateItem.href;
            }
            return;
        }

        // Toggle menu
        menu.classList.toggle('show');
    }

    // Cycle to previous item
    function cyclePrev(event) {
        event.stopPropagation();
        menu.classList.remove('show'); // Close menu when cycling
        isCycling = true;
        candidateIndex = (candidateIndex - 1 + items.length) % items.length;
        updateButtonText();
    }

    // Cycle to next item
    function cycleNext(event) {
        event.stopPropagation();
        menu.classList.remove('show'); // Close menu when cycling
        isCycling = true;
        candidateIndex = (candidateIndex + 1) % items.length;
        updateButtonText();
    }

    // Update button text to show candidate
    function updateButtonText() {
        const candidateItem = items[candidateIndex];
        if (candidateItem) {
            buttonText.textContent = candidateItem.textContent.trim();
            button.classList.add('cycling');
        }
    }

    // Reset state
    function reset() {
        isCycling = false;
        candidateIndex = currentIndex;
        buttonText.textContent = initialText;
        button.classList.remove('cycling');
        menu.classList.remove('show');
    }

    // Close menu when clicking outside
    function handleOutsideClick(event) {
        if (!dropdownElement.contains(event.target)) {
            reset();
        }
    }

    // Attach event listeners
    button.addEventListener('click', toggleMenu);
    if (leftArrow) leftArrow.addEventListener('click', cyclePrev);
    if (rightArrow) rightArrow.addEventListener('click', cycleNext);
    document.addEventListener('click', handleOutsideClick);

    // Store cleanup function for potential future use
    dropdownElement._cleanup = function() {
        button.removeEventListener('click', toggleMenu);
        if (leftArrow) leftArrow.removeEventListener('click', cyclePrev);
        if (rightArrow) rightArrow.removeEventListener('click', cycleNext);
        document.removeEventListener('click', handleOutsideClick);
    };
}

// Auto-initialize all dropdowns on page load
document.addEventListener('DOMContentLoaded', function() {
    const dropdowns = document.querySelectorAll('.nav-dropdown');
    dropdowns.forEach(dropdown => initializeNavDropdown(dropdown));
});
