const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public/admin.html'), 'utf8');
const reporting = html.slice(html.indexOf('async function readAdminJson'), html.indexOf('function renderReporting'));

for (const failure of ['html', 'network']) test(`daily report survives optional live ${failure} failure`, async () => {
  const elements = {};
  let rendered;
  const ctx = vm.createContext({ API: '', adminToken: 'test', window: {}, document: { getElementById: id => elements[id] ||= { style: {} } },
    fetch: async url => {
      if (url.endsWith('/live')) {
        if (failure === 'network') throw new Error('network down');
        return new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html' } });
      }
      return Response.json({ ga4: { users: 17 } });
    }, renderReporting: (data, live) => { rendered = { data, live }; } });
  vm.runInContext(reporting, ctx);
  await vm.runInContext('loadReporting()', ctx);
  assert.equal(rendered.data.ga4.users, 17);
  assert.match(rendered.live.error, /temporarily unavailable/);
  assert.equal(elements['report-content'].style.display, 'block');
});

test('non-JSON response reports HTTP status instead of a parser crash', async () => {
  const ctx = vm.createContext({ response: new Response('<!DOCTYPE html>', { status: 524, headers: { 'content-type': 'text/html' } }) });
  vm.runInContext(reporting, ctx);
  await assert.rejects(vm.runInContext('readAdminJson(response)', ctx), /non-JSON response \(HTTP 524\)/);
});

test('rejected beacon falls back to a keepalive event request', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');
  const source = home.slice(home.indexOf('  function record(eventType)'), home.indexOf("  if (!sessionStorage.getItem('pq_homepage_visit_recorded')"));
  let sent;
  vm.runInNewContext(source + "record('trial_click');", { source: () => 'google', navigator: { sendBeacon: () => false }, Blob,
    fetch: (url, options) => { sent = { url, options }; return Promise.resolve(); } });
  assert.equal(sent.url, '/api/events');
  assert.equal(sent.options.keepalive, true);
  assert.equal(JSON.parse(sent.options.body).event_type, 'trial_click');
});
