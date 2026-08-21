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
  assert.equal(result.businesses[0].ga4.sessions, 3);
  assert.equal(result.businesses[0].searchConsole.impressions, 10);
  assert.equal('topQueries' in result.businesses[0].searchConsole, false);
});
