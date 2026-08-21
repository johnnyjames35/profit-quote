const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPortfolioMonitoringPage } = require('../utils/monitoring-page');

test('monitoring page renders aggregate source health without private detail', () => {
  const html = renderPortfolioMonitoringPage({
    date: '2026-08-20', generatedAt: '2026-08-21T20:00:00Z', businesses: [{
      business: 'ProfitQuote', hostname: 'profitquote.co.uk', status: 'PARTIAL',
      ga4: { status: 'OK', date: '2026-08-20', users: 4, sessions: 7 },
      searchConsole: { status: 'MONITORING_UNRESOLVED', date: '2026-08-20', error: 'Unable to retrieve Search Console data' }
    }]
  });
  assert.match(html, /ProfitQuote — PARTIAL/);
  assert.match(html, /Sessions: 7/);
  assert.match(html, /Search Console — MONITORING_UNRESOLVED/);
  assert.match(html, /noindex,nofollow/);
  assert.doesNotMatch(html, /credential|client_email|private_key|topQueries|landingPages/);
});

test('monitoring page escapes untrusted values', () => {
  const html = renderPortfolioMonitoringPage({ date: '<script>', generatedAt: 'now', businesses: [] });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
