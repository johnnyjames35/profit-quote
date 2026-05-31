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

module.exports = router;
