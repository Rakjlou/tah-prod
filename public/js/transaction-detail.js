// Transaction Detail page JavaScript

document.getElementById('create-folder-form')?.addEventListener('submit', function(e) {
    const createFolderBtn = document.getElementById('create-folder-btn');
    createFolderBtn.disabled = true;
    createFolderBtn.textContent = 'Creating...';
});

document.getElementById('upload-form')?.addEventListener('submit', function(e) {
    const uploadBtn = document.getElementById('upload-btn');
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
});
