const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { getDailyTrafficReport } = require('../utils/google-reporting');

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

// Funnel metrics — admin only
router.get('/funnel', requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      visitorsToday, totalVisitors, linkedinVisitors, googleVisitors,
      trialClicks, accountsCreated, firstQuotes, totalQuotes, paidCustomers,
      guestStarts, guestQuotes, guestConversions
    ] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS c FROM events WHERE event_type='page_viewed' AND created_at >= $1", [todayStart]),
      pool.query("SELECT COUNT(*)::int AS c FROM events WHERE event_type='page_viewed'"),
      pool.query("SELECT COUNT(*)::int AS c FROM events WHERE event_type='page_viewed' AND source='linkedin'"),
      pool.query("SELECT COUNT(*)::int AS c FROM events WHERE event_type='page_viewed' AND source='google'"),
      pool.query("SELECT COUNT(*)::int AS c FROM events WHERE event_type='trial_click'"),
      pool.query("SELECT COUNT(*)::int AS c FROM events WHERE event_type='account_created'"),
      pool.query("SELECT COUNT(*)::int AS c FROM events WHERE event_type='first_quote'"),
      pool.query("SELECT COUNT(*)::int AS c FROM quotes"),
      pool.query("SELECT COUNT(*)::int AS c FROM users WHERE paid_at IS NOT NULL"),
      pool.query("SELECT COUNT(*)::int AS c FROM guest_sessions"),
      pool.query("SELECT COUNT(*)::int AS c FROM quotes WHERE guest_id IS NOT NULL"),
      pool.query("SELECT COUNT(*)::int AS c FROM guest_sessions WHERE converted_user_id IS NOT NULL")
    ]);

    const paidCount = paidCustomers.rows[0].c;
    const mrr = paidCount * 49;

    res.json({
      visitorsToday: visitorsToday.rows[0].c,
      totalVisitors: totalVisitors.rows[0].c,
      linkedinVisitors: linkedinVisitors.rows[0].c,
      googleVisitors: googleVisitors.rows[0].c,
      trialClicks: trialClicks.rows[0].c,
      accountsCreated: accountsCreated.rows[0].c,
      firstQuotes: firstQuotes.rows[0].c,
      totalQuotes: totalQuotes.rows[0].c,
      paidCustomers: paidCount,
      guestStarts: guestStarts.rows[0].c,
      guestQuotes: guestQuotes.rows[0].c,
      guestConversions: guestConversions.rows[0].c,
      mrr
    });
  } catch(e) {
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
    const report = await getDailyTrafficReport({ date: req.query.date });
    res.set('Cache-Control', 'private, no-store');
    res.json(report);
  } catch (error) {
    const isInputError = error.message.startsWith('date must');
    console.error('Daily reporting error:', error.message);
    res.status(isInputError ? 400 : 502).json({ error: isInputError ? error.message : 'Unable to retrieve Google reporting data' });
  }
});

module.exports = router;
