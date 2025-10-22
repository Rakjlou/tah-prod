// Email service stub
// Currently logs to console, will be integrated with SMTP provider later

async function sendBandWelcomeEmail(email, username, password) {
    // TODO: Integrate with email provider (SMTP, SendGrid, etc.)
    // For now, log the credentials to console for admin to share manually
    console.log('');
    console.log('='.repeat(60));
    console.log('BAND ACCOUNT CREATED - CREDENTIALS TO SHARE');
    console.log('='.repeat(60));
    console.log(`Email: ${email}`);
    console.log(`Username: ${username}`);
    console.log(`Temporary Password: ${password}`);
    console.log('');
    console.log('Please share these credentials with the band member.');
    console.log('='.repeat(60));
    console.log('');
}

async function sendPasswordResetEmail(email, newPassword) {
    // TODO: Integrate with email provider (SMTP, SendGrid, etc.)
    console.log('');
    console.log('='.repeat(60));
    console.log('PASSWORD RESET');
    console.log('='.repeat(60));
    console.log(`Email: ${email}`);
    console.log(`New Temporary Password: ${newPassword}`);
    console.log('');
    console.log('Please share the new password with the band member.');
    console.log('='.repeat(60));
    console.log('');
}

module.exports = {
    sendBandWelcomeEmail,
    sendPasswordResetEmail
};
