const router = require('express').Router();
const auth = require('../middleware/auth');

const {sendToGA, requestContext}=require('../utils/ga');
const PUBLIC_EVENT_TYPES = new Set(['page_viewed', 'trial_click']);
// Account creation is server-owned; older clients must not duplicate it.
const AUTHENTICATED_FUNNEL_EVENTS = new Set(['quote_started', 'quote_saved', 'save_prompt_shown', 'quote_downloaded', 'checkout_started', 'signup_screen_viewed', 'signup_attempted', 'signup_failed']);


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
    sendToGA(event_type, null, source, requestContext(req)); // fire-and-forget, never blocks or breaks the existing response
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
    sendToGA(event_type, userId, source, requestContext(req));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
module.exports = router;
