require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Google Sheets setup
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    },
    scopes: 'https://www.googleapis.com/auth/spreadsheets',
});

const spreadsheetId = process.env.SHEET_ID;
const sheetName = 'Responses'; // Make sure this matches exactly your sheet tab name

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Initialize sheet (create if doesn't exist)
async function initializeSheet() {
    try {
        const sheets = google.sheets({ version: 'v4', auth });
        
        // Check if sheet exists
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId,
            ranges: [`${sheetName}!A1`],
            fields: 'sheets.properties.title'
        });

        const sheetExists = spreadsheet.data.sheets?.some(
            s => s.properties.title === sheetName
        );

        if (!sheetExists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: sheetName
                            }
                        }
                    }]
                }
            });

            // Add headers
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A1:E1`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [['Timestamp', 'Name', 'Email', 'Phone', 'Message']]
                }
            });
            console.log(`Created new sheet "${sheetName}" with headers`);
        }
    } catch (error) {
        console.error('Error initializing sheet:', error.message);
    }
}

// Form submission endpoint with improved error handling
app.post('/submit-form', async (req, res) => {
    try {
        const { name, email, phone, message } = req.body;
        
        if (!name || !email || !message) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields (name, email, message)'
            });
        }

        const timestamp = new Date().toLocaleString();
        const sheets = google.sheets({ version: 'v4', auth });

        // First verify sheet exists
        try {
            await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A1`
            });
        } catch (err) {
            await initializeSheet();
        }

        const result = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A:E`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[timestamp, name, email, phone || '', message]],
            },
        });

        console.log('Data appended successfully:', result.data.updates);

        res.json({ 
            success: true,
            updatedRange: result.data.updates?.updatedRange
        });
    } catch (error) {
        console.error('Submission error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to submit form',
            details: error.errors || null
        });
    }
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize sheet when server starts
initializeSheet().then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Google Sheet: ${spreadsheetId}`);
        console.log(`Sheet tab: ${sheetName}`);
    });
});
