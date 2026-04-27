const express = require('express');
const app = express();
const port = process.env.PORT || 8000;
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const pairRouter = require('./sila');
app.use('/', pairRouter);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        bot: 'Silatrix Bot',
        version: '2.0.0',
        timestamp: new Date().toISOString()
    });
});

app.listen(port, () => {
    console.log('='.repeat(60));
    console.log('🤖 SILATRIX BOT SERVER');
    console.log('='.repeat(60));
    console.log(`🌐 Server running on port ${port}`);
    console.log(`🔗 Pairing URL: http://localhost:${port}`);
    console.log(`💾 Database: MongoDB Connected`);
    console.log('='.repeat(60));
    console.log('> © Powered By Sila Tech');
});

module.exports = app;
