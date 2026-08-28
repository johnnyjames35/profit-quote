const router = require('express').Router();
const auth = require('../middleware/auth');

const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID;
const GA_API_SECRET = process.env.GA_API_SECRET;
const PUBLIC_EVENT_TYPES = new Set(['page_viewed', 'trial_click']);
const AUTHENTICATED_FUNNEL_EVENTS = new Set(['quote_started', 'quote_sent', 'quote_downloaded']);

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
  if (!PUBLIC_EVENT_TYPES.has(event_type)) return res.status(400).json({ error: 'unsupported public event_type' });
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

// Product funnel events must be tied to the authenticated user/guest. Never
// accept a client-supplied user id here, otherwise the admin funnel is trivial
// to corrupt.
router.post('/funnel', auth, async (req, res) => {
  const { event_type } = req.body || {};
  if (!AUTHENTICATED_FUNNEL_EVENTS.has(event_type)) {
    return res.status(400).json({ error: 'unsupported funnel event_type' });
  }
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.guest ? null : req.user.id;
    const source = req.user.guest ? 'guest' : 'dashboard';
    await pool.query(
      'INSERT INTO events (event_type, user_id, source, meta) VALUES ($1,$2,$3,$4)',
      [event_type, userId, source, req.user.guest ? { guest_id: req.user.id } : null]
    );
    res.set('Cache-Control', 'private, no-store');
    res.json({ success: true });
    sendToGA(event_type, userId, source);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
module.exports = router;
