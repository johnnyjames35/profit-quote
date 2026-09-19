// Real browser + real auth/quote routes + disposable PostgreSQL. No production data or email.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {chromium}=require('playwright');
const https=require('node:https');
const {EventEmitter}=require('node:events');

(async()=>{
  process.env.JWT_SECRET='trade-flow-test-only';
  delete process.env.GA_API_SECRET;
  // Signup mail is simulated locally, including owner notifications.
  const originalRequest=https.request;
  https.request=(options,callback)=>{const request=new EventEmitter();request.write=()=>{};request.end=()=>{const response=new EventEmitter();response.statusCode=201;callback(response);queueMicrotask(()=>response.emit('end'));};return request;};
  const db=new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));
  let queue=Promise.resolve();
  const pool={query:db.query.bind(db),connect:async()=>{const previous=queue;let release;queue=new Promise(r=>release=r);await previous;return {query:db.query.bind(db),release};}};
  const app=express();app.locals.pool=pool;app.use(express.json());
  for(const name of ['auth','guest','quotes','settings','events']) app.use('/api/'+name,require('../routes/'+name));
  app.use('/api/billing',require('../routes/billing').router);
  app.use(express.static(path.join(__dirname,'../public')));
  app.get('/dashboard',(req,res)=>res.sendFile(path.join(__dirname,'../public/dashboard.html')));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.PQ_BROWSER_PATH?{executablePath:process.env.PQ_BROWSER_PATH}:{})});
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    const signup=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Test Electrician',email:'electrician@example.invalid',password:'test-only-password',trade:'Electrician',browser_id:'trade-flow-test'})});
    assert.equal(signup.status,200);const account=await signup.json();
    await context.addInitScript(token=>localStorage.setItem('pq_token',token),account.token);
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/dashboard');await page.locator('#app-screen').waitFor({state:'visible'});
    const started=Date.now();
    await page.locator('#nav-builder').click();
    assert.equal(await page.locator('#q-job-type').inputValue(),'electrical');
    await page.getByRole('button',{name:'New wiring / rewiring',exact:true}).click();
    await page.getByRole('button',{name:'Testing and certification',exact:true}).click();
    await page.locator('#q-extra').fill('Full house rewire including first and second fix.');
    await page.locator('#q-customer').fill('Test Customer');
    await page.locator('#q-email').fill('customer@example.invalid');
    await page.locator('#q-postcode').fill('SA1 1AB');
    await page.locator('#step-1 .btn-next').click();
    assert.equal(await page.locator('#dimension-fields').isVisible(),false);
    assert.deepEqual(await page.locator('#q-job-scale option').allTextContents(),['Choose the job scope','Whole property','Several rooms','Single room','Extension/Annex','Other']);
    for(const scale of ['Single room','Other','Several rooms','Extension/Annex','Whole property']){
      await page.locator('#q-job-scale').selectOption(scale);
      assert.equal(await page.locator('#room-count-group').isVisible(),!['Single room','Other'].includes(scale));
    }
    await page.locator('#q-property-type').selectOption('House');
    await page.locator('#q-room-count').fill('8');
    await page.locator('#q-scope-details').fill('Occupied property; loft access available');
    await page.reload();await page.locator('#app-screen').waitFor({state:'visible'});await page.locator('#nav-builder').click();
    assert.equal(await page.locator('#q-job-scale').inputValue(),'Whole property');
    assert.equal(await page.locator('#q-property-type').inputValue(),'House');
    assert.equal(await page.locator('#q-room-count').inputValue(),'8');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.PQ_OUTPUT_DIR){fs.mkdirSync(process.env.PQ_OUTPUT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.PQ_OUTPUT_DIR,'electrician-scope-mobile.png')});}
    await page.locator('#step-2 .btn-next').click();
    await page.locator('#q-days').fill('6.5');await page.locator('#q-day-rate').fill('250');await page.locator('#q-overhead').fill('50');
    assert.match(await page.locator('#labour-nudge').innerText(),/full rewire.*8 rooms.*6.5 days/);
    await page.locator('#q-days').fill('12');assert.equal(await page.locator('#labour-nudge').isVisible(),false);
    await page.locator('#q-days').fill('6.5');
    await page.locator('#step-3 .btn-next').click();
    await page.locator('#q-materials').fill('2000');await page.locator('#q-markup').fill('20');
    await page.locator('#client-materials-yes').click();await page.locator('#q-client-materials').fill('Decorative light fittings');
    await page.locator('#skip-no').click();await page.locator('#scaffold-no').click();
    await page.locator('#step-4 .btn-next').click();
    assert.equal(await page.locator('#q-contingency').inputValue(),'10');assert.equal(await page.locator('#q-profit-target').inputValue(),'30');
    await page.locator('#q-profit-target').fill('25');
    assert.match(await page.locator('#profit-nudge').innerText(),/approximately £414 before VAT/);
    await page.locator('#q-contingency').fill('0');assert.match(await page.locator('#profit-nudge').innerText(),/approximately £376/);
    await page.locator('#q-contingency').fill('10');
    if(process.env.PQ_OUTPUT_DIR)await page.screenshot({path:path.join(process.env.PQ_OUTPUT_DIR,'profit-nudge-mobile.png')});
    const savedResponse=page.waitForResponse(r=>r.url()===base+'/api/quotes'&&r.request().method()==='POST');
    await page.locator('#step-5 .btn-next').click();assert.equal((await savedResponse).status(),200);
    await page.locator('#ai-output').waitFor({state:'visible'});
    const elapsed=Date.now()-started;assert.ok(elapsed<600000);
    const rows=await db.query('SELECT * FROM quotes');assert.equal(rows.rows.length,1);const quote=rows.rows[0];
    assert.equal(quote.trade,'Electrician');assert.equal(quote.quote_data.jobScope.roomCount,8);assert.equal(quote.quote_data.jobScope.propertyType,'House');
    assert.equal(quote.quote_data.clientSuppliedItems,'Decorative light fittings');assert.equal(quote.quote_data.contingency,10);assert.equal(quote.quote_data.lenM,0);
    assert.match(quote.job_description,/Whole property.*House.*approximately 8 rooms/);
    assert.equal(Number(quote.total),5794);assert.match(await page.locator('#ai-warning-text').innerText(),/full rewire/);
    const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:/PDF/}).click();const popup=await popupPromise;
    await popup.waitForFunction(()=>document.body?.innerText.includes('Whole property'));
    assert.match(await popup.locator('body').innerText(),/approximately 8 rooms/);assert.match(await popup.locator('body').innerText(),/Decorative light fittings/);
    assert.doesNotMatch(await popup.locator('body').innerText(),/lowers expected profit|Worth double-checking/);
    if(process.env.PQ_OUTPUT_DIR)await popup.pdf({path:path.join(process.env.PQ_OUTPUT_DIR,'electrician-test-quote.pdf'),format:'A4'});
    await popup.close();
    // Cost checks must describe the user's review, not a fixed success claim.
    assert.equal(await page.locator('#sig-costs').innerText(),'0 / 8');
    assert.match(await page.locator('#health-verdict').innerText(),/Review costs/);
    assert.equal(await page.locator('#sig-review').innerText(),'Review needed');
    const checkboxes=page.locator('.checklist-item input');
    await page.locator('#cost-check-fuel').check();
    assert.equal(await page.locator('#sig-costs').innerText(),'1 / 8');
    await page.locator('#cost-check-fuel').uncheck();
    assert.equal(await page.locator('#sig-costs').innerText(),'0 / 8');
    for(const checkbox of await checkboxes.all())await checkbox.check();
    assert.equal(await page.locator('#sig-costs').innerText(),'8 / 8');
    assert.equal(await page.locator('#sig-review').innerText(),'Complete');
    for(const checkbox of (await checkboxes.all()).slice(1))await checkbox.uncheck();
    assert.equal(await page.locator('#sig-costs').innerText(),'1 / 8');
    assert.equal(await page.locator('#result-total').innerText(),'£5,794','checks do not add money');
    const reviewSaved=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith('/api/quotes/'+quote.id));
    await page.locator('#btn-save-quote').click();assert.equal((await reviewSaved).status(),200);
    assert.deepEqual((await db.query('SELECT quote_data FROM quotes WHERE id=$1',[quote.id])).rows[0].quote_data.costChecks,['fuel']);
    await page.reload();await page.locator('#app-screen').waitFor({state:'visible'});
    await page.evaluate(id=>editQuote(id),quote.id);
    assert.equal(await page.locator('#cost-check-fuel').isChecked(),true);
    assert.equal(await page.locator('#cost-check-vat').isChecked(),false);
    assert.equal(await page.locator('#q-job-scale').inputValue(),'Whole property');assert.equal(await page.locator('#q-room-count').inputValue(),'8');
    // Editing updates the same saved quote and must not consume another free quote.
    await page.evaluate(()=>nextStep(5));const patched=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith('/api/quotes/'+quote.id));
    await page.locator('#step-5 .btn-next').click();assert.equal((await patched).status(),200);await page.locator('#ai-output').waitFor({state:'visible'});
    const me=await (await fetch(base+'/api/auth/me',{headers:{Authorization:'Bearer '+account.token}})).json();assert.equal(me.quotes_remaining,2);
    await page.evaluate(()=>resetBuilder());assert.equal(await page.locator('#q-job-type').inputValue(),'electrical');assert.equal(await page.locator('#q-room-count').inputValue(),'');
    assert.equal(await checkboxes.filter({visible:true}).count(),0);
    assert.equal(await page.locator('#cost-check-fuel').isChecked(),false);
    // Saved trades with useful dimensions retain conversion and quote measurements.
    for(const trade of ['Tiler','Decorator','Landscaper']){
      await page.evaluate(trade=>{currentUser.trade=trade;resetBuilder();nextStep(2);},trade);
      assert.equal(await page.locator('#dimension-fields').isVisible(),true);
      await page.locator('#q-length-m').fill('4');await page.locator('#q-width-m').fill('3');assert.equal(await page.locator('#q-length-ft').inputValue(),'13.1');
      assert.match(await page.locator('#room-area').innerText(),/12.00 m²/);
    }
    await page.evaluate(()=>{currentUser.trade='Plumber';resetBuilder();nextStep(2);});assert.equal(await page.locator('#q-job-type').inputValue(),'plumbing');
    assert.equal(await page.locator('#dimension-fields').isVisible(),false);assert.ok((await page.locator('#q-job-scale option').allTextContents()).includes('Single fitting / repair'));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,journeySeconds:Math.round(elapsed/1000),total:quote.total,profitImpact:414,freeQuotesRemaining:me.quotes_remaining,checks:'Saved trade, 5 electrical scopes, mobile, draft reload, labour review, margin impact, contingency, customer materials, real persistence, PDF, edit without extra credit, dimensions and plumbing'},null,2));
  }finally{https.request=originalRequest;if(browser)await browser.close();await new Promise(r=>server.close(r));await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
