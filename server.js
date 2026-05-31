require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
app.locals.pool = pool;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/issues', require('./routes/issues'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/admin', require('./routes/admin'));

// Trial / payment check middleware
async function trialCheck(req, res, next) {
  try {
    const result = await pool.query(
      'SELECT trial_started_at, paid_at FROM users WHERE id=$1',
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Already paid — always allow
    if (user.paid_at) return next();

    const started = new Date(user.trial_started_at);
    const now = new Date();
    const daysSince = Math.floor((now - started) / (1000 * 60 * 60 * 24));

    if (daysSince <= 10) return next();

    // Blocked
    return res.status(402).json({
      error: 'trial_expired',
      message: 'Your free trial has ended. Please complete your onboarding to continue using ProfitQuote.',
      onboardingUrl: 'https://buy.stripe.com/eVq00d6z96TcdzN9QUc3m0b',
      subscriptionUrl: 'https://buy.stripe.com/4gMdR32iTb9s67l2osc3m0a'
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// AI proxy — protected by auth + trial check
app.post('/api/ai', require('./middleware/auth'), trialCheck, async (req, res) => {
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
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
// Serve app for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
