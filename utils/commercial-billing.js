const Stripe=require('stripe');

const crypto=require('crypto');

const PLANS={payg:{amount:500,name:'ProfitQuote — one quote'},starter:{amount:1900,name:'ProfitQuote Starter — 6 quotes/month'},pro:{amount:2900,name:'ProfitQuote Pro — unlimited quotes'}};
const PORTAL_CONFIG=process.env.STRIPE_PORTAL_CONFIGURATION||'bpc_1UJKho8466uzy1MNPmxeV3N9';
async function recordPurchase(db,id,userId,type,plan){
  await db.query(`WITH receipt AS (INSERT INTO billing_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id)
    INSERT INTO events(event_type,user_id,source,meta) SELECT $2,$3,'stripe_webhook',jsonb_build_object('plan',$4::text) FROM receipt`,['commercial:'+id,type,userId,plan]);
}
function stripeFor(req){

  if(req.app.locals.commercialStripe)return req.app.locals.commercialStripe;

  if(!process.env.STRIPE_SECRET_KEY)throw Object.assign(new Error('Payments are temporarily unavailable. Please contact support.'),{status:503});

  return new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2026-08-26.dahlia',maxNetworkRetries:2});

}

async function priceFor(stripe,plan){

  const key='profitquote_v2_'+plan;

  const found=await stripe.prices.list({lookup_keys:[key],active:true,limit:1});

  if(found.data.length)return found.data[0].id;

  const p=PLANS[plan];

  return (await stripe.prices.create({currency:'gbp',unit_amount:p.amount,lookup_key:key,

    product_data:{name:p.name,metadata:{app:'profitquote',plan}},...(plan==='payg'?{}:{recurring:{interval:'month'}})},

    {idempotencyKey:key})).id;

}

async function syncSubscription(db,stripe,id,userId){

  const sub=await stripe.subscriptions.retrieve(id,{expand:['latest_invoice']});

  if(sub.metadata?.app!=='profitquote-v2')return false;

  const item=sub.items.data[0],plan=sub.metadata.plan;

  // Upgrades change the price; metadata may still contain the original plan.

  const actual=Object.keys(PLANS).find(p=>p!=='payg'&&item.price.lookup_key==='profitquote_v2_'+p);

  if(!actual||item.price.currency!=='gbp'||item.price.unit_amount!==PLANS[actual].amount||item.price.recurring?.interval!=='month')throw new Error('Unrecognised subscription price');

  const user=(await db.query('SELECT id FROM users WHERE billing_reference=$1',[sub.metadata.reference])).rows[0];

  if(!user||userId&&user.id!==userId)throw new Error('Subscription account mismatch');

  const customer=typeof sub.customer==='string'?sub.customer:sub.customer.id;

  const paid=sub.status==='active'&&sub.latest_invoice?.status==='paid'&&!sub.pause_collection;

  await db.query(`INSERT INTO commercial_subscriptions(id,user_id,customer_id,plan,status,period_start,period_end)

    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET plan=EXCLUDED.plan,status=EXCLUDED.status,

    period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,verified_at=NOW()`,

    [id,user.id,customer,actual,paid?'active':sub.status==='active'?'unpaid':sub.status,

      new Date((item.current_period_start||sub.current_period_start)*1000),new Date((item.current_period_end||sub.current_period_end)*1000)]);

  await db.query('UPDATE users SET stripe_customer_id=$1,billing_managed=true WHERE id=$2',[customer,user.id]);
  if(paid)await recordPurchase(db,id,user.id,'subscription_started',actual);
  return true;

}

