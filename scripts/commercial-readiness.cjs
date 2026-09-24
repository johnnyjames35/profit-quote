// Run inside the existing service: node scripts/commercial-readiness.cjs
// Rolls back all database fixtures; opens and immediately expires unpaid Stripe sessions.
require('dotenv').config();
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Pool}=require('pg');
const {access,consume}=require('../utils/quote-access');
const {stripeFor,PLANS}=require('../utils/commercial-billing');
(async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const id=crypto.randomUUID();
  await db.query('INSERT INTO quote_allowances(id,trial_started_at) VALUES($1,NOW())',[id]);
  const user=(await db.query("INSERT INTO users(name,email,password_hash,trial_id,trial_emails_enabled) VALUES('Readiness fixture',$1,'disabled',$2,false) RETURNING id",['readiness-'+id+'@example.invalid',id])).rows[0];
  assert.equal((await access(db,user)).unlimited,true);
  await db.query("UPDATE quote_allowances SET trial_started_at=NOW()-INTERVAL '8 days' WHERE id=$1",[id]);
  assert.equal((await access(db,user)).can_create,false);
  await db.query("INSERT INTO commercial_subscriptions(id,user_id,customer_id,plan,status,period_start,period_end) VALUES($1,$2,'readiness','starter','active',NOW(),NOW()+INTERVAL '1 month')",[id,user.id]);
  for(let n=0;n<6;n++)await consume(db,await access(db,user,true),user);
  assert.equal((await access(db,user)).can_create,false);
  await db.query("UPDATE commercial_subscriptions SET plan='pro' WHERE id=$1",[id]);
  assert.equal((await access(db,user)).unlimited,true);
  console.log('PASS production database: trial, expiry, Starter six-quote limit, Pro');
 }finally{await db.query('ROLLBACK');db.release();await pool.end();}
 const stripe=stripeFor({app:{locals:{}}});
 for(const [plan,p] of Object.entries(PLANS)){
  const prices=await stripe.prices.list({lookup_keys:['profitquote_v2_'+plan],active:true,limit:1});
  assert.equal(prices.data[0]?.unit_amount,p.amount);assert.equal(prices.data[0].currency,'gbp');
  const s=await stripe.checkout.sessions.create({mode:plan==='payg'?'payment':'subscription',line_items:[{price:prices.data[0].id,quantity:1}],metadata:{app:'profitquote-readiness'},success_url:'https://profitquote.co.uk/dashboard',cancel_url:'https://profitquote.co.uk/',integration_identifier:'profitquote_readiness'});
  try{assert.ok(s.url);assert.equal(s.amount_total,p.amount);}finally{await stripe.checkout.sessions.expire(s.id);}
  console.log('PASS live Stripe checkout '+plan+': correct amount; expired unpaid');
 }
 assert.ok(process.env.STRIPE_WEBHOOK_SECRET,'Missing Stripe webhook secret');
 assert.ok(process.env.BREVO_API_KEY,'Missing Brevo key');
 const response=await fetch('https://api.brevo.com/v3/account',{headers:{'api-key':process.env.BREVO_API_KEY},signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200,'Brevo account authentication failed');
 console.log('PASS Brevo authentication; no email sent. PASS readiness.');
})().catch(e=>{console.error('FAIL readiness:',e.message);process.exitCode=1;});
