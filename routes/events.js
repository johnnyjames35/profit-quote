const router = require('express').Router();

const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID;
const GA_API_SECRET = process.env.GA_API_SECRET;

// Sends the same event to Google Analytics 4 (does not affect the database save above)
async function sendToGA(event_type, user_id, source) {
  if (!GA_MEASUREMENT_ID || !GA_API_SECRET) return; // safety: does nothing if env vars aren't set yet
  try {
    const clientId = user_id ? `user-${user_id}` : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`,
      {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          events: [{
            name: event_type,
            params: { source: source || 'unknown' }
          }]
        })
      }
    );
  } catch (e) {
    console.error('GA event send error:', e.message);
  }
}

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
    sendToGA(event_type, user_id, source); // fire-and-forget, never blocks or breaks the existing response
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
module.exports = router;
