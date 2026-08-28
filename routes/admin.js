const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { getDailyTrafficReport, getLiveSearchReport } = require('../utils/google-reporting');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.JWT_SECRET + '_admin';

function requireAdmin(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, ADMIN_SECRET);
    if (!decoded.admin) return res.status(401).json({ error: 'Not admin' });
    next();
  } catch(e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function logEvent(pool, eventType, userId, source) {
  return pool.query(
    'INSERT INTO events (event_type, user_id, source) VALUES ($1,$2,$3)',
    [eventType, userId || null, source || null]
  ).catch(e => console.error('Event log error:', e.message));
}

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const token = jwt.sign({ admin: true }, ADMIN_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.trade,
        u.created_at,
        u.paid_at,
        u.first_login_at,
        u.last_active_at,
        COUNT(q.id)::int AS quote_count
      FROM users u
      LEFT JOIN quotes q ON q.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users: result.rows });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Funnel metrics — admin only. Periods use Europe/London calendar boundaries.
router.get('/funnel', requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const period = ['today', '7d', '30d', 'all'].includes(req.query.period) ? req.query.period : 'today';
    const lowerBounds = {
      today: "date_trunc('day', NOW() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London'",
      '7d': "(date_trunc('day', NOW() AT TIME ZONE 'Europe/London') - INTERVAL '6 days') AT TIME ZONE 'Europe/London'",
      '30d': "(date_trunc('day', NOW() AT TIME ZONE 'Europe/London') - INTERVAL '29 days') AT TIME ZONE 'Europe/London'"
    };
    // Legacy tables use timestamp-without-time-zone values written by a UTC
    // Railway session. Make that assumption explicit instead of depending on
    // the current database/session timezone during comparisons.
    const legacyCondition = (column) => period === 'all' ? 'TRUE' : `(${column} AT TIME ZONE 'UTC') >= ${lowerBounds[period]}`;
    const zonedCondition = (column) => period === 'all' ? 'TRUE' : `${column} >= ${lowerBounds[period]}`;

    const [
      visitors, linkedinVisitors, googleVisitors, trialClicks, accountsCreated,
      firstQuotes, totalQuotes, paidCustomers, activePaidCustomers,
      guestStarts, guestQuotes, guestConversions, quoteStarts, quoteSends, quoteDownloads
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM events WHERE event_type='page_viewed' AND ${legacyCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM events WHERE event_type='page_viewed' AND source='linkedin' AND ${legacyCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM events WHERE event_type='page_viewed' AND source='google' AND ${legacyCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM events WHERE event_type='trial_click' AND ${legacyCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE ${legacyCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM events WHERE event_type='first_quote' AND ${legacyCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM quotes WHERE ${legacyCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM users WHERE paid_at IS NOT NULL AND ${legacyCondition('paid_at')}`),
      pool.query("SELECT COUNT(*)::int AS c FROM users WHERE paid_at IS NOT NULL"),
      pool.query(`SELECT COUNT(*)::int AS c FROM guest_sessions WHERE ${zonedCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM quotes WHERE guest_id IS NOT NULL AND ${legacyCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM guest_sessions WHERE converted_user_id IS NOT NULL AND ${zonedCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM events WHERE event_type='quote_started' AND ${legacyCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM events WHERE event_type='quote_sent' AND ${legacyCondition('created_at')}`),
      pool.query(`SELECT COUNT(*)::int AS c FROM events WHERE event_type='quote_downloaded' AND ${legacyCondition('created_at')}`)
    ]);

    const activePaidCount = activePaidCustomers.rows[0].c;
    res.set('Cache-Control', 'private, no-store');
    res.json({
      period,
      timezone: 'Europe/London',
      generatedAt: new Date().toISOString(),
      visitorsToday: visitors.rows[0].c,
      totalVisitors: visitors.rows[0].c,
      linkedinVisitors: linkedinVisitors.rows[0].c,
      googleVisitors: googleVisitors.rows[0].c,
      trialClicks: trialClicks.rows[0].c,
      accountsCreated: accountsCreated.rows[0].c,
      firstQuotes: firstQuotes.rows[0].c,
      totalQuotes: totalQuotes.rows[0].c,
      paidCustomers: paidCustomers.rows[0].c,
      activePaidCustomers: activePaidCount,
      guestStarts: guestStarts.rows[0].c,
      guestQuotes: guestQuotes.rows[0].c,
      guestConversions: guestConversions.rows[0].c,
      quoteStarts: quoteStarts.rows[0].c,
      quoteCompletions: totalQuotes.rows[0].c,
      quoteSends: quoteSends.rows[0].c,
      quoteDownloads: quoteDownloads.rows[0].c,
      mrr: activePaidCount * 49
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Clear funnel tracking events without touching registered users or their quotes.
router.delete('/funnel/events', requireAdmin, async (req, res) => {
  try {
    const result = await req.app.locals.pool.query('DELETE FROM events');
    res.json({ success: true, deletedEvents: result.rowCount });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Clear unconverted guest sessions and their guest-owned quotes only.
// Converted quotes are safe because conversion moves them to user_id and clears guest_id.
router.delete('/funnel/guest-data', requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    await pool.query('BEGIN');
    const quotes = await pool.query('DELETE FROM quotes WHERE guest_id IS NOT NULL');
    const sessions = await pool.query('DELETE FROM guest_sessions');
    await pool.query('COMMIT');
    res.json({
      success: true,
      deletedGuestQuotes: quotes.rowCount,
      deletedGuestSessions: sessions.rowCount
    });
  } catch(e) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  }
});

// Mark a user as paid — admin only
router.patch('/users/:id/mark-paid', requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE users SET paid_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true });
    logEvent(pool, 'subscription_started', id, null);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Mark a user as cancelled — admin only (logs event, does not remove access)
router.patch('/users/:id/mark-cancelled', requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  try {
    const exists = await pool.query('SELECT id FROM users WHERE id=$1', [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true });
    logEvent(pool, 'subscription_cancelled', id, null);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a user (and their quotes) — admin only
router.delete('/users/:id', requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM quotes WHERE user_id = $1', [id]);
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    await pool.query('COMMIT');

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true, deletedId: id });
  } catch(e) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  }
});

// Read-only Google traffic report — admin only. Defaults to yesterday for complete data.
router.get('/reporting/daily', requireAdmin, async (req, res) => {
  try {
    const report = await getDailyTrafficReport({ date: req.query.date, includeComparisons: true });
    const pool = req.app.locals.pool;
    const appResult = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM quotes WHERE (created_at AT TIME ZONE 'UTC') >= ($1::date::timestamp AT TIME ZONE 'Europe/London') AND (created_at AT TIME ZONE 'UTC') < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/London')) AS quote_completions,
        (SELECT COUNT(*)::int FROM events WHERE event_type='quote_started' AND (created_at AT TIME ZONE 'UTC') >= ($1::date::timestamp AT TIME ZONE 'Europe/London') AND (created_at AT TIME ZONE 'UTC') < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/London')) AS quote_starts,
        (SELECT COUNT(*)::int FROM events WHERE event_type='quote_sent' AND (created_at AT TIME ZONE 'UTC') >= ($1::date::timestamp AT TIME ZONE 'Europe/London') AND (created_at AT TIME ZONE 'UTC') < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/London')) AS quote_sends,
        (SELECT COUNT(*)::int FROM events WHERE event_type='quote_downloaded' AND (created_at AT TIME ZONE 'UTC') >= ($1::date::timestamp AT TIME ZONE 'Europe/London') AND (created_at AT TIME ZONE 'UTC') < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/London')) AS quote_downloads,
        (SELECT COUNT(*)::int FROM users WHERE (created_at AT TIME ZONE 'UTC') >= ($1::date::timestamp AT TIME ZONE 'Europe/London') AND (created_at AT TIME ZONE 'UTC') < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/London')) AS accounts_created,
        (SELECT COUNT(*)::int FROM users WHERE paid_at IS NOT NULL AND (paid_at AT TIME ZONE 'UTC') >= ($1::date::timestamp AT TIME ZONE 'Europe/London') AND (paid_at AT TIME ZONE 'UTC') < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/London')) AS purchases
    `, [report.date]);
    const app = appResult.rows[0] || {};
    report.appFunnel = {
      date: report.date,
      timezone: 'Europe/London',
      quoteStarts: app.quote_starts || 0,
      quoteCompletions: app.quote_completions || 0,
      quoteSends: app.quote_sends || 0,
      quoteDownloads: app.quote_downloads || 0,
      accountsCreated: app.accounts_created || 0,
      purchases: app.purchases || 0,
      note: 'Quote completions come from saved quote records; other funnel events are available from the deployment that introduced event tracking.'
    };
    res.set('Cache-Control', 'private, no-store');
    res.json(report);
  } catch (error) {
    const isInputError = error.message.startsWith('date must');
    console.error('Daily reporting error:', error.message);
    res.status(isInputError ? 400 : 502).json({ error: isInputError ? error.message : 'Unable to retrieve Google reporting data' });
  }
});

// Fresh, partial Search Console data using Google's latest 24 available hourly rows.
router.get('/reporting/live', requireAdmin, async (_req, res) => {
  try {
    const report = await getLiveSearchReport();
    res.set('Cache-Control', 'private, no-store');
    res.json(report);
  } catch (error) {
    console.error('Live reporting error:', error.message);
    res.status(502).json({ error: 'Unable to retrieve live Search Console data' });
  }
});

module.exports = router;

