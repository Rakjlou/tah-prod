# TAH PROD

A web-based accounting management system designed for managing band finances with role-based access control.

## Features

### For Bands
- **Transaction Management**: Record income and expense transactions with detailed categorization
- **Document Upload**: Attach receipts and invoices directly to transactions via Google Drive
- **Real-time Tracking**: View all financial activity in a centralized dashboard
- **Google Sheets Integration**: Automatic synchronization of transactions to dedicated spreadsheets

### For Administrators
- **Multi-band Management**: Oversee multiple bands from a single interface
- **Transaction Validation**: Review and approve pending transactions
- **Access Control**: Create and manage band accounts with secure authentication
- **Centralized Configuration**: Configure Google Drive and OAuth settings via web interface

### Security & Access
- **Role-based Permissions**: Bands can only view and edit their own transactions
- **Status-based Controls**: Bands can edit pending transactions; validated transactions are locked
- **Session Management**: Secure authentication with encrypted session storage
- **Google OAuth**: Authenticated access to Google Drive and Sheets APIs

## Technology Stack

- Node.js with Express framework
- SQLite for data persistence
- Google Drive & Sheets API integration
- Session-based authentication with bcrypt password hashing
- EJS templating with terminal-inspired UI design

## Quick Start

```bash
# Install dependencies and initialize database
npm install

# Start the server
npm start
```

Visit `http://localhost:3000` and login with the admin account created during installation.

## First-time Setup

1. Configure Google OAuth credentials in the Config section
2. Authenticate with Google to enable Drive/Sheets integration
3. Create band accounts from the Bands section
4. Start tracking transactions

For detailed setup instructions including Google Cloud Console configuration, see the inline documentation in the codebase.
