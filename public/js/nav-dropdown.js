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
    let isHovering = false;

    // Navigate on button click
    function handleButtonClick(event) {
        // Don't navigate if clicking on arrows
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

        // Otherwise, navigate to first item
        const firstItem = items[0];
        if (firstItem) {
            window.location.href = firstItem.href;
        }
    }

    // Cycle to previous item
    function cyclePrev(event) {
        event.stopPropagation();
        isCycling = true;
        candidateIndex = (candidateIndex - 1 + items.length) % items.length;
        updateButtonText();
    }

    // Cycle to next item
    function cycleNext(event) {
        event.stopPropagation();
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

    // Show menu on hover
    function handleMouseEnter() {
        isHovering = true;

        // Only show menu if NOT actively cycling
        if (!isCycling) {
            menu.classList.add('show');
        }
    }

    // Hide menu when mouse leaves
    function handleMouseLeave() {
        isHovering = false;
        menu.classList.remove('show');

        // Reset cycling state for clean UX
        if (isCycling) {
            reset();
        }
    }

    // Reset state
    function reset() {
        isCycling = false;
        candidateIndex = currentIndex;
        buttonText.textContent = initialText;
        button.classList.remove('cycling');

        // Only hide menu if not hovering
        if (!isHovering) {
            menu.classList.remove('show');
        }
    }

    // Close menu when clicking outside
    function handleOutsideClick(event) {
        if (!dropdownElement.contains(event.target)) {
            isHovering = false;
            reset();
        }
    }

    // Attach event listeners
    button.addEventListener('click', handleButtonClick);
    if (leftArrow) leftArrow.addEventListener('click', cyclePrev);
    if (rightArrow) rightArrow.addEventListener('click', cycleNext);
    dropdownElement.addEventListener('mouseenter', handleMouseEnter);
    dropdownElement.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('click', handleOutsideClick);

    // Store cleanup function for potential future use
    dropdownElement._cleanup = function() {
        button.removeEventListener('click', handleButtonClick);
        if (leftArrow) leftArrow.removeEventListener('click', cyclePrev);
        if (rightArrow) rightArrow.removeEventListener('click', cycleNext);
        dropdownElement.removeEventListener('mouseenter', handleMouseEnter);
        dropdownElement.removeEventListener('mouseleave', handleMouseLeave);
        document.removeEventListener('click', handleOutsideClick);
    };
}

// Auto-initialize all dropdowns on page load
document.addEventListener('DOMContentLoaded', function() {
    const dropdowns = document.querySelectorAll('.nav-dropdown');
    dropdowns.forEach(dropdown => initializeNavDropdown(dropdown));
});
