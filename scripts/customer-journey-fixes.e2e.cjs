// Disposable database, mocked Google/Brevo, and local routing for the production origin.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const express=require('express'),{PGlite}=require('@electric-sql/pglite'),{chromium}=require('playwright');
const https=require('node:https'),{EventEmitter}=require('node:events');
(async()=>{
 process.env.JWT_SECRET='journey-fixes-only';process.env.GA_MEASUREMENT_ID='G-test';process.env.GA_API_SECRET='test';
 const originalFetch=global.fetch,originalRequest=https.request,events=[];
 global.fetch=(url,options)=>{
   if(String(url).startsWith('https://www.google-analytics.com/')){events.push(JSON.parse(options.body));return Promise.resolve(new Response(null,{status:204}));}
   return originalFetch(url,options);
 };
 https.request=(options,callback)=>{const req=new EventEmitter();req.write=()=>{};req.end=()=>{const res=new EventEmitter();res.statusCode=201;callback(res);queueMicrotask(()=>res.emit('end'));};return req;};
 const db=new PGlite();await db.exec(fs.readFileSync('schema.sql','utf8'));
 let queue=Promise.resolve();const pool={query:db.query.bind(db),connect:async()=>{const before=queue;let release;queue=new Promise(r=>release=r);await before;return {query:db.query.bind(db),release};}};
 const app=express();app.locals.pool=pool;app.use(express.json());
 for(const name of ['auth','guest','quotes','events'])app.use('/api/'+name,require('../routes/'+name));
 app.use(express.static(path.join(__dirname,'../public')));app.get('/dashboard',(req,res)=>res.sendFile(path.join(__dirname,'../public/dashboard.html')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port,origin='https://profitquote.co.uk';let browser;
 try{
   browser=await chromium.launch({headless:true,...(process.env.PQ_BROWSER_PATH?{executablePath:process.env.PQ_BROWSER_PATH}:{})});
   const context=await browser.newContext();
   await context.route('**/*',async route=>{
     const url=new URL(route.request().url());
     if(url.origin===origin){const response=await route.fetch({url:base+url.pathname+url.search});return route.fulfill({response});}
     if(url.hostname==='www.googletagmanager.com')return route.fulfill({contentType:'application/javascript',body:`const receive=args=>{if(args[0]==='get') args[3](args[2]==='client_id'?'123.456':1792000000);};(window.dataLayer||[]).forEach(receive);window.gtag=(...args)=>receive(args);`});
     return route.abort();
   });
   const page=await context.newPage();
   await page.goto(origin+'/');
   await page.getByRole('link',{name:'TRY PROFITQUOTE FREE',exact:true}).click();
   await page.locator('#sec-builder').waitFor({state:'visible'});
   await page.locator('#q-customer').fill('Draft customer');
   const draft=await page.evaluate(()=>localStorage.getItem('pq_builder_draft_v1'));
   await page.goto(origin+'/dashboard?login=1');
   await page.locator('#login-screen').waitFor({state:'visible'});
   assert.equal(await page.locator('#subscription-dialog').isVisible(),false);
   assert.equal(await page.evaluate(()=>localStorage.getItem('pq_builder_draft_v1')),draft);
   // The same link remains usable when the stored token has expired.
   await page.evaluate(()=>localStorage.setItem('pq_token','expired-token'));
   await page.reload();await page.locator('#login-screen').waitFor({state:'visible'});
   await page.getByRole('button',{name:'Use free for 7 days — no signup'}).click();
   await page.locator('#sec-builder').waitFor({state:'visible'});
   await page.locator('#nav-quotes').click();await page.getByRole('button',{name:'Create free account →'}).click();
   await page.locator('#reg-name').fill('Local Test');await page.locator('#reg-email').fill('local@example.invalid');await page.locator('#reg-password').fill('local-test-password');
   await page.locator('#reg-btn').click();await page.locator('#app-screen').waitFor({state:'visible'});
   await page.goto(origin+'/dashboard?login=1');await page.locator('#login-screen').waitFor({state:'visible'});
   await page.locator('#login-email').fill('local@example.invalid');await page.locator('#login-password').fill('local-test-password');await page.locator('#login-btn').click();
   await page.locator('#app-screen').waitFor({state:'visible'});
   await page.locator('#nav-builder').click();await page.locator('#q-job-type').selectOption('bathroom');
   await page.locator('#q-customer').fill('Test Customer');await page.locator('#step-1 .btn-next').click();await page.locator('#step-2').waitFor({state:'visible'});
   // Wait for asynchronous telemetry only; no production requests occur.
   await new Promise(r=>setTimeout(r,100));
   for(const event of ['trial_click','account_created','first_login','quote_started']){
     const hit=events.find(x=>x.events[0].name===event);assert.ok(hit,event+' reached mocked GA');
     assert.equal(hit.client_id,'123.456');assert.equal(hit.events[0].params.session_id,1792000000);assert.match(hit.events[0].params.page_location,/^https:\/\/profitquote.co.uk\//);
   }
   console.log('PASS: cached Guest/expired/registered-token sign-in, preserved draft, real signup/login and attributed trial/account/quote events');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));await db.close();global.fetch=originalFetch;https.request=originalRequest;}
})().catch(error=>{console.error(error);process.exitCode=1;});
