const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const express=require('express'),jwt=require('jsonwebtoken'),{PGlite}=require('@electric-sql/pglite');
test('authenticated checkout prices, pending-session reuse, verified credits and last-credit race',async t=>{
 process.env.JWT_SECRET='commercial-test';process.env.STRIPE_WEBHOOK_SECRET='commercial-webhook';
 const db=new PGlite();await db.exec(fs.readFileSync('schema.sql','utf8'));
 const trial=crypto.randomUUID();await db.query("INSERT INTO quote_allowances(id,trial_started_at) VALUES($1,NOW()-INTERVAL '8 days')",[trial]);
 const user=(await db.query("INSERT INTO users(name,email,password_hash,trial_id) VALUES('QA','qa@example.invalid','test',$1) RETURNING *",[trial])).rows[0];
 let queue=Promise.resolve();const pool={query:db.query.bind(db),connect:async()=>{const before=queue;let release;queue=new Promise(r=>release=r);await before;return {query:db.query.bind(db),release};}};
 const sessions=new Map(),calls=[];let seq=0;
 const stripe={prices:{list:async({lookup_keys})=>({data:[{id:lookup_keys[0]}]})},checkout:{sessions:{
  create:async data=>{calls.push(data);const id='cs_test_'+(++seq),s={id,status:'open',url:'https://checkout.stripe.com/'+id,...data};sessions.set(id,s);return s;},
  retrieve:async id=>sessions.get(id),expire:async id=>{sessions.get(id).status='expired';}
 }}};
 const app=express();app.locals.pool=pool;app.locals.commercialStripe=stripe;const billing=require('../routes/billing');
 app.post('/api/billing/webhook',express.raw({type:'application/json'}),billing.webhook);app.use(express.json());app.use('/api/billing',billing.router);app.use('/api/quotes',require('../routes/quotes'));
 const server=app.listen(0);t.after(async()=>{await new Promise(r=>server.close(r));await db.close();});
 const base='http://127.0.0.1:'+server.address().port,token=jwt.sign({id:user.id},process.env.JWT_SECRET);
 const post=(url,body,auth=token)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify(body)});
 assert.equal((await post('/api/billing/checkout',{plan:'payg'},'bad')).status,401);
 assert.equal((await post('/api/billing/checkout',{plan:'free'})).status,400);
 const first=await (await post('/api/billing/checkout',{plan:'payg'})).json();
 const repeat=await (await post('/api/billing/checkout',{plan:'payg'})).json();assert.equal(first.url,repeat.url);assert.equal(calls.length,1);
 assert.equal(calls[0].mode,'payment');assert.equal(calls[0].line_items[0].price,'profitquote_v2_payg');assert.equal(calls[0].client_reference_id,user.billing_reference);
 assert.equal((await post('/api/billing/confirm',{session_id:'cs_test_1'})).status,200);
 const q={customer_name:'Test',total:100,creation_key:crypto.randomUUID()};assert.equal((await post('/api/quotes',q)).status,402,'unpaid redirect grants nothing');
 Object.assign(sessions.get('cs_test_1'),{status:'complete',payment_status:'paid',currency:'gbp',amount_total:500,line_items:{data:[{quantity:1}]},payment_intent:'pi_test'});
 const raw=JSON.stringify({id:'evt_paid',livemode:true,created:Math.floor(Date.now()/1000),type:'checkout.session.completed',data:{object:{object:'checkout.session',id:'cs_test_1',metadata:{app:'profitquote-v2'}}}});
 const now=Math.floor(Date.now()/1000),sig=crypto.createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(now+'.'+raw).digest('hex');
 for(let i=0;i<2;i++)assert.equal((await fetch(base+'/api/billing/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':`t=${now},v1=${sig}`},body:raw})).status,200);
 const race=await Promise.all([post('/api/quotes',q),post('/api/quotes',{...q,creation_key:crypto.randomUUID()})]);assert.deepEqual(race.map(x=>x.status).sort(),[200,402]);
 const winner=await race.find(x=>x.status===200).json();assert.equal((await post('/api/quotes',{...q,creation_key:winner.creation_key})).status,200,'retry of same saved quote does not spend another credit');
 const next=await (await post('/api/billing/checkout',{plan:'payg'})).json();assert.notEqual(next.url,first.url,'another PAYG purchase gets a fresh session');
 await post('/api/billing/checkout',{plan:'starter'});assert.equal(sessions.get('cs_test_2').status,'expired');assert.equal(calls.at(-1).mode,'subscription');assert.equal(calls.at(-1).subscription_data.metadata.plan,'starter');
 await post('/api/billing/checkout',{plan:'pro'});assert.equal(sessions.get('cs_test_3').status,'expired');assert.equal(calls.at(-1).line_items[0].price,'profitquote_v2_pro');
});
