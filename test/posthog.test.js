const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');
const { flushPaidConversions } = require('../utils/posthog');

function browser({ consent = 'yes', dnt = false, enabled = true, path = '/dashboard' } = {}) {
  const events = [], scripts = [], requests = [], elements = {}, listeners = {};
  const storage = new Map(consent ? [['pq_posthog_consent', consent]] : []);
  let config, id = 'anonymous-uuid';
  const instance = {
    capture(name) { const event = config.before_send({ event: name, properties: { distinct_id: id } }); if (event) events.push(event); },
    identify(value) { id = value; }, get_distinct_id: () => id, reset() { id = 'new-anonymous'; },
    stopSessionRecording() {}, opt_out_capturing() {}, opt_in_capturing() {}
  };
  const element = () => ({ style: {}, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => ({ textContent: '' }) });
  const window = { addEventListener: (name, fn) => { listeners[name] = fn; }, posthog: { init(token, options) { config = options; options.loaded(instance); } } };
  const document = { addEventListener: (name, fn) => { listeners[name] = fn; },
    createElement: element, getElementById: id => elements[id],
    head: { appendChild: script => scripts.push(script) }, body: { appendChild: el => { elements[el.id] = el; } } };
  const ctx = { window, document, location: { pathname: path, origin: 'https://profitquote.co.uk', href: 'https://profitquote.co.uk' + path + '?token=secret#email' },
    navigator: { doNotTrack: dnt ? '1' : '0' }, URL,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ enabled, token: 'test', apiHost: 'https://eu.i.posthog.com' }) }; } };
  vm.runInNewContext(fs.readFileSync('public/product-analytics.js', 'utf8'), ctx);
  return { window, listeners, scripts, events, requests, instance, storage, get config() { return config; },
    async ready() { listeners.DOMContentLoaded?.(); await new Promise(r => setImmediate(r)); scripts[0]?.onload(); } };
}

test('PostHog never loads without opt-in, under DNT, while disabled, or on admin pages', async () => {
  for (const options of [{ consent: null }, { consent: 'no' }, { dnt: true }, { enabled: false }, { path: '/admin' }]) {
    const b = browser(options); await b.ready();
    assert.equal(b.scripts.length, 0); assert.equal(b.events.length, 0);
  }
});

test('browser maps successes once and strips customer/query/referrer/person data', async () => {
  const b = browser();
  b.window.pqAnalytics.capture('quote_started');
  b.window.pqAnalytics.account({ id: 42, email: 'private@example.invalid' }, 'test-auth');
  b.window.pqAnalytics.capture('account_created');
  await b.ready();
  b.window.pqAnalytics.quoteResult({ analytics_event: 'quote_completed', customer_name: 'Private', total: 9999 });
  b.window.pqAnalytics.quoteResult({ id: 1 }); // idempotent save / edit response
  b.window.pqAnalytics.quoteResult({ analytics_event: 'anonymous_quote_completed' });
  b.window.pqAnalytics.quoteResult({ analytics_event: 'quote_saved' }); // guest quote carried into account
  assert.deepEqual(b.events.map(e => e.event), ['quote_started','account_created','page_viewed','quote_completed','quote_saved','anonymous_quote_completed','quote_saved']);
  assert.equal(b.events[0].properties.distinct_id, 'anonymous-uuid');
  assert.equal(b.events[1].properties.distinct_id, 'pq-user-42');
  const clean = b.config.before_send({ event: 'signup_failed', properties: { token: 'project-public-token', email: 'private', $referrer: 'secret', $set: { email: 'secret' }, $current_url: 'secret', $session_id: 'session' } });
  assert.equal(clean.properties.token, 'project-public-token');
  assert.equal(clean.properties.$current_url, 'https://profitquote.co.uk/dashboard');
  assert.equal(clean.properties.$session_id, 'session');
  assert.doesNotMatch(JSON.stringify(clean), /secret|private|email|referrer/);
  assert.equal(b.config.autocapture, false);
  assert.equal(b.config.capture_pageview, false);
  assert.equal(b.config.session_recording.maskTextSelector, '*');
  assert.equal(b.config.session_recording.maskAllInputs, true);
  assert.equal(b.config.capture_performance, false);
  assert.equal(b.config.enable_recording_console_log, false);
  assert.equal(b.config.session_recording.maskCapturedNetworkRequestFn({ name: 'https://profitquote.co.uk/dashboard?token=secret#hash' }).name, 'https://profitquote.co.uk/dashboard');
});

