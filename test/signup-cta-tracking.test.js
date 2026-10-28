const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const express=require('express');
function browser({beacon=true,dnt=false,gpc=false,referrer='https://www.google.co.uk/search?q=private',search=''}={}) {
  const events=[],handlers={},navigations=[],attributes={};
  const context={window:{pqGAContext:async()=>({client_id:'123.456',session_id:'1793229000',page_location:'https://profitquote.co.uk/knowledge-centre.html'})},
    navigator:{doNotTrack:dnt?'1':'0',globalPrivacyControl:gpc,sendBeacon:(url,body)=>{if(beacon)events.push({url,body});return beacon;}},
    document:{referrer,documentElement:{setAttribute:(key,value)=>{attributes[key]=value;}},addEventListener:(type,handler)=>{handlers[type]=handler;}},
    location:{origin:'https://profitquote.co.uk',hostname:'profitquote.co.uk',href:'https://profitquote.co.uk/knowledge-centre.html',search,assign:url=>navigations.push(url)},
    URL,URLSearchParams,Blob,fetch:async(url,options)=>{events.push({url,body:new Blob([options.body])});return {ok:true};}};
  const source=fs.readFileSync('public/public-events.js','utf8');vm.runInNewContext(source,context);
  return {context,events,handlers,navigations,source,attributes};
}
async function flush(){await new Promise(r=>setImmediate(r));}
function click(b,{href='https://profitquote.co.uk/dashboard?source=guide&try=1',type='click',button=0,ctrlKey=false,target='',defaultPrevented=false}={}){
  let prevented=false;
  const link={href,target,hasAttribute:()=>false};
  b.handlers[type]({type,button,ctrlKey,defaultPrevented,target:{closest:()=>link},preventDefault(){prevented=true;}});
  return ()=>prevented;
}
test('delegated article CTA preserves navigation and sends exactly once with original GA identity',async()=>{
 const b=browser();const prevented=click(b);await flush();assert.equal(prevented(),true);assert.equal(b.events.length,1);
 const event=JSON.parse(await b.events[0].body.text());assert.equal(event.event_type,'trial_click');assert.equal(event.source,'google');assert.equal(event.analytics.client_id,'123.456');
 assert.equal(b.navigations.length,1);assert.ok(!JSON.stringify(event).includes('q=private'));
 vm.runInNewContext(b.source,b.context);click(b,{ctrlKey:true});await flush();assert.equal(b.events.length,2,'loading script twice must not duplicate handlers');
 click(b,{type:'auxclick',button:1});await flush();assert.equal(b.events.length,3);assert.equal(b.navigations.length,1,'modified and middle click retain browser behaviour');
 click(b,{href:'https://other.example/dashboard?try=1'});click(b,{defaultPrevented:true});await flush();assert.equal(b.events.length,3);
});
test('beacon rejection falls back, spoofed search referrer is not Google, measurement errors never block CTA',async()=>{
 const b=browser({beacon:false,referrer:'https://google.com.attacker.invalid/'});click(b);await flush();assert.equal(b.events.length,1);assert.equal(JSON.parse(await b.events[0].body.text()).source,'referral');
 b.context.window.pqGAContext=async()=>{throw Error('blocked');};click(b);await flush();assert.equal(b.navigations.length,2);
});
test('direct and guest signup events need no account token and honour privacy signals',async()=>{
 const b=browser();for(const type of ['signup_screen_viewed','signup_attempted','signup_failed'])assert.equal(await b.context.window.pqTrackPublicEvent(type),true);
 assert.equal(b.events.length,3);assert.ok(b.events.every(x=>x.url==='/api/events/signup'));
 for(const privacy of [{dnt:true},{gpc:true}]){const p=browser(privacy);await p.context.window.pqTrackPublicEvent('signup_attempted');assert.equal(p.events.length,0);}
});
test('every public page with a free-trial CTA loads the shared tracker and generators preserve it',()=>{
 for(const name of fs.readdirSync('public').filter(x=>x.endsWith('.html'))){
  const html=fs.readFileSync('public/'+name,'utf8');if(/href="\/dashboard\?[^"\s]*try=1/.test(html))assert.match(html,/<script src="\/public-events.js\?v=[a-f0-9]{12}"><\/script>/,name);
 }
 for(const name of ['scripts/build-commercial-pages.cjs','scripts/build-resources.cjs'])assert.match(fs.readFileSync(name,'utf8'),/\/public-events.js/);
});
test('opt-in diagnostics distinguish privacy suppression and queueing without exposing identity or altering preferences',async()=>{
 const normal=browser();await normal.context.window.pqTrackPublicEvent('signup_attempted');assert.deepEqual(normal.attributes,{});
 const suppressed=browser({dnt:true,search:'?tracking_debug=1'});await suppressed.context.window.pqTrackPublicEvent('signup_attempted');
 assert.equal(suppressed.attributes['data-pq-tracking-status'],'privacy-disabled');assert.equal(suppressed.events.length,0);assert.equal(suppressed.context.navigator.doNotTrack,'1');
 const enabled=browser({search:'?tracking_debug=1'});await enabled.context.window.pqTrackPublicEvent('signup_attempted');
 assert.equal(enabled.attributes['data-pq-tracking-status'],'beacon-queued');assert.equal(enabled.attributes['data-pq-ga-identity'],'available');assert.ok(!JSON.stringify(enabled.attributes).includes('123.456'));
});
test('tracking asset URL matches its content hash on pages and generators',()=>{
 const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync('public/public-events.js','utf8').replace(/\r\n/g,'\n')).digest('hex').slice(0,12);
 for(const p of [...fs.readdirSync('public').filter(x=>x.endsWith('.html')).map(x=>'public/'+x),'scripts/build-commercial-pages.cjs','scripts/build-resources.cjs']){
  const s=fs.readFileSync(p,'utf8');if(s.includes('/public-events.js'))assert.ok(s.includes('/public-events.js?v='+hash),p);
 }
});
test('signup UI events are anonymous, origin restricted, allowlisted, bounded and do not leak form fields',async t=>{
 process.env.JWT_SECRET='signup-test';delete process.env.GA_API_SECRET;
 const rows=[];const app=express();app.use(express.json());app.locals.pool={query:async(sql,args)=>{rows.push(args);return{rows:[]};}};
 app.use('/events',require('../routes/events'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const send=(body,origin='https://profitquote.co.uk',extra={})=>fetch('http://127.0.0.1:'+server.address().port+'/events/signup',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...extra},body:JSON.stringify(body)});
 assert.equal((await send({event_type:'signup_attempted'},'https://attacker.invalid')).status,403);
 assert.equal((await send({event_type:'account_created'})).status,400);
 assert.equal((await send({event_type:'signup_attempted'},'https://profitquote.co.uk',{DNT:'1'})).status,200);assert.equal(rows.length,0);
 for(const event_type of ['signup_screen_viewed','signup_attempted','signup_failed'])assert.equal((await send({event_type,user_id:999,email:'private@example.invalid',password:'private',source:'untrusted'})).status,200);
 assert.deepEqual(rows.map(r=>r.slice(1)),[[null,'signup_ui'],[null,'signup_ui'],[null,'signup_ui']]);assert.ok(!JSON.stringify(rows).includes('private'));
 for(let i=3;i<30;i++)await send({event_type:'signup_attempted'});
 assert.equal((await send({event_type:'signup_attempted'})).status,429);assert.equal(rows.length,30);
 assert.equal((await fetch('http://127.0.0.1:'+server.address().port+'/events/funnel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_type:'quote_started'})})).status,401);
});
test('dashboard routes signup telemetry before token guard and counts validation failures as attempts',()=>{
 const html=fs.readFileSync('public/dashboard.html','utf8');const tracking=html.slice(html.indexOf('function trackFunnelEvent('),html.indexOf('let guestToken'));
 assert.ok(tracking.indexOf('pqTrackPublicEvent')<tracking.indexOf('if(!token)'));
 const register=html.slice(html.indexOf('async function doRegister()'),html.indexOf('async function initApp('));
 assert.ok(register.indexOf("trackFunnelEvent('signup_attempted')")<register.indexOf('if(!name||!email||!password)'));
 const screen=html.slice(html.indexOf('function showRegister()'),html.indexOf('function showForgot()'));assert.match(screen,/trackFunnelEvent\('signup_screen_viewed'\)/);
});
