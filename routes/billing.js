const express=require('express');
const crypto=require('crypto');
const auth=require('../middleware/auth');
const {access,publicAccess,MONTHLY_LINK,UUID}=require('../utils/quote-access');
const router=express.Router();
// Keep recognising existing subscriptions while new checkouts use £37/month.
const PRICES=new Set(['price_1TZX0w8466uzy1MNeVvWz2Ew','price_1UHgUj8466uzy1MNcCnTWJbi']);
const PAYMENT_LINKS=new Set(['plink_1TZX128466uzy1MNZEoilqdL','plink_1UHgWz8466uzy1MNDtQyGajQ']);
router.get('/status',auth,async(req,res)=>{
  try{res.set('Cache-Control','no-store').json(publicAccess(await access(req.app.locals.pool,req.user)));}
  catch(e){res.status(e.status||500).json({error:e.message});}
});
router.post('/checkout',auth,async(req,res)=>{
  if(req.user.guest) return res.status(403).json({error:'Create your free account first.'});
  try{
    const a=await access(req.app.locals.pool,req.user);
    if(a.subscribed) return res.json({subscribed:true});
    const url=new URL(MONTHLY_LINK);
    url.searchParams.set('client_reference_id',a.owner.billing_reference);
    url.searchParams.set('prefilled_email',a.owner.email);
    res.json({url:url.toString()});
  }catch(e){res.status(e.status||500).json({error:e.message});}
});

function verifySignature(raw,header,secret){
  if(!secret||!Buffer.isBuffer(raw)) throw new Error('Webhook is not configured');
  const parts=String(header||'').split(',');
  const timestamp=parts.find(p=>p.startsWith('t='))?.slice(2);
  if(!/^\d+$/.test(timestamp||'')||Math.abs(Date.now()/1000-Number(timestamp))>300) throw new Error('Invalid webhook timestamp');
  const expected=crypto.createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
  const valid=parts.filter(p=>p.startsWith('v1=')).some(p=>{
    const hex=p.slice(3);return /^[a-f0-9]{64}$/i.test(hex)&&crypto.timingSafeEqual(expected,Buffer.from(hex,'hex'));
  });
  if(!valid) throw new Error('Invalid webhook signature');
  return JSON.parse(raw.toString('utf8'));
}

async function webhook(req,res){
  let event;
  try{event=verifySignature(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);}
  catch(e){return res.status(400).json({error:'Invalid webhook'});}
  if(event.livemode!==true||!event.id||!Number.isInteger(event.created)) return res.status(400).json({error:'Invalid event'});
  const object=event.data?.object;
  if(!object) return res.status(400).json({error:'Missing event data'});
  const subscriptionEvent=['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed'].includes(event.type);
  const checkoutEvent=['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type);
  if(!subscriptionEvent&&!checkoutEvent) return res.json({received:true});
  if(subscriptionEvent&&!object.items?.data?.some(item=>PRICES.has(item.price?.id))) return res.json({received:true});
  if(checkoutEvent&&(!PAYMENT_LINKS.has(object.payment_link)||object.mode!=='subscription'||object.payment_status!=='paid'||!UUID.test(object.client_reference_id||''))) return res.json({received:true});
  const subId=subscriptionEvent?object.id:object.subscription;
  if(typeof subId!=='string'||!subId.startsWith('sub_')||typeof object.customer!=='string') return res.status(400).json({error:'Invalid subscription'});
  const client=await req.app.locals.pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[subId]);
    const inserted=await client.query('INSERT INTO billing_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',[event.id]);
    if(!inserted.rows.length){await client.query('COMMIT');return res.json({received:true});}
    await client.query('INSERT INTO billing_subscriptions(id,customer_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[subId,object.customer]);
    if(checkoutEvent){
      const user=(await client.query('SELECT id FROM users WHERE billing_reference=$1',[object.client_reference_id])).rows[0];
      if(user){
        await client.query('UPDATE billing_subscriptions SET user_id=$1,checkout_paid=true WHERE id=$2 AND (user_id IS NULL OR user_id=$1)',[user.id,subId]);
        await client.query('UPDATE users SET billing_managed=true,stripe_customer_id=$1,paid_at=COALESCE(paid_at,NOW()) WHERE id=$2',[object.customer,user.id]);
        await client.query("INSERT INTO events(event_type,user_id,source) VALUES('subscription_started',$1,'stripe_webhook')",[user.id]);
      }
    }else{
      const item=object.items.data.find(item=>PRICES.has(item.price?.id));
      const periodEnd=item.current_period_end||object.current_period_end;
      const status=event.type==='customer.subscription.deleted'?'canceled':object.pause_collection?'paused':object.status;
      await client.query("UPDATE billing_subscriptions SET status=$1,period_end=$2,event_created=$3 WHERE id=$4 AND event_created<=$3 AND (status<>'canceled' OR $1='canceled') AND (NOT $5 OR event_created=0)",[status,periodEnd?new Date(periodEnd*1000):null,event.created,subId,event.type==='customer.subscription.created']);
    }
    await client.query('COMMIT');
    res.json({received:true});
  }catch(e){await client.query('ROLLBACK');console.error('Billing webhook processing failed');res.status(500).json({error:'Webhook processing failed'});}
  finally{client.release();}
}
module.exports={router,webhook,verifySignature};
