const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const jwt=require('jsonwebtoken');
const {PGlite}=require('@electric-sql/pglite');

test('admin reads commercial billing, shared trial clock and distinct quote measures',async t=>{
  process.env.ADMIN_SECRET='admin-report-test';
  delete process.env.ADMIN_PASSWORD;
  const db=new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));
  await db.exec(`INSERT INTO users(name,email,password_hash,created_at,paid_at) VALUES
    ('Starter','starter@example.invalid','test',NOW()-INTERVAL '30 days',NULL),
    ('Pro','pro@example.invalid','test',NOW(),NULL),
    ('Manual','manual@example.invalid','test',NOW(),NOW()),
    ('Expired','expired@example.invalid','test',NOW(),NULL);
    INSERT INTO quote_allowances(id,trial_started_at) VALUES
    ('00000000-0000-4000-8000-000000000001',NOW()-INTERVAL '1 day'),
    ('00000000-0000-4000-8000-000000000002',NOW()-INTERVAL '9 days');
    UPDATE users SET trial_id='00000000-0000-4000-8000-000000000001' WHERE id=1;
    UPDATE users SET trial_id='00000000-0000-4000-8000-000000000002' WHERE id=4;
    INSERT INTO commercial_subscriptions(id,user_id,customer_id,plan,status,period_start,period_end) VALUES
    ('starter',1,'customer1','starter','active',NOW(),NOW()+INTERVAL '30 days'),
    ('pro',2,'customer2','pro','active',NOW(),NOW()+INTERVAL '30 days'),
    ('old',4,'customer4','pro','active',NOW()-INTERVAL '30 days',NOW()-INTERVAL '1 day');
    INSERT INTO events(event_type) VALUES('subscription_started'),('payg_purchased'),('anonymous_quote_completed'),('checkout_started'),('account_created');
    INSERT INTO events(event_type,user_id,created_at) VALUES
    ('first_quote',1,NOW()-INTERVAL '2 days'),('quote_completed',1,NOW()),
    ('quote_completed',2,NOW()),('quote_completed',2,NOW()),('quote_saved',3,NOW());
    INSERT INTO guest_sessions(id,browser_hash,ip_hash) VALUES
    ('00000000-0000-4000-8000-000000000003','guest-browser','guest-network');
    INSERT INTO quotes(user_id,guest_id) VALUES (2,NULL),(NULL,'00000000-0000-4000-8000-000000000003');`);
  const app=express();app.use(express.json());app.locals.pool=db;app.use('/admin',require('../routes/admin'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await db.close();});
  const get=async url=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/admin/${url}`,{headers:{Authorization:'Bearer '+jwt.sign({admin:true},process.env.ADMIN_SECRET)}});assert.equal(res.status,200);return res.json();};
  const funnel=await get('funnel?period=all');
  assert.equal(funnel.activePaidCustomers,2);assert.equal(funnel.mrr,48);
  assert.equal(funnel.checkoutStarts,1);
  assert.equal(funnel.paidCustomers,2);
  assert.equal(funnel.totalQuotes,2);
  assert.equal(funnel.savedAccountQuotes,1);
  assert.equal(funnel.quoteCompletions,4);
  assert.equal(funnel.recordedSignups,1);
  assert.equal(funnel.firstQuotes,2);
  assert.equal((await get('funnel?period=today')).firstQuotes,1);
  const login=await fetch(`http://127.0.0.1:${server.address().port}/admin/login`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'changeme'})
  });
  assert.equal(login.status,503);
  const {users}=await get('users');
  assert.equal(users.find(u=>u.id===1).subscription_active,true);
  assert.equal(users.find(u=>u.id===3).subscription_active,false);
  assert.equal(users.find(u=>u.id===4).subscription_active,false);
  assert.ok(new Date(users.find(u=>u.id===1).access_trial_started_at)>new Date(users.find(u=>u.id===1).created_at));
});

test('failed users response clears totals and shows an error; trial uses shared start',async()=>{
  const vm=require('node:vm');
  const html=fs.readFileSync(path.join(__dirname,'../public/admin.html'),'utf8');
  const script=html.slice(html.indexOf('async function loadUsers()'),html.indexOf('function renderUsers(users)'));
  const elements={};
  const context={API:'',adminToken:'test',Date,document:{getElementById:id=>elements[id]||(elements[id]={textContent:'99',innerHTML:''})},fetch:async()=>({status:500,ok:false,json:async()=>({error:'unavailable'})}),renderUsers:()=>{throw new Error('must not render empty users');}};
  vm.createContext(context);vm.runInContext(script,context);
  await context.loadUsers();
  assert.equal(elements['stat-total'].textContent,'—');
  assert.match(elements['users-tbody'].innerHTML,/Could not load users/);
  context.renderStats([{created_at:new Date(Date.now()-30*86400000),access_trial_started_at:new Date(Date.now()-86400000)},
    {created_at:new Date(),access_trial_started_at:new Date(Date.now()-9*86400000)}]);
  assert.equal(elements['stat-trial'].textContent,1);
});
