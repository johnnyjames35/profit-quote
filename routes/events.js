const router = require('express').Router();

router.post('/', async (req, res) => {
  const { event_type, user_id, source } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type required' });
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      'INSERT INTO events (event_type, user_id, source) VALUES ($1,$2,$3)',
      [event_type, user_id || null, source || null]
    );
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
