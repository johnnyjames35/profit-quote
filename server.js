require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { startDailyTrafficEmailScheduler } = require('./utils/daily-traffic-email');
const { startTrialEmailScheduler } = require('./utils/trialEmails');
const { isFreeOnboardingOfferActive } = require('./utils/onboarding-offer');

const app = express();
const PORT = process.env.PORT || 3000;

// Database
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
app.locals.pool = pool;
const {migrate:migrateBundle,createBundleBilling}=require('./bundle-billing');
const Stripe=require('stripe');
const bundleStripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2026-08-26.dahlia',maxNetworkRetries:2}):null;
app.locals.bundleBilling=createBundleBilling({db:pool,stripe:bundleStripe,app:'profitquote'});

// Middleware
app.use(cors({ origin: '*' }));
app.set('trust proxy', 1);
app.post('/api/billing/webhook',express.raw({type:'application/json'}),require('./routes/billing').webhook);
app.use(express.json());
// Consolidate public search signals and keep private application screens out of search.
app.use((req, res, next) => {
  if (req.hostname.toLowerCase() === 'www.profitquote.co.uk') {
    return res.redirect(301, `https://profitquote.co.uk${req.originalUrl}`);
  }
  if (req.path.toLowerCase() === '/index.html') {
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    return res.redirect(301, `/${query}`);
  }
  if (['/admin', '/admin.html', '/dashboard', '/dashboard.html'].includes(req.path.toLowerCase())) {
    res.set('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});
app.use(require('./routes/commercial-pages'));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/billing',require('./routes/billing').router);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/guest', require('./routes/guest'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/issues', require('./routes/issues'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/reporting', require('./routes/reporting'));
app.use('/monitoring', require('./routes/monitoring'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/events', require('./routes/events'));
app.use('/api/leads', require('./routes/leads'));
// Stripe Payment Links are reconciled through authenticated account checks.
// Legacy webhook processing is deliberately disabled.

// Trial / payment check middleware
async function trialCheck(req, res, next) {
  try {
    if (req.user.guest) {
      const guest = await pool.query('UPDATE guest_sessions SET ai_requests=ai_requests+1,last_active_at=NOW() WHERE id=$1 AND expires_at>NOW() AND converted_user_id IS NULL AND ai_requests<12 RETURNING id', [req.user.id]);
      if (!guest.rows.length) return res.status(402).json({ error: 'guest_limit', message: 'Create your free account to continue and keep your quotes.' });
      return next();
    }
    const {access,limitError}=require('./utils/quote-access');
    const a=await access(pool,req.user);
    if(!a.can_create) throw limitError();
    return next();
  } catch(e) {
    return res.status(e.status||500).json({ error: e.message, code:e.code });
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
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
// Serve the homepage only for genuine visits to "/" —
// anything else that reaches here didn't match a real page, so it's a true 404
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});
app.use('/api', (error, req, res, next) => {
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({ error: error.type === 'entity.parse.failed' ? 'Invalid JSON request body' : 'API request failed' });
});
app.get('*', (req, res) => {
  res.status(404).send('<h1>Page not found</h1><p>The page you are looking for does not exist. <a href="/">Return to homepage</a></p>');
});

async function init() {
  try {
    const fs = require('fs');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    await migrateBundle(pool);
    const bundleTimer=setInterval(()=>app.locals.bundleBilling.reconcile().catch(e=>console.error('Bundle check failed:',e.message)),60000);
    bundleTimer.unref();
    console.log('Database ready');
    startDailyTrafficEmailScheduler(pool);
        startTrialEmailScheduler(pool);
  } catch(e) {
    console.error('DB init error:', e.message);
  }
  app.listen(PORT, () => console.log(`ProfitQuote running on port ${PORT}`));
}

init();
