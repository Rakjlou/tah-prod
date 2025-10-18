const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { initializeDatabase, createUser } = require('./lib/db');
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
