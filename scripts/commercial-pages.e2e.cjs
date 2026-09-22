const fs=require('fs'),path=require('path'),express=require('express'),assert=require('assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const app=express();app.use(require('../routes/commercial-pages'));app.use(express.static(path.join(__dirname,'../public')));app.get('/dashboard',(req,res)=>res.sendFile(path.join(__dirname,'../public/dashboard.html')));app.post('/api/events',(req,res)=>res.json({success:true}));
 const server=app.listen(0);const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:1000}});
   await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(const slug of require('../utils/commercial-pages')){
    await page.goto(base+'/'+slug);await page.locator('h1').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+slug+' '+width);
    assert.equal(await page.locator('h1').count(),1);
    assert.equal(await page.locator('a[href^="/dashboard?try=1"]').count(),5);
    await page.locator('figure img').scrollIntoViewIfNeeded(); await page.waitForFunction(()=>document.querySelector('figure img').naturalWidth>0);
    if(process.env.PQ_OUTPUT_DIR && slug==='quoting-software-for-electricians') await page.screenshot({path:path.join(process.env.PQ_OUTPUT_DIR,'landing-'+width+'.png'),fullPage:true});
    const trial=page.locator('a[href^="/dashboard?try=1"]').first();await trial.click();await page.waitForURL('**/dashboard?try=1*');
    assert.ok(page.url().includes('source='+slug));
   }
   assert.deepEqual(errors,[]);
   for(const url of ['/','/knowledge-centre.html','/how-to-price-labour-correctly.html']){
    await page.goto(base+url);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+url);
   }
   await context.close();console.log('Browser checks passed at '+width+'px');
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
