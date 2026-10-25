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

test('rejected beacon falls back to a keepalive event request with browser attribution', async () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8').replace(/\r\n/g,'\n');
  const source = home.slice(home.indexOf('  async function record(eventType)'), home.indexOf("\n  try {\n    if (!sessionStorage.getItem('pq_homepage_visit_recorded')"));
  let sent;
  await vm.runInNewContext(source + "record('trial_click');", { window:{pqGAContext:async()=>({client_id:'123.456',session_id:'1792000000',page_location:'https://profitquote.co.uk/'})}, source: () => 'google', navigator: { sendBeacon: () => false }, Blob,
    fetch: (url, options) => { sent = { url, options }; return Promise.resolve(); } });
  assert.equal(sent.url, '/api/events');
  assert.equal(sent.options.keepalive, true);
  assert.equal(JSON.parse(sent.options.body).event_type, 'trial_click');
  assert.equal(JSON.parse(sent.options.body).analytics.client_id, '123.456');
});

for (const landing of ['homepage','commercial']) test(landing+' queues trial attribution before navigation and still navigates on tracking failure',async()=>{
  const source=landing==='homepage'
    ? '(function () {'+fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8').replace(/\r\n/g,'\n').split('<script>\n(function () {')[1].split('</script>')[0]
    : fs.readFileSync(path.join(__dirname,'../public/commercial-pages.js'),'utf8');
  for(const failing of [false,true]){
    let click,resolveIdentity;const actions=[];
    const context={window:{pqGAContext:()=>new Promise(resolve=>resolveIdentity=resolve)},location:{search:'',assign:url=>actions.push('navigate')},URLSearchParams,Blob,
      document:{body:{dataset:{landingPage:'builders'}},referrer:'',querySelectorAll:()=>[{href:'https://profitquote.co.uk/dashboard?try=1',addEventListener:(name,fn)=>click=fn}]},
      sessionStorage:{getItem:()=>true},navigator:{sendBeacon:()=>{actions.push('queued');if(failing)throw Error('blocked');return true;}},fetch:()=>Promise.resolve()};
    vm.runInNewContext(source,context);
    const pending=click({button:0,preventDefault:()=>actions.push('prevented')});
    assert.deepEqual(actions,['prevented']);
    resolveIdentity({client_id:'123.456',session_id:'1792000000'});
    await pending.catch(()=>{});
    assert.deepEqual(actions,['prevented','queued','navigate']);
  }
});
