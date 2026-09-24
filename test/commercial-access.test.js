const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {access,consume}=require('../utils/quote-access');
const {fulfil,syncSubscription}=require('../utils/commercial-billing');
test('seven-day trial, Starter periods, paid credits, Pro and preserved legacy access',async()=>{
 const db=new PGlite();await db.exec(fs.readFileSync('schema.sql','utf8'));
 const id=crypto.randomUUID();await db.query('INSERT INTO quote_allowances(id,trial_started_at) VALUES($1,NOW())',[id]);
 const user=(await db.query("INSERT INTO users(name,email,password_hash,trial_id) VALUES('Test','test@example.invalid','none',$1) RETURNING *",[id])).rows[0];
 const u={id:user.id};
 for(let i=0;i<12;i++){const a=await access(db,u,true);assert.equal(a.can_create,true);assert.equal(a.trial_active,true);await consume(db,a,u);}
 await db.query("UPDATE quote_allowances SET trial_started_at=NOW()-INTERVAL '7 days' WHERE id=$1",[id]);
 assert.equal((await access(db,u)).can_create,false,'trial expires exactly at seven days');
 await assert.rejects(consume(db,await access(db,u),u),/Choose/);
 const end=new Date(Date.now()+30*86400000),start=new Date();
 await db.query("INSERT INTO commercial_subscriptions(id,user_id,customer_id,plan,status,period_start,period_end) VALUES('sub_starter',$1,'cus_test','starter','active',$2,$3)",[u.id,start,end]);
 for(let i=0;i<6;i++){const a=await access(db,u,true);assert.equal(a.remaining,6-i);await consume(db,a,u);}
 assert.equal((await access(db,u)).can_create,false);
 await db.exec('DELETE FROM quotes');assert.equal((await access(db,u)).can_create,false,'deletion cannot restore monthly allowance');
 await db.exec(fs.readFileSync('schema.sql','utf8'));assert.equal((await access(db,u)).can_create,false,'migration does not reset use');
 await db.query("UPDATE commercial_subscriptions SET period_start=$1 WHERE id='sub_starter'",[new Date(start.getTime()+1000)]);
 assert.equal((await access(db,u)).remaining,6,'new billing period has six quotes');
 await db.query("UPDATE commercial_subscriptions SET status='past_due' WHERE id='sub_starter'");
 assert.equal((await access(db,u)).can_create,false,'failed renewal has no access');
 const session={id:'cs_paid',mode:'payment',currency:'gbp',amount_total:500,payment_status:'paid',client_reference_id:user.billing_reference,payment_intent:'pi_test',metadata:{app:'profitquote-v2',plan:'payg'},line_items:{data:[{quantity:1}]}};
 const stripe={checkout:{sessions:{retrieve:async()=>session}}};
 await fulfil(db,stripe,'cs_paid',u.id);await fulfil(db,stripe,'cs_paid',u.id);
 assert.equal((await access(db,u)).credits,1,'replayed confirmation grants only one credit');
 await consume(db,await access(db,u,true),u);assert.equal((await access(db,u)).can_create,false);
 await fulfil(db,stripe,'cs_paid',u.id);assert.equal((await access(db,u)).credits,0,'replay cannot restore spent credit');
 session.id='cs_unpaid';session.payment_status='unpaid';await fulfil(db,stripe,'cs_unpaid',u.id);assert.equal((await access(db,u)).credits,0);
 session.payment_status='paid';session.amount_total=1;await assert.rejects(fulfil(db,stripe,'cs_unpaid',u.id),/Incorrect/);
 session.amount_total=500;await assert.rejects(fulfil(db,stripe,'cs_paid',u.id+1),/mismatch/);
 const sub={id:'sub_pro',customer:'cus_test',metadata:{app:'profitquote-v2',plan:'starter',reference:user.billing_reference},status:'active',latest_invoice:{status:'paid'},items:{data:[{price:{lookup_key:'profitquote_v2_pro',currency:'gbp',unit_amount:2900,recurring:{interval:'month'}},current_period_start:Math.floor(Date.now()/1000),current_period_end:Math.floor(end/1000)}]}};
 stripe.subscriptions={retrieve:async()=>sub};await syncSubscription(db,stripe,sub.id,u.id);
 assert.equal((await access(db,u)).unlimited,true,'paid price controls upgrade, not old metadata');
 sub.latest_invoice.status='open';await syncSubscription(db,stripe,sub.id);assert.equal((await access(db,u)).can_create,false,'unpaid upgrade never grants Pro');
 sub.latest_invoice.status='paid';sub.status='canceled';await syncSubscription(db,stripe,sub.id);assert.equal((await access(db,u)).can_create,false);
 await db.query('UPDATE users SET billing_managed=false,paid_at=NOW() WHERE id=$1',[u.id]);assert.equal((await access(db,u)).unlimited,true,'existing admin grants preserved');
 await db.close();
});
test('trial stages never send stale reminders or multiple stages together',()=>{
 const {stageFor,message}=require('../utils/trial-message');
 assert.equal(stageFor(0,false),null);assert.equal(stageFor(.1,true),'first_quote');assert.equal(stageFor(3,true),'mid_trial');
 assert.equal(stageFor(6,true),'expiry_reminder');assert.equal(stageFor(7,true),'expired');assert.equal(stageFor(10,true),'follow_up');assert.equal(stageFor(14,true),null);
 assert.match(message('expired','<script>').html,/&lt;script&gt;/);
 for(const stage of ['welcome','first_quote','mid_trial','expiry_reminder','expired','follow_up']){
  const m=message(stage,'Test');assert.match(m.html,/£5/);assert.match(m.html,/£19/);assert.match(m.html,/£29/);assert.doesNotMatch(m.html,/£37|£49|£99/);
 }
});
