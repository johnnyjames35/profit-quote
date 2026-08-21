const router = require('express').Router();
const { getPortfolioDailyTrafficReport } = require('../utils/portfolio-reporting');
const { renderPortfolioMonitoringPage } = require('../utils/monitoring-page');

router.get('/portfolio-daily', async (req, res) => {
  try {
    const report = await getPortfolioDailyTrafficReport({ date: req.query.date });
    res.set('Cache-Control', 'public, max-age=900, stale-while-revalidate=300');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').send(renderPortfolioMonitoringPage(report));
  } catch (error) {
    const isInputError = error.message.startsWith('date must');
    console.error('Portfolio monitoring page error:', error.message);
    res.status(isInputError ? 400 : 502).type('text').send(isInputError ? error.message : 'Unable to retrieve Google reporting data');
  }
});

module.exports = router;
