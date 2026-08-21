const test = require('node:test');
const assert = require('node:assert/strict');
const { getPortfolioDailyTrafficReport } = require('../utils/portfolio-reporting');

test('portfolio report requests and returns four isolated aggregate sources', async () => {
  const calls = [];
  const reportGetter = async (options) => {
    calls.push(options);
    return {
      ga4: { date: options.date, provisional: true, users: 2, sessions: 3 },
      searchConsole: { date: options.searchConsoleDate, clicks: 1, impressions: 10, ctr: 0.1, averagePosition: 5 }
    };
  };
  const result = await getPortfolioDailyTrafficReport({ date: '2026-08-20', reportGetter });
  assert.deepEqual(calls.map((call) => call.hostname), ['profitquote.co.uk', 'callbackapp.co.uk', 'latepay.co.uk', 'zenflo.co.uk']);
  assert.deepEqual(calls.map((call) => call.siteUrl), ['https://profitquote.co.uk/', 'sc-domain:callbackapp.co.uk', 'sc-domain:latepay.co.uk', 'https://zenflo.co.uk/']);
  assert.ok(calls.every((call) => call.includeComparisons === false));
  assert.equal(result.businesses.length, 4);
  assert.ok(result.businesses.every((business) => business.status === 'OK'));
  assert.equal(result.businesses[0].ga4.sessions, 3);
  assert.equal(result.businesses[0].searchConsole.impressions, 10);
  assert.equal('topQueries' in result.businesses[0].searchConsole, false);
});

test('one business failure does not erase the other three reports', async () => {
  const reportGetter = async (options) => {
    if (options.hostname === 'callbackapp.co.uk') throw new Error('upstream unavailable');
    return {
      ga4: { date: options.date, provisional: true, users: 2, sessions: 3 },
      searchConsole: { date: options.searchConsoleDate, clicks: 1, impressions: 10, ctr: 0.1, averagePosition: 5 }
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
    error: 'Unable to retrieve Google reporting data'
  });
});

test('invalid dates still fail the whole request as input errors', async () => {
  await assert.rejects(
    getPortfolioDailyTrafficReport({ date: 'not-a-date', reportGetter: async () => ({}) }),
    /date must use YYYY-MM-DD/
  );
});
