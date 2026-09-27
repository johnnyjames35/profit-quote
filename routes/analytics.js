const router = require('express').Router();
const auth = require('../middleware/auth');
const { config } = require('../utils/posthog');

router.get('/config', (req, res) => res.set('Cache-Control', 'no-store').json(config()));
router.post('/consent', auth, async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
  if (req.user.guest) return res.json({ success: true });
  try {
    await req.app.locals.pool.query(`INSERT INTO posthog_consent(user_id,enabled) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,
      enabled_since=CASE WHEN NOT posthog_consent.enabled AND EXCLUDED.enabled THEN NOW() ELSE posthog_consent.enabled_since END`,
    [req.user.id, req.body.enabled]);
    res.set('Cache-Control', 'no-store').json({ success: true });
  } catch (_) { res.status(503).json({ error: 'Analytics preference could not be saved' }); }
});
module.exports = router;
