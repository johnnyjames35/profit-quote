const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const express=require('express'),jwt=require('jsonwebtoken'),https=require('node:https'),{EventEmitter}=require('node:events'),{PGlite}=require('@electric-sql/pglite');
const ga=require('../utils/ga');
const identity={client_id:'123456.789012',session_id:'1792000000',page_location:'https://profitquote.co.uk/dashboard'};

test('explicit sign-in wins over guest, expired and registered tokens without erasing drafts',()=>{
 const html=fs.readFileSync('public/dashboard.html','utf8');
 const boot=html.slice(html.indexOf('if(resetTokenFromUrl){'),html.indexOf('function showLogin(){'));
 for(const token of ['guest-token','expired-token','registered-token',null]){
   const calls=[];vm.runInNewContext(boot,{resetTokenFromUrl:null,urlParams:new URLSearchParams('login=1'),token,showLogin:()=>calls.push('login'),initApp:()=>calls.push('app'),startGuest:()=>calls.push('guest')});
   assert.deepEqual(calls,['login']);
 }
 const calls=[];vm.runInNewContext(boot,{resetTokenFromUrl:'reset-secret',urlParams:new URLSearchParams('login=1'),token:'guest',showReset:()=>calls.push('reset')});assert.deepEqual(calls,['reset']);
});

test('Google tag context preserves browser identity, strips URLs and tolerates blocked tagging',async()=>{
 const source=fs.readFileSync('public/product-analytics.js','utf8').split('/* Optional PostHog')[0];
 const ctx={window:{gtag:(command,id,field,callback)=>callback(field==='client_id'?'123.456':1792000000)},navigator:{},location:{origin:'https://profitquote.co.uk',pathname:'/dashboard',search:'?token=secret'},setTimeout,clearTimeout};
 vm.runInNewContext(source,ctx);
 assert.deepEqual(JSON.parse(JSON.stringify(await ctx.window.pqGAContext())),{client_id:'123.456',session_id:'1792000000',page_location:identity.page_location});
 ctx.navigator.doNotTrack='1';assert.deepEqual(JSON.parse(JSON.stringify(await ctx.window.pqGAContext())),{});
 delete ctx.navigator.doNotTrack;ctx.window.gtag=()=>{};
 assert.deepEqual(JSON.parse(JSON.stringify(await ctx.window.pqGAContext())),{});
});

test('registered email replies use business contact or account fallback; invalid replies send nothing',async t=>{
 process.env.JWT_SECRET='email-fix-test';process.env.BREVO_API_KEY='test';
 const original=https.request,sent=[];
 https.request=(options,callback)=>{const req=new EventEmitter();let body='';req.write=x=>body+=x;req.end=()=>{sent.push(JSON.parse(body));const res=new EventEmitter();res.statusCode=201;callback(res);queueMicrotask(()=>res.emit('end'));};return req;};
 t.after(()=>https.request=original);
 const db=new PGlite();await db.exec(fs.readFileSync('schema.sql','utf8'));
 const user=(await db.query("INSERT INTO users(name,email,password_hash,business_name,contact_email) VALUES('Test','account@example.invalid','none','Test Trade','work@example.invalid') RETURNING *")).rows[0];
 const quote=(await db.query("INSERT INTO quotes(user_id,customer_name,total,quote_data) VALUES($1,'Customer',8500,$2) RETURNING *",[user.id,{customer_email:'customer@example.invalid'}])).rows[0];
 const app=express();app.locals.pool={query:db.query.bind(db)};app.use(express.json());app.use('/api/quotes',require('../routes/quotes'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await db.close();});
 const post=body=>fetch('http://127.0.0.1:'+server.address().port+'/api/quotes/send-email',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt.sign({id:user.id},process.env.JWT_SECRET)},body:JSON.stringify(body)});
 assert.equal((await post({quote_id:quote.id,reply_email:'override@example.invalid'})).status,200);
 assert.equal(sent[0].replyTo.email,'work@example.invalid');assert.equal(sent[0].sender.email,'hello@profitquote.co.uk');assert.match(sent[0].textContent,/work@example.invalid/);
 await db.query('UPDATE users SET contact_email=NULL WHERE id=$1',[user.id]);assert.equal((await post({quote_id:quote.id})).status,200);assert.equal(sent[1].replyTo.email,'account@example.invalid');
 await db.query("UPDATE users SET contact_email='bad\naddress' WHERE id=$1",[user.id]);assert.equal((await post({quote_id:quote.id})).status,400);assert.equal(sent.length,2);
});

