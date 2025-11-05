// Config page JavaScript

async function testQontoConnection() {
    const login = document.getElementById('qonto_api_login').value;
    const secret = document.getElementById('qonto_api_secret').value;
    const resultDiv = document.getElementById('qonto-test-result');

    if (!login || !secret) {
        resultDiv.textContent = '⚠️ Please enter both login and secret key';
        resultDiv.style.color = '#ffeb3b';
        return;
    }

    resultDiv.textContent = 'Testing connection...';
    resultDiv.style.color = 'white';

    try {
        const response = await fetch('/admin/test-qonto', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ login, secret })
        });

        const data = await response.json();

        if (data.success) {
            resultDiv.textContent = '✓ ' + data.message;
            resultDiv.style.color = '#4caf50';
        } else {
            resultDiv.textContent = '✗ ' + data.message;
            resultDiv.style.color = '#f44336';
        }
    } catch (err) {
        resultDiv.textContent = '✗ Connection test failed: ' + err.message;
        resultDiv.style.color = '#f44336';
    }
}
