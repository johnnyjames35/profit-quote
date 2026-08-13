const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { getDailyTrafficReport, clearTokenCache, validateDate } = require('../utils/google-reporting');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: 'service_account', client_email: 'reporter@example.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
  GA4_PROPERTY_ID: '532416392', SEARCH_CONSOLE_SITE_URL: 'https://profitquote.co.uk/'
};

test('rejects invalid dates before making a request', () => assert.throws(() => validateDate('2026-02-30'), /real calendar date/));

test('returns normalized GA4 and Search Console metrics', async () => {
  clearTokenCache();
  const responses = [
    { access_token: 'test-token', expires_in: 3600 },
    { rows: [{ metricValues: [{ value: '12' }, { value: '18' }] }] },
    { rows: [{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '9' }, { value: '7' }] }] },
    { rows: [{ dimensionValues: [{ value: '/' }], metricValues: [{ value: '8' }, { value: '6' }] }] },
    { rows: [{ clicks: 5, impressions: 100, ctr: 0.05, position: 4.2 }] },
    { rows: [{ keys: ['builder quote'], clicks: 3, impressions: 40, ctr: 0.075, position: 3.1 }] },
    { rows: [{ keys: ['https://profitquote.co.uk/'], clicks: 4, impressions: 70, ctr: 0.057, position: 3.8 }] }
  ];
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => responses.shift() }; };
  const result = await getDailyTrafficReport({ date: '2026-08-12', env, fetchImpl });
  assert.equal(result.ga4.users, 12); assert.equal(result.ga4.sessions, 18);
  assert.equal(result.ga4.trafficSources[0].source, 'Organic Search'); assert.equal(result.searchConsole.clicks, 5);
  assert.equal(result.searchConsole.topQueries[0].query, 'builder quote'); assert.equal(calls.length, 7);
  assert.match(calls[4].url, /searchconsole\.googleapis\.com/);
});

test('never includes credentials in upstream error messages', async () => {
  clearTokenCache();
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: privateKey } }) });
  await assert.rejects(getDailyTrafficReport({ date: '2026-08-12', env, fetchImpl }), /^Error: Google authentication failed \(403\)$/);
});
