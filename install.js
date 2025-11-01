const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { initializeDatabase, createUser, setConfig } = require('./lib/db');
const { hashPassword } = require('./lib/auth');
const { ROLES } = require('./lib/roles');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function questionHidden(query) {
    return new Promise(resolve => {
        const stdin = process.stdin;
        const stdout = process.stdout;

        stdout.write(query);
        stdin.resume();
        stdin.setRawMode(true);
        stdin.setEncoding('utf8');

        let password = '';
        const onData = (char) => {
            char = char.toString('utf8');

            switch (char) {
                case '\n':
                case '\r':
                case '\u0004':
                    stdin.setRawMode(false);
                    stdin.removeListener('data', onData);
                    stdout.write('\n');
                    resolve(password);
                    break;
                case '\u0003':
                    process.exit();
                    break;
                case '\u007f':
                    password = password.slice(0, -1);
                    break;
                default:
                    password += char;
                    break;
            }
        };

        stdin.on('data', onData);
    });
}

async function install() {
    console.log('='.repeat(50));
    console.log('TAH PROD - Installation Script');
    console.log('='.repeat(50));
    console.log('');

    try {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            console.log('Created data directory');
        }

        console.log('Initializing database...');
        await initializeDatabase();
        console.log('Database initialized successfully');
        console.log('');

        console.log('Please create an admin account:');
        console.log('');

        const username = await question('Username: ');
        if (!username || username.trim().length === 0) {
            console.error('Username cannot be empty');
            process.exit(1);
        }

        const password = await question('Password: ');
        if (!password || password.length === 0) {
            console.error('Password cannot be empty');
            process.exit(1);
        }

        console.log('');
        console.log('Hashing password...');
        const hashedPassword = await hashPassword(password);

        console.log('Creating admin user...');
        await createUser(username.trim(), hashedPassword, ROLES.ADMIN);

        console.log('');
        console.log('='.repeat(50));
        console.log('Google OAuth Configuration (Optional)');
        console.log('='.repeat(50));
        console.log('You can configure Google OAuth now or later via /config');
        console.log('');

        const configureOAuth = await question('Configure Google OAuth now? (y/n): ');

        if (configureOAuth.toLowerCase() === 'y' || configureOAuth.toLowerCase() === 'yes') {
            const envClientId = process.env.GOOGLE_CLIENT_ID || '';
            const envClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
            const envRedirectUri = process.env.GOOGLE_REDIRECT_URI || '';
            const envFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

            const clientId = await question(`Google Client ID [${envClientId}]: `) || envClientId;
            const clientSecret = await question(`Google Client Secret [${envClientSecret}]: `) || envClientSecret;
            const redirectUri = await question(`Google Redirect URI [${envRedirectUri}]: `) || envRedirectUri;
            const folderId = await question(`Google Drive Folder ID [${envFolderId}]: `) || envFolderId;

            if (clientId) {
                await setConfig('google_client_id', clientId);
                console.log('✓ Google Client ID saved');
            }
            if (clientSecret) {
                await setConfig('google_client_secret', clientSecret);
                console.log('✓ Google Client Secret saved');
            }
            if (redirectUri) {
                await setConfig('google_redirect_uri', redirectUri);
                console.log('✓ Google Redirect URI saved');
            }
            if (folderId) {
                await setConfig('google_drive_folder_id', folderId);
                console.log('✓ Google Drive Folder ID saved');
            }
        }

        console.log('');
        console.log('='.repeat(50));
        console.log('Qonto Bank API Configuration (Optional)');
        console.log('='.repeat(50));
        console.log('You can configure Qonto API now or later via /config');
        console.log('');

        const configureQonto = await question('Configure Qonto API now? (y/n): ');

        if (configureQonto.toLowerCase() === 'y' || configureQonto.toLowerCase() === 'yes') {
            const envQontoLogin = process.env.QONTO_API_LOGIN || '';
            const envQontoSecret = process.env.QONTO_API_SECRET || '';

            const qontoLogin = await question(`Qonto API Login [${envQontoLogin}]: `) || envQontoLogin;
            const qontoSecret = await question(`Qonto API Secret [${envQontoSecret}]: `) || envQontoSecret;

            if (qontoLogin) {
                await setConfig('qonto_api_login', qontoLogin);
                console.log('✓ Qonto API Login saved');
            }
            if (qontoSecret) {
                await setConfig('qonto_api_secret', qontoSecret);
                console.log('✓ Qonto API Secret saved');
            }
        }

        console.log('');
        console.log('='.repeat(50));
        console.log('Installation completed successfully!');
        console.log('='.repeat(50));
        console.log('');
        console.log('You can now start the server with: npm start');
        console.log('');

    } catch (error) {
        console.error('');
        console.error('Installation failed:', error.message);
        process.exit(1);
    } finally {
        rl.close();
    }
}

install();
