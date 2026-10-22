const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const express=require('express');
const jwt=require('jsonwebtoken');
const {PGlite}=require('@electric-sql/pglite');

test('audit: first saved quote is durable once, manual access is not a sale, public visits cannot impersonate users',async t=>{
  process.env.JWT_SECRET='audit-local-only';process.env.ADMIN_SECRET='audit-admin-only';
  delete process.env.GA_API_SECRET;
  const db=new PGlite();await db.exec(fs.readFileSync('schema.sql','utf8'));
  const trial=crypto.randomUUID();
  await db.query('INSERT INTO quote_allowances(id,trial_started_at) VALUES($1,NOW())',[trial]);
  const user=(await db.query("INSERT INTO users(name,email,password_hash,trial_id) VALUES('Audit','audit@example.invalid','unused',$1) RETURNING id",[trial])).rows[0];
  let queue=Promise.resolve();
  const pool={query:db.query.bind(db),connect:async()=>{const before=queue;let release;queue=new Promise(r=>release=r);await before;return {query:db.query.bind(db),release};}};
  const app=express();app.locals.pool=pool;app.use(express.json());
  app.use('/quotes',require('../routes/quotes'));app.use('/events',require('../routes/events'));app.use('/admin',require('../routes/admin'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await db.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const call=(path,body,admin=false,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt.sign(admin?{admin:true}:{id:user.id},admin?process.env.ADMIN_SECRET:process.env.JWT_SECRET)},...(body?{body:JSON.stringify(body)}:{})});
  const body={total:100,creation_key:crypto.randomUUID()};
  for(let n=0;n<2;n++)assert.equal((await call('/quotes',body)).status,200);
  const count=async type=>(await db.query('SELECT COUNT(*)::int AS n FROM events WHERE event_type=$1',[type])).rows[0].n;
  await t.test('first-save activation survives retries and deletion',async()=>{
  assert.equal(await count('first_quote'),1,'first save and retry must yield exactly one activation');
  await db.exec('DELETE FROM quotes');
  assert.equal((await call('/quotes',{...body,creation_key:crypto.randomUUID()})).status,200);
  assert.equal(await count('first_quote'),1,'quote deletion must not reset activation');
  });
  await t.test('manual grants do not count as purchases',async()=>{
  for(let n=0;n<2;n++)assert.equal((await call('/admin/users/'+user.id+'/mark-paid',null,true,'PATCH')).status,200);
  assert.equal(await count('subscription_started'),0,'manual grants are not verified purchases');
  assert.equal(await count('manual_access_granted'),1,'repeat grant is idempotent');
  await db.query("INSERT INTO events(event_type,user_id) VALUES('subscription_started',$1)",[user.id]);
  const funnel=await (await call('/admin/funnel?period=all',null,true,'GET')).json();
  assert.equal(funnel.paidConversions,0,'historical manual grant must not inflate the funnel');
  await db.query('UPDATE users SET billing_managed=true WHERE id=$1',[user.id]);
  assert.equal((await call('/admin/users/'+user.id+'/mark-paid',null,true,'PATCH')).status,409);
  await db.query('UPDATE users SET billing_managed=false WHERE id=$1',[user.id]);
  await db.query("INSERT INTO trade_bundle_access(user_id,subscription_id,customer_id) VALUES($1,'sub_audit','cus_audit')",[user.id]);
  assert.equal((await call('/admin/users/'+user.id+'/mark-paid',null,true,'PATCH')).status,409);
  assert.equal(await count('manual_access_granted'),1,'managed and bundle grants must not record manual sales');
  });
  await t.test('public visits cannot impersonate accounts',async()=>{
  await call('/events',{event_type:'page_viewed',user_id:user.id,source:'google'});
  assert.equal((await db.query("SELECT user_id FROM events WHERE event_type='page_viewed'")).rows[0].user_id,null,'public callers cannot assign user identity');
  });
});