test('SDK failure, withdrawal, logout and account switching do not break actions or leak identity', async () => {
  const b = browser(); await b.ready();
  b.window.pqAnalytics.account({ id: 1 }, 'token');
  b.window.pqAnalytics.account({ id: 2 }, 'token');
  b.window.pqAnalytics.capture('trial_click');
  assert.equal(b.events.at(-1).properties.distinct_id, 'pq-user-2');
  b.window.pqAnalytics.logout(); b.window.pqAnalytics.capture('trial_click');
  assert.equal(b.events.at(-1).properties.distinct_id, 'new-anonymous');
  b.instance.capture = () => { throw Error('blocked'); };
  assert.doesNotThrow(() => b.window.pqAnalytics.capture('quote_started'));
  b.listeners.storage({ key: 'pq_posthog_consent', newValue: 'no' });
  assert.equal(b.config.before_send({ event: '$snapshot', properties: {} }), null);
});

test('paid conversion uses committed first payment, excludes old/manual/unconsented events and retries with stable UUID', async t => {
  process.env.POSTHOG_ENABLED = 'true'; t.after(() => { delete process.env.POSTHOG_ENABLED; });
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(fs.readFileSync('schema.sql','utf8'));
  for (let id = 1; id <= 4; id++) await db.query("INSERT INTO users(id,name,email,password_hash) VALUES($1,'Private',$2,'hash')", [id, id+'@example.invalid']);
  await db.exec("INSERT INTO posthog_consent(user_id,enabled,enabled_since) VALUES(1,true,'2026-01-01'),(2,false,'2026-01-01'),(3,true,'2026-01-01'),(4,true,'2026-02-01')");
  await db.exec("INSERT INTO events(event_type,user_id,source,meta,created_at) VALUES('payg_purchased',1,'stripe_webhook','{\"plan\":\"payg\",\"email\":\"private\"}','2026-01-02'),('subscription_started',1,'stripe_webhook','{}','2026-01-03'),('subscription_started',2,'stripe_webhook','{}','2026-01-02'),('subscription_started',3,null,'{}','2026-01-02'),('subscription_started',4,'stripe_webhook','{}','2026-01-02')");
  const calls = [];
  const send = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true }; };
  await assert.rejects(flushPaidConversions(db, async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); throw Error('network'); }));
  assert.equal((await db.query('SELECT * FROM posthog_paid_deliveries')).rows.length, 0);
  await flushPaidConversions(db, send); await flushPaidConversions(db, send);
  assert.equal(calls.length, 2); assert.equal(calls[0].body.uuid, calls[1].body.uuid);
  assert.equal(calls[1].url, 'https://eu.i.posthog.com/capture/');
  assert.equal(calls[1].body.properties.distinct_id, 'pq-user-1');
  assert.equal(calls[1].body.event, 'paid_conversion');
  assert.doesNotMatch(JSON.stringify(calls[1]), /private|example.invalid|customer|amount/);
  await db.exec('BEGIN');
  await db.exec("UPDATE posthog_consent SET enabled=true WHERE user_id=2; INSERT INTO events(event_type,user_id,source) VALUES('payg_purchased',2,'stripe_webhook')");
  await db.exec('ROLLBACK');
  await flushPaidConversions(db, send); assert.equal(calls.length, 2);
});

test('account consent is authenticated and revocation stops payment delivery', async t => {
  process.env.JWT_SECRET = 'posthog-test';
  const db = new PGlite(); await db.exec(fs.readFileSync('schema.sql','utf8'));
  await db.exec("INSERT INTO users(id,name,email,password_hash) VALUES(1,'Test','test@example.invalid','hash')");
  const app = express(); app.use(express.json()); app.locals.pool = db; app.use('/api/analytics', require('../routes/analytics'));
  const server = app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r));
  t.after(async () => { await new Promise(r => server.close(r)); await db.close(); });
  const url = 'http://127.0.0.1:' + server.address().port + '/api/analytics/consent';
  const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
  const request = (body, credential = token) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + credential }, body: JSON.stringify(body) });
  assert.equal((await request({ enabled: true }, 'invalid')).status, 401);
  assert.equal((await request({ enabled: 'yes' })).status, 400);
  assert.equal((await request({ enabled: true, user_id: 2 })).status, 200);
  assert.equal((await db.query('SELECT * FROM posthog_consent')).rows[0].user_id, 1);
  assert.equal((await request({ enabled: false })).status, 200);
  assert.equal((await db.query('SELECT * FROM posthog_consent')).rows[0].enabled, false);
});