test('GA events retain browser/session and page hostname; invalid and missing context never create synthetic users',async t=>{
 const original=global.fetch,calls=[];t.after(()=>{global.fetch=original;delete process.env.GA_API_SECRET;delete process.env.GA_MEASUREMENT_ID;});
 process.env.GA_MEASUREMENT_ID='G-test';process.env.GA_API_SECRET='test';
 global.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true};};
 assert.equal(await ga.sendToGA('account_created',42,'dashboard',identity),true);
 assert.equal(calls[0].client_id,identity.client_id);assert.equal(calls[0].events[0].params.session_id,1792000000);assert.equal(calls[0].events[0].params.page_location,identity.page_location);
 for(const context of [null,{}, {...identity,page_location:'https://evil.invalid/'},{...identity,session_id:'invalid'}]) assert.equal(await ga.sendToGA('trial_click',null,'direct',context),false);
 assert.equal(calls.length,1);
 assert.equal(ga.requestContext({headers:{'x-pq-analytics':'invalid'}}),null);
 assert.deepEqual(ga.analyticsContext({...identity,page_location:identity.page_location+'?token=secret#private'}),identity);
});

test('verified PAYG and subscription purchases queue once, survive failed delivery and retain amounts and attribution',async t=>{
 const {fulfil,syncSubscription}=require('../utils/commercial-billing');
 const db=new PGlite();await db.exec(fs.readFileSync('schema.sql','utf8'));
 const user=(await db.query("INSERT INTO users(name,email,password_hash) VALUES('Test','test@example.invalid','none') RETURNING *")).rows[0];
 const metadata={app:'profitquote-v2',plan:'payg',reference:user.billing_reference,ga_client_id:identity.client_id,ga_session_id:identity.session_id,ga_page_location:identity.page_location};
 const session={id:'cs_test_paid',mode:'payment',currency:'gbp',amount_total:500,payment_status:'unpaid',client_reference_id:user.billing_reference,payment_intent:'pi_test',metadata,line_items:{data:[{quantity:1}]}};
 const sub={id:'sub_test_paid',customer:'cus_test',metadata:{...metadata,plan:'starter'},status:'active',latest_invoice:{status:'open'},items:{data:[{price:{lookup_key:'profitquote_v2_starter',currency:'gbp',unit_amount:1900,recurring:{interval:'month'}},current_period_start:1792000000,current_period_end:1794592000}]}};
 const stripe={checkout:{sessions:{retrieve:async()=>session}},subscriptions:{retrieve:async()=>sub}};
 await fulfil(db,stripe,session.id);await syncSubscription(db,stripe,sub.id);assert.equal((await db.query('SELECT * FROM ga_purchase_outbox')).rows.length,0);
 session.payment_status='paid';sub.latest_invoice.status='paid';
 for(let i=0;i<2;i++){await fulfil(db,stripe,session.id);await syncSubscription(db,stripe,sub.id);}
 sub.id='sub_pro';sub.metadata.plan='pro';sub.items.data[0].price={lookup_key:'profitquote_v2_pro',currency:'gbp',unit_amount:2900,recurring:{interval:'month'}};
 await syncSubscription(db,stripe,sub.id);await syncSubscription(db,stripe,sub.id);
 let rows=(await db.query('SELECT * FROM ga_purchase_outbox ORDER BY transaction_id')).rows;
 assert.equal(rows.length,3);assert.deepEqual(rows.map(x=>x.parameters.value),[5,29,19]);assert.deepEqual(rows[0].context,identity);
 const original=global.fetch,calls=[];let accepted=false;
 t.after(async()=>{global.fetch=original;delete process.env.GA_MEASUREMENT_ID;delete process.env.GA_API_SECRET;await db.close();});
 process.env.GA_MEASUREMENT_ID='G-test';process.env.GA_API_SECRET='test';
 global.fetch=async(url,options)=>{assert.match(url,/google-analytics.com\/mp\/collect/);calls.push(JSON.parse(options.body));return {ok:accepted};};
 const pool={connect:async()=>({query:db.query.bind(db),release(){}})};
 await ga.flushPurchases(pool);assert.equal((await db.query('SELECT * FROM ga_purchase_outbox WHERE delivered_at IS NOT NULL')).rows.length,0);
 accepted=true;await ga.flushPurchases(pool);await ga.flushPurchases(pool);
 assert.equal(calls.length,6);assert.equal((await db.query('SELECT * FROM ga_purchase_outbox WHERE delivered_at IS NOT NULL')).rows.length,3);
 assert.equal(calls[0].events[0].name,'purchase');assert.equal(calls[0].events[0].params.currency,'GBP');assert.equal(calls[0].events[0].params.transaction_id,calls[3].events[0].params.transaction_id);
 await db.exec(fs.readFileSync('schema.sql','utf8'));assert.equal((await db.query('SELECT * FROM ga_purchase_outbox')).rows.length,3,'migration preserves delivery receipts');
});
