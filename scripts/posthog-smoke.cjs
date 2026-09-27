// Real browser + current PostHog SDK; all ingestion is intercepted, never sent.
// Run with CHROME_PATH set, or use Playwright's installed Chromium.
const { chromium } = require('playwright');
const express = require('express');
const assert = require('node:assert/strict');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
async function main() {
  const app = express();
  app.get('/api/analytics/config', (req,res) => res.json({enabled:true,token:'phc_test_never_ingest',apiHost:'https://eu.i.posthog.com'}));
  app.use(express.static(path.join(__dirname,'../public')));
  app.get('/fixture',(req,res)=>res.send('<!doctype html><html><head><script src="/product-analytics.js"></script></head><body><p>PRIVATE_CUSTOMER_NAME</p><input value="PRIVATE_EMAIL@example.invalid"><div id="step-6"><a href="/quote?secret=PRIVATE_TOKEN">PRIVATE_QUOTE_DESCRIPTION</a></div><button id="action">Next</button></body></html>'));
  const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try {
    const context = await browser.newContext(); const page = await context.newPage();
    const requests=[],payloads=[],errors=[]; const assetCache=new Map();
    page.on('pageerror',error=>errors.push(error.message));
    await context.route(/https:\/\/.*posthog\.com\//,async route=>{
      const req=route.request(),url=new URL(req.url()); requests.push(url.pathname);
      // Only public static JS may reach the network; project config and ingestion are mocked.
      if(url.hostname==='eu-assets.i.posthog.com'&&url.pathname.startsWith('/static/')&&url.pathname.endsWith('.js')){
        if(!assetCache.has(url.pathname))assetCache.set(url.pathname,await (await fetch(url.origin+url.pathname)).text());
        return route.fulfill({contentType:'application/javascript',body:assetCache.get(url.pathname)});
      }
      if(req.postData())payloads.push({path:url.pathname,body:req.postData()});
      if(url.pathname.endsWith('/config.js')) return route.fulfill({contentType:'application/javascript',body:'window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {}; window._POSTHOG_REMOTE_CONFIG.phc_test_never_ingest = {sessionRecording: {enabled: true, endpoint: "/s/"}};'});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({featureFlags:{},sessionRecording:{enabled:true,endpoint:'/s/',consoleLogRecordingEnabled:false},supportedCompression:[]})});
    });
    const base='http://127.0.0.1:'+server.address().port;
    await page.goto(base+'/fixture?token=PRIVATE_URL_TOKEN#PRIVATE_HASH');
    await page.getByRole('button',{name:'No thanks',exact:true}).click();
    assert.equal(requests.length,0,'no PostHog traffic before opt-in');
    await page.getByRole('button',{name:'Analytics choices',exact:true}).click();
    await page.getByRole('button',{name:'Allow',exact:true}).click();
    await page.waitForFunction(()=>window.posthog?.__loaded);
    await page.evaluate(()=>{
      window.filteredEvents = [];
      const filter = posthog.config.before_send;
      posthog.set_config({disable_compression:true,request_batching:false,opt_out_useragent_filter:true,
        before_send: event => { const clean=filter(event); if(clean)window.filteredEvents.push(clean); return clean; }});
      pqAnalytics.capture('trial_click');
      posthog.startSessionRecording(true);
    });
    await page.waitForTimeout(2500);
    await page.locator('#action').click();
    await page.waitForTimeout(12000);
    const state=await page.evaluate(()=>({recording:posthog.sessionRecordingStarted(),id:posthog.get_distinct_id(),version:posthog.version}));
    assert.equal(state.recording,true,'replay starts with SDK');
    assert.equal(errors.length,0,errors.join('\n')+'\n'+requests.join('\n'));
    assert.ok(payloads.length,'events captured');
    // Events may be form-urlencoded; with compression disabled they remain inspectable.
    const raw=payloads.map(p=>{try{return decodeURIComponent(p.body);}catch{return p.body;}}).join('\n');
    assert.doesNotMatch(raw,/PRIVATE_CUSTOMER_NAME|PRIVATE_EMAIL|PRIVATE_QUOTE_DESCRIPTION|PRIVATE_URL_TOKEN|PRIVATE_HASH|PRIVATE_TOKEN/);
    assert.ok(payloads.some(p=>p.path==='/s/'),'replay payload was inspected: '+JSON.stringify({requests,payloadPaths:payloads.map(p=>p.path)}));
    const filtered=await page.evaluate(()=>window.filteredEvents);
    assert.ok(filtered.some(e=>e.event==='trial_click'&&e.properties.token==='phc_test_never_ingest'),'valid ingestion token survives filtering');
    const snapshots=filtered.filter(e=>e.event==='$snapshot');
    assert.ok(snapshots.length);
    for(const event of snapshots) for(const record of event.properties.$snapshot_data || []) {
      if(typeof record.data==='string' && record.cv==='2024-10') record.data=JSON.parse(gunzipSync(Buffer.from(record.data,'latin1')).toString('utf8'));
    }
    assert.match(JSON.stringify(snapshots), /"textContent"/, 'inspect decoded DOM snapshots, not only compressed transport');
    assert.doesNotMatch(JSON.stringify(filtered),/PRIVATE_CUSTOMER_NAME|PRIVATE_EMAIL|PRIVATE_QUOTE_DESCRIPTION|PRIVATE_URL_TOKEN|PRIVATE_HASH|PRIVATE_TOKEN/);
    await page.getByRole('button',{name:'Analytics choices',exact:true}).click();
    await page.getByRole('button',{name:'No thanks',exact:true}).click();
    assert.equal(await page.evaluate(()=>posthog.has_opted_out_capturing()),true);
    console.log(JSON.stringify({state,requests:[...new Set(requests)],payloads:payloads.length,errors,privacy:'No fixture secrets in captured payloads; withdrawal verified'},null,2));
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
