const router = require('express').Router();
const jwt = require('jsonwebtoken');

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

module.exports = router;
