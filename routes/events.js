const router = require('express').Router();
const auth = require('../middleware/auth');

const {sendToGA, requestContext}=require('../utils/ga');
const PUBLIC_EVENT_TYPES = new Set(['page_viewed', 'trial_click']);
// Account creation is server-owned; older clients must not duplicate it.
const AUTHENTICATED_FUNNEL_EVENTS = new Set(['quote_started', 'quote_saved', 'save_prompt_shown', 'quote_downloaded', 'checkout_started', 'signup_screen_viewed', 'signup_attempted', 'signup_failed']);

const SIGNUP_EVENTS = new Set(['signup_screen_viewed', 'signup_attempted', 'signup_failed']);
const signupWindows = new Map();
router.post('/signup', async (req, res) => {
  // Direct signup has no account/guest token. Keep this narrow endpoint separate
  // from authenticated product events and never trust a supplied account id.
  let origin = req.get('origin');
  if (!origin) { try { origin = new URL(req.get('referer')).origin; } catch (_) {} }
  if (origin !== 'https://profitquote.co.uk') return res.status(403).json({error:'Same-origin signup event required'});
  if (!SIGNUP_EVENTS.has(req.body?.event_type)) return res.status(400).json({error:'unsupported signup event_type'});
  if (req.get('dnt') === '1' || req.get('sec-gpc') === '1') return res.json({success:true,ignored:true});
  const now = Date.now();
  for (const [key, value] of signupWindows) if (value.until <= now) signupWindows.delete(key);
  const key = require('node:crypto').createHmac('sha256', process.env.JWT_SECRET).update(req.ip || 'unknown').digest('hex');
  const entry = signupWindows.get(key) || {until:now+60000,count:0};
  if ((!signupWindows.has(key) && signupWindows.size >= 10000) || entry.count >= 30) return res.status(429).json({error:'Too many signup events'});
  entry.count++; signupWindows.set(key, entry);
  try {
    await req.app.locals.pool.query('INSERT INTO events (event_type, user_id, source) VALUES ($1,$2,$3)',
      [req.body.event_type, null, 'signup_ui']);
    res.set('Cache-Control','private, no-store').json({success:true});
    void sendToGA(req.body.event_type, null, 'signup_ui', requestContext(req));
  } catch (_) { res.status(500).json({error:'Unable to record signup event'}); }
});


router.post('/', async (req, res) => {
  const { event_type, user_id, source } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type required' });
  if (!PUBLIC_EVENT_TYPES.has(event_type)) return res.status(400).json({ error: 'unsupported public event_type' });
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      'INSERT INTO events (event_type, user_id, source) VALUES ($1,$2,$3)',
      [event_type, null, typeof source === 'string' ? source.slice(0, 50) : null]
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
  // Cached older clients may still send this; server checkout receipts now own it.
  if(event_type==='checkout_started') return res.json({success:true,ignored:true});
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
