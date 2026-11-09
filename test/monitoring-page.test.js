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
  assert.match(html, /Recent GA4 and Search Console figures can be incomplete/);
  assert.doesNotMatch(html, /credential|client_email|private_key|topQueries|landingPages/);
});

test('monitoring page escapes untrusted values', () => {
  const html = renderPortfolioMonitoringPage({ date: '<script>', generatedAt: 'now', businesses: [] });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('browser monitoring defaults the date and validates an explicitly supplied date', async t => {
  const express = require('express');
  const portfolio = require('../utils/portfolio-reporting');
  const { validateDate } = require('../utils/google-reporting');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-21T23:30:00Z') });
  const report = t.mock.method(portfolio, 'getPortfolioDailyTrafficReport', async ({ date }) => ({
    date: validateDate(date), generatedAt: 'now', businesses: []
  }));
  const app = express();
  app.use('/monitoring', require('../routes/monitoring'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/monitoring/portfolio-daily`;

  const defaultReport = await fetch(url);
  assert.equal(defaultReport.status, 200);
  assert.equal(report.mock.calls[0].arguments[0].date, '2026-08-19');
  assert.equal(defaultReport.headers.get('x-robots-tag'), 'noindex, nofollow');
  const datedReport = await fetch(url + '?date=2026-08-20');
  assert.equal(datedReport.status, 200);
  assert.match(await datedReport.text(), /Report date: 2026-08-20/);
  assert.equal((await fetch(url + '?date=2026-02-30')).status, 400);
});
