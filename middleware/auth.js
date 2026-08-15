const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    const pool = req.app.locals.pool;
    if (pool && req.user?.guest && req.user?.id) {
      pool.query('UPDATE guest_sessions SET last_active_at=NOW() WHERE id=$1 AND expires_at>NOW()', [req.user.id]).catch(e => console.error('Guest activity update error:', e.message));
    } else if (pool && req.user?.id) {
      pool.query('UPDATE users SET first_login_at=COALESCE(first_login_at,NOW()), last_active_at=NOW() WHERE id=$1', [req.user.id]).catch(e => console.error('Activity update error:', e.message));
    }
    next();
  } catch(e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};
