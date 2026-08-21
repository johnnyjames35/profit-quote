const router = require('express').Router();
const { getPortfolioDailyTrafficReport } = require('../utils/portfolio-reporting');

// Public, read-only and deliberately aggregate-only. This exposes no credentials,
// customer data, search queries, landing pages or account identifiers.
router.get('/portfolio-daily', async (req, res) => {
  try {
    const report = await getPortfolioDailyTrafficReport({ date: req.query.date });
    res.set('Cache-Control', 'public, max-age=900, stale-while-revalidate=300');
    res.json(report);
  } catch (error) {
    const isInputError = error.message.startsWith('date must');
    console.error('Portfolio reporting error:', error.message);
    res.status(isInputError ? 400 : 502).json({ error: isInputError ? error.message : 'Unable to retrieve Google reporting data' });
  }
});

module.exports = router;
