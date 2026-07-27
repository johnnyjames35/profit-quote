const router = require('express').Router();

// Very simple email format check — good enough to catch typos/junk without being annoying
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/template', async (req, res) => {
  const { email, source } = req.body;
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      'INSERT INTO template_downloads (email, source) VALUES ($1,$2)',
      [email, source || null]
    );
    res.json({ success: true, downloadUrl: '/builder-quote-template.pdf' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
