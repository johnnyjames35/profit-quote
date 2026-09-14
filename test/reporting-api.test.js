const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');

test('events persist in PostgreSQL and admin funnel retrieves them with auth and periods', async (t) => {
  process.env.JWT_SECRET = 'test-only-user-secret';
  process.env.ADMIN_SECRET = 'test-only-admin-secret';
  delete process.env.GA_API_SECRET;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  const app = express();
  app.use(express.json());
  app.locals.pool = db;
  app.use('/api/events', require('../routes/events'));
  app.use('/api/admin', require('../routes/admin'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = jwt.sign({ admin: true }, process.env.ADMIN_SECRET);
  const request = (url, options = {}) => fetch(base + url, options);
  const post = (url, body, token) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await request('/api/admin/funnel')).status, 401);
  for (const event_type of ['page_viewed', 'trial_click']) {
    const response = await post('/api/events', { event_type, source: 'google' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
  }
  assert.equal((await post('/api/events', { event_type: 'quote_started' })).status, 400);
  assert.equal((await post('/api/events/funnel', { event_type: 'quote_started' })).status, 401);
  const guestId = '00000000-0000-4000-8000-000000000001';
  await db.query('INSERT INTO guest_sessions(id,browser_hash,ip_hash) VALUES($1,$2,$3)', [guestId, 'browser', 'ip']);
  const guest = jwt.sign({ id: guestId, guest: true }, process.env.JWT_SECRET);
  for (const event_type of ['quote_started', 'quote_sent', 'quote_downloaded']) {
    assert.equal((await post('/api/events/funnel', { event_type, user_id: 999 }, guest)).status, 200);
  }
  const stored = await db.query("SELECT user_id, meta FROM events WHERE event_type='quote_started'");
  assert.equal(stored.rows[0].user_id, null);
  assert.equal(stored.rows[0].meta.guest_id, guestId);
  await db.exec("INSERT INTO events(event_type,created_at) VALUES('page_viewed', NOW() - INTERVAL '40 days')");
  const response = await request('/api/admin/funnel?period=today', { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const data = await response.json();
  for (const key of ['totalVisitors', 'googleVisitors', 'trialClicks', 'guestStarts', 'quoteStarts', 'quoteSends', 'quoteDownloads']) assert.equal(data[key], 1, key);
  const all = await (await request('/api/admin/funnel?period=all', { headers: { Authorization: `Bearer ${admin}` } })).json();
  assert.equal(all.totalVisitors, 2);
  const daily = await request('/api/admin/reporting/daily', { headers: { Authorization: `Bearer ${admin}` } });
  // Missing Google credentials must remain a JSON failure, never fabricated zeros.
  assert.equal(daily.status, 502);
  assert.match(daily.headers.get('content-type'), /application\/json/);
  assert.equal((await daily.json()).error, 'Unable to retrieve Google reporting data');
  const { privateKey } = require('node:crypto').generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: 'service_account', client_email: 'test@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  process.env.GA4_PROPERTY_ID = '123';
  process.env.SEARCH_CONSOLE_SITE_URL = 'https://example.invalid/';
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });
  global.fetch = async (url, options) => {
    if (url.startsWith(base)) return realFetch(url, options);
    assert.ok(options.signal, 'upstream requests have a timeout');
    if (url.includes('oauth2')) return Response.json({ access_token: 'test-only', expires_in: 3600 });
    if (url.includes('analyticsdata')) return Response.json({ rows: [{ metricValues: [{ value: '17' }, { value: '23' }], dimensionValues: [{ value: '/' }] }] });
    return Response.json({ rows: [{ keys: ['query', '/'], clicks: 4, impressions: 30, ctr: 4 / 30, position: 12 }] });
  };
  const report = await request('/api/admin/reporting/daily', { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(report.status, 200);
  assert.match(report.headers.get('content-type'), /application\/json/);
  const body = await report.json();
  assert.equal(body.ga4.users, 17);
  assert.equal(body.searchConsole.clicks, 4);
  assert.equal(body.appFunnel.quoteStarts, 0); // Yesterday, while test events are today.
  assert.ok(body.comparisons.sevenDay);
});