async function fulfil(db,stripe,sessionId,userId){

  const session=await stripe.checkout.sessions.retrieve(sessionId,{expand:['line_items','payment_intent.latest_charge']});
  if(session.metadata?.app!=='profitquote-v2')return false;

  const plan=session.metadata.plan,p=PLANS[plan];

  if(!p||session.payment_status!=='paid')return false;

  const user=(await db.query('SELECT id FROM users WHERE billing_reference=$1',[session.client_reference_id])).rows[0];

  if(!user||userId&&user.id!==userId)throw new Error('Payment account mismatch');

  if(plan!=='payg')return syncSubscription(db,stripe,typeof session.subscription==='string'?session.subscription:session.subscription.id,user.id);

  if(session.mode!=='payment'||session.currency!=='gbp'||session.amount_total!==500||session.line_items?.data?.length!==1||session.line_items.data[0].quantity!==1)throw new Error('Incorrect quote payment');
  if(session.payment_intent?.latest_charge?.amount_refunded>0)return false;
  await db.query('INSERT INTO commercial_payments(session_id,user_id,amount,payment_intent) VALUES($1,$2,500,$3) ON CONFLICT DO NOTHING',[session.id,user.id,typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id]);
  await recordPurchase(db,session.id,user.id,'payg_purchased','payg');
  return true;

}
async function refresh(db,stripe,userId){
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const pending=(await client.query('SELECT session_id FROM commercial_checkouts WHERE user_id=$1',[userId])).rows[0];
    if(pending)await fulfil(client,stripe,pending.session_id,userId);
    const rows=await client.query("SELECT id FROM commercial_subscriptions WHERE user_id=$1 AND status NOT IN ('canceled','incomplete_expired') AND verified_at<NOW()-INTERVAL '1 minute'",[userId]);
    for(const row of rows.rows)await syncSubscription(client,stripe,row.id,userId);
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function checkout(req,res){

  const plan=req.body?.plan||'pro';

  if(!PLANS[plan])return res.status(400).json({error:'Choose payg, starter or pro.'});

  if(req.user.guest)return res.status(403).json({error:'Create your free account first.'});

  const db=req.app.locals.pool,stripe=stripeFor(req),client=await db.connect();

  try{

    await client.query('BEGIN');

    const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];

    if((await client.query('SELECT 1 FROM trade_bundle_access WHERE user_id=$1',[user.id])).rows.length)throw Object.assign(new Error('Manage your Trade Toolkit subscription through support.'),{status:409});

    const pending=(await client.query('SELECT * FROM commercial_checkouts WHERE user_id=$1',[user.id])).rows[0];
    if(pending){
      const previous=await stripe.checkout.sessions.retrieve(pending.session_id);
      if(previous.status==='open'&&pending.plan===plan){await client.query('COMMIT');return res.json({url:previous.url});}
      if(previous.status==='open')await stripe.checkout.sessions.expire(previous.id);
      if(previous.status==='complete'){
        if(previous.payment_status!=='paid')throw Object.assign(new Error('Your previous payment is still processing. Please wait before starting another checkout.'),{status:409});
        await fulfil(client,stripe,previous.id,user.id);
      }
    }
    const existing=(await client.query("SELECT * FROM commercial_subscriptions WHERE user_id=$1 AND status NOT IN ('canceled','incomplete_expired') ORDER BY verified_at DESC LIMIT 1",[user.id])).rows[0];
    const legacy=(await client.query("SELECT 1 FROM billing_subscriptions WHERE user_id=$1 AND status NOT IN ('canceled','incomplete_expired') LIMIT 1",[user.id])).rows.length;

    if(legacy||(!user.billing_managed&&user.paid_at))throw Object.assign(new Error('Your existing plan is preserved. Contact support to switch without creating a second subscription.'),{status:409});

    let url;

    if(existing&&plan!=='payg'){

      const sub=await stripe.subscriptions.retrieve(existing.id);

      if(existing.plan==='starter'&&plan==='pro'){

        const portal=await stripe.billingPortal.sessions.create({configuration:PORTAL_CONFIG,customer:existing.customer_id,return_url:'https://profitquote.co.uk/dashboard?billing=return',
          flow_data:{type:'subscription_update_confirm',subscription_update_confirm:{subscription:sub.id,items:[{id:sub.items.data[0].id,price:await priceFor(stripe,'pro'),quantity:1}]}}});

        url=portal.url;

      }else{url=(await stripe.billingPortal.sessions.create({configuration:PORTAL_CONFIG,customer:existing.customer_id,return_url:'https://profitquote.co.uk/dashboard?billing=return'})).url;}
    }else{

      const metadata={app:'profitquote-v2',plan,reference:user.billing_reference};

      const session=await stripe.checkout.sessions.create({mode:plan==='payg'?'payment':'subscription',client_reference_id:user.billing_reference,

        ...(user.stripe_customer_id?{customer:user.stripe_customer_id}:{customer_email:user.email}),

        line_items:[{price:await priceFor(stripe,plan),quantity:1}],metadata,

        ...(plan==='payg'?{}:{subscription_data:{metadata}}),

        success_url:'https://profitquote.co.uk/dashboard?session_id={CHECKOUT_SESSION_ID}',cancel_url:'https://profitquote.co.uk/dashboard?billing=cancelled',

        integration_identifier:'profitquote_'+crypto.randomBytes(8).toString('hex').replace(/[0-9]/g,'a')},

        {idempotencyKey:`pq-checkout-${user.id}-${plan}-${pending?.session_id||'first'}-${Math.floor(Date.now()/1800000)}`});
      url=session.url;
      await client.query('INSERT INTO commercial_checkouts(user_id,session_id,plan) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET session_id=EXCLUDED.session_id,plan=EXCLUDED.plan',[user.id,session.id,plan]);
    }

    await client.query('COMMIT');res.json({url});

  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}

}

async function handleEvent(req,event){

  const object=event.data.object,db=req.app.locals.pool;
  if(event.type==='charge.refunded'&&object.payment_intent){
    await db.query('UPDATE commercial_payments SET credit_available=false WHERE payment_intent=$1',[object.payment_intent]);
    return true;
  }
  if(object.metadata?.app==='profitquote-v2'&&object.object==='checkout.session')return fulfil(db,stripeFor(req),object.id);

  const id=object.object==='subscription'?object.id:object.parent?.subscription_details?.subscription||object.subscription;

  if(id){

    if(object.metadata?.app==='profitquote-v2'||(await db.query('SELECT 1 FROM commercial_subscriptions WHERE id=$1',[id])).rows.length){

      const client=await db.connect();

      try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[id]);await syncSubscription(client,stripeFor(req),id);await client.query('COMMIT');return true;}

      catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}

    }

  }

  return false;

}

module.exports={PLANS,stripeFor,priceFor,syncSubscription,fulfil,checkout,handleEvent,refresh};
