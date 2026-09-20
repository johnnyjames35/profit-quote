const test=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const express=require('express');
const {migrate,createBundleBilling,BUNDLE_PRICE}=require('../bundle-billing');

for(const app of ['profitquote','latepay','callback'])test(app+': bundle linking, overlap checks, cancellation and expiry',async()=>{
 const pg=new PGlite();
 const query=(sql,args)=>args?pg.query(sql,args):(sql.includes(';')?pg.exec(sql):pg.query(sql));
 const db={query,connect:async()=>({query,release(){}})};
 const now=Math.floor(Date.now()/1000);
 const tier=app==='latepay'?'price_1TI6Jb8466uzy1MNyOq4FMwX':app==='callback'?'price_1UGRS98466uzy1MNKAQMX8gF':'price_1UHgUj8466uzy1MNcCnTWJbi';
 const bundle={id:'sub_bundle',customer:'cus_one',livemode:true,status:'trialing',trial_end:now+4000,latest_invoice:{status:'paid'},items:{data:[{quantity:1,price:{id:BUNDLE_PRICE},current_period_end:now+4000}]}};
 const native={id:'sub_native',customer:'cus_one',livemode:true,status:'active',cancel_at_period_end:false,latest_invoice:{status:'paid'},items:{data:[{quantity:1,price:{id:tier},current_period_end:now+3000}]}};
 let fail=false;
 const stripe={customers:{retrieve:async id=>({id,livemode:true,email:id==='cus_one'?'one@example.invalid':'wrong@example.invalid',name:'Customer'}),list:async function*(){yield{id:'cus_one'};}},subscriptions:{retrieve:async id=>{if(fail)throw new Error('Stripe unavailable');return id==='sub_bundle'?bundle:native;},list:async function*(){yield bundle;yield native;}}};
 try{
  await pg.exec(`CREATE TABLE users(id SERIAL PRIMARY KEY,email TEXT,plan TEXT DEFAULT 'none',account_status TEXT DEFAULT 'trial',sms_limit INTEGER DEFAULT 15,billing_managed BOOLEAN DEFAULT FALSE,paid_at TIMESTAMPTZ,stripe_customer_id TEXT,sms_count INTEGER DEFAULT 4);
   INSERT INTO users(email) VALUES('one@example.invalid'),('one@example.invalid'),('other@example.invalid');
   CREATE TABLE invoices(id SERIAL PRIMARY KEY,user_id INTEGER);INSERT INTO invoices(user_id)VALUES(1);`);
  await migrate(db);await migrate(db);
  const billing=createBundleBilling({db,stripe,app});
  const u=async()=> (await db.query('SELECT * FROM users WHERE id=$1',[1])).rows[0];
  assert.match((await billing.check(1,'cus_one')).blockers[0],/Disable/);
  await assert.rejects(billing.link(1,'cus_one','sub_bundle'),/Disable/);
  assert.equal(await billing.hasBinding(1),false);
  native.cancel_at_period_end=true;bundle.trial_end=now+2000;
  await assert.rejects(billing.link(1,'cus_one','sub_bundle'),/Delay/);
  bundle.trial_end=now+4000;
  await assert.rejects(billing.link(3,'cus_one','sub_bundle'),/email/);
  bundle.customer='cus_wrong';await assert.rejects(billing.link(1,'cus_one','sub_bundle'),/belong/);bundle.customer='cus_one';
  const result=await billing.link(1,'cus_one','sub_bundle');assert.equal(result.enabled,true);
  assert.equal(result.plan,app==='latepay'?'pro':app==='callback'?'plus':'solo','preserve higher paid tier');
  assert.equal(await billing.hasBinding(1),true);
  await billing.nativeUpdate(1,"UPDATE users SET account_status='cancelled' WHERE id=$1",[1]);
  if(app!=='profitquote')assert.equal((await u()).account_status,'active','late standalone events cannot cancel bundle access');
  await assert.rejects(billing.link(2,'cus_one','sub_bundle'),/unique|duplicate/i);
  assert.equal(await billing.hasBinding(2),false);
  if(app!=='profitquote'){assert.equal((await u()).account_status,'active');assert.equal((await u()).sms_count,4);}
  native.status='canceled';await billing.sync(1);
  if(app!=='profitquote')assert.equal((await u()).plan,'starter');
  bundle.status='active';bundle.cancel_at_period_end=true;await billing.sync(1);
  assert.equal((await db.query('SELECT enabled FROM trade_bundle_access')).rows[0].enabled,true);
  bundle.status='canceled';await billing.sync(1);
  assert.equal((await db.query('SELECT enabled FROM trade_bundle_access')).rows[0].enabled,false);
  if(app!=='profitquote')assert.equal((await u()).account_status,'locked');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM invoices')).rows[0].n,1);
  bundle.status='active';bundle.latest_invoice.status='open';await billing.sync(1);
  assert.equal((await db.query('SELECT enabled FROM trade_bundle_access')).rows[0].enabled,false);
  bundle.latest_invoice.status='paid';await db.query("UPDATE users SET account_status='frozen' WHERE id=$1",[1]);await billing.sync(1);
  assert.equal((await u()).account_status,'frozen');
  bundle.items.data[0].price.id='price_other';await billing.sync(1);
  assert.equal((await db.query('SELECT enabled FROM trade_bundle_access')).rows[0].enabled,false);
  bundle.items.data[0].price.id=BUNDLE_PRICE;await billing.sync(1);
  await db.query("UPDATE trade_bundle_access SET valid_until=NOW()-INTERVAL '1 second'");fail=true;
  await billing.reconcile();assert.equal((await db.query('SELECT enabled FROM trade_bundle_access')).rows[0].enabled,false,'outage cannot extend access indefinitely');
  fail=false;
  const serverApp=express();serverApp.use(express.json());
  billing.register(serverApp,(req,res,next)=>req.headers.authorization==='admin'?next():res.sendStatus(401));
  const server=serverApp.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const res=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/1/bundle`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerId:'cus_one',subscriptionId:'sub_bundle',confirm:true})});assert.equal(res.status,401);}finally{await new Promise(r=>server.close(r));}
 }finally{await pg.close();}
});
