require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Make pool available to routes
app.locals.pool = pool;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/issues', require('./routes/issues'));
app.use('/api/settings', require('./routes/settings'));
// AI proxy
app.post('/api/ai', require('./middleware/auth'), async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve the app for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Init DB tables then start
async function init() {
  try {
    const fs = require('fs');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('Database ready');
  } catch(e) {
    console.error('DB init error:', e.message);
  }
  app.listen(PORT, () => console.log(`ProfitQuote running on port ${PORT}`));
}

init();
