const test = require('node:test');
const assert = require('node:assert/strict');
const { getPortfolioDailyTrafficReport } = require('../utils/portfolio-reporting');

test('portfolio report requests and returns four isolated aggregate sources', async () => {
  const calls = [];
  const reportGetter = async (options) => {
    calls.push(options);
    return {
      ga4: { status: 'OK', date: options.date, provisional: true, users: 2, sessions: 3 },
      searchConsole: { status: 'OK', date: options.date, clicks: 1, impressions: 10, ctr: 0.1, averagePosition: 5 }
    };
  };
  const result = await getPortfolioDailyTrafficReport({ date: '2026-08-20', reportGetter });
  assert.deepEqual(calls.map((call) => call.hostname), ['profitquote.co.uk', 'callbackapp.co.uk', 'latepay.co.uk', 'zenflo.co.uk']);
  assert.deepEqual(calls.map((call) => call.siteUrl), ['https://profitquote.co.uk/', 'sc-domain:callbackapp.co.uk', 'sc-domain:latepay.co.uk', 'https://zenflo.co.uk/']);
  assert.equal(result.businesses.length, 4);
  assert.ok(result.businesses.every((business) => business.status === 'OK'));
  assert.equal(result.businesses[0].ga4.sessions, 3);
  assert.equal(result.businesses[0].searchConsole.impressions, 10);
  assert.equal('topQueries' in result.businesses[0].searchConsole, false);
});

test('one business authentication failure does not erase the other three reports', async () => {
  const reportGetter = async (options) => {
    if (options.hostname === 'callbackapp.co.uk') throw new Error('upstream unavailable');
    return {
      ga4: { status: 'OK', date: options.date, provisional: true, users: 2, sessions: 3 },
      searchConsole: { status: 'OK', date: options.date, clicks: 1, impressions: 10, ctr: 0.1, averagePosition: 5 }
    };
  };
  const result = await getPortfolioDailyTrafficReport({ date: '2026-08-20', reportGetter });
  const failed = result.businesses.find((business) => business.business === 'CallbackApp');
  const successful = result.businesses.filter((business) => business.status === 'OK');
  assert.equal(result.businesses.length, 4);
  assert.equal(successful.length, 3);
  assert.deepEqual(failed, {
    business: 'CallbackApp',
    hostname: 'callbackapp.co.uk',
    status: 'MONITORING_UNRESOLVED',
    ga4: { status: 'MONITORING_UNRESOLVED', date: '2026-08-20', error: 'Unable to retrieve GA4 data' },
    searchConsole: { status: 'MONITORING_UNRESOLVED', date: '2026-08-20', error: 'Unable to retrieve Search Console data' }
  });
});

test('a Search Console failure preserves valid GA4 metrics for that business', async () => {
  const reportGetter = async (options) => ({
    ga4: { status: 'OK', date: options.date, provisional: true, users: 4, sessions: 7 },
    searchConsole: { status: 'MONITORING_UNRESOLVED', date: options.date, error: 'Unable to retrieve Search Console data' }
  });
  const result = await getPortfolioDailyTrafficReport({ date: '2026-08-20', reportGetter });
  assert.ok(result.businesses.every((business) => business.status === 'PARTIAL'));
  assert.ok(result.businesses.every((business) => business.ga4.sessions === 7));
});

test('a GA4 failure preserves valid Search Console metrics for that business', async () => {
  const reportGetter = async (options) => ({
    ga4: { status: 'MONITORING_UNRESOLVED', date: options.date, error: 'Unable to retrieve GA4 data' },
    searchConsole: { status: 'OK', date: options.date, clicks: 2, impressions: 20, ctr: 0.1, averagePosition: 4 }
  });
  const result = await getPortfolioDailyTrafficReport({ date: '2026-08-20', reportGetter });
  assert.ok(result.businesses.every((business) => business.status === 'PARTIAL'));
  assert.ok(result.businesses.every((business) => business.searchConsole.impressions === 20));
});

test('invalid dates still fail the whole request as input errors', async () => {
  await assert.rejects(
    getPortfolioDailyTrafficReport({ date: 'not-a-date', reportGetter: async () => ({}) }),
    /date must use YYYY-MM-DD/
  );
});
