const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const LIMIT = 3;
const MONTHLY_LINK = 'https://buy.stripe.com/14AcMZf5F4L453h8MQc3m0x';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const ipHash = req => digest(`${process.env.JWT_SECRET}|signup-ip|${req.ip||''}`);

function setTrialCookie(res,id){
  res.cookie('pq_trial',jwt.sign({id,purpose:'quote-trial'},process.env.JWT_SECRET,{expiresIn:'365d'}),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:365*86400000,path:'/'});
}
async function browserTrial(db, req, res) {
  let cookieId;
  try {
    const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('pq_trial='))?.slice(9);
    const value=jwt.verify(raw,process.env.JWT_SECRET);
    if(value.purpose==='quote-trial'&&UUID.test(value.id)) cookieId=value.id;
  } catch {}
  const browserId=String(req.body?.browser_id||'');
  const hash=/^[a-zA-Z0-9_-]{12,100}$/.test(browserId)?digest(`${process.env.JWT_SECRET}|browser|${browserId}`):null;
  // Serialize trial creation for the same browser; the signed cookie survives localStorage changes.
  if(hash) await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[hash]);
  let id=cookieId&&(await db.query('SELECT id FROM quote_allowances WHERE id=$1',[cookieId])).rows[0]?.id;
  if(!id&&hash) id=(await db.query('SELECT trial_id FROM trial_browsers WHERE browser_hash=$1',[hash])).rows[0]?.trial_id;
  if(!id){id=crypto.randomUUID();await db.query('INSERT INTO quote_allowances(id) VALUES($1)',[id]);}
  if(hash) await db.query('INSERT INTO trial_browsers(browser_hash,trial_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[hash,id]);
  setTrialCookie(res,id);
  return id;
}

async function access(db, user, lock=false) {
  const table=user.guest?'guest_sessions':'users';
  const result=await db.query(`SELECT * FROM ${table} WHERE id=$1${lock?' FOR UPDATE':''}`,[user.id]);
  const owner=result.rows[0];
  if(!owner||(user.guest&&(owner.converted_user_id||new Date(owner.expires_at)<=new Date()))) throw Object.assign(new Error('Please sign in again.'),{status:401});
  // Also supports accounts/sessions inserted by older tooling after migration.
  if(!owner.trial_id){
    owner.trial_id=crypto.randomUUID();
    const count=await db.query(`SELECT COUNT(*)::int AS used FROM quotes WHERE ${user.guest?'guest_id':'user_id'}=$1`,[user.id]);
    await db.query('INSERT INTO quote_allowances(id,used,trial_started_at) VALUES($1,$2,$3)',[owner.trial_id,user.guest?Math.max(owner.quote_count,count.rows[0].used):count.rows[0].used,user.guest?null:owner.trial_started_at]);
    await db.query(`UPDATE ${table} SET trial_id=$1 WHERE id=$2`,[owner.trial_id,user.id]);
  }
  const allowance=(await db.query(`SELECT used,trial_started_at FROM quote_allowances WHERE id=$1${lock?' FOR UPDATE':''}`,[owner.trial_id])).rows[0];
  let subscribed=false;
  if(!user.guest){
    const paid=await db.query("SELECT 1 FROM billing_subscriptions WHERE user_id=$1 AND status='active' AND checkout_paid=true AND period_end>NOW() LIMIT 1",[user.id]);
    // Preserve explicit existing admin grants; Stripe-managed accounts must have a live entitlement.
    const bundle=await db.query('SELECT enabled,valid_until FROM trade_bundle_access WHERE user_id=$1',[user.id]);
    subscribed=bundle.rows.length ? bundle.rows[0].enabled&&new Date(bundle.rows[0].valid_until)>new Date()
      : !!paid.rows.length||(!owner.billing_managed&&!!owner.paid_at);
  }
  const now=new Date();
  const trialEnd=allowance.trial_started_at ? new Date(new Date(allowance.trial_started_at).getTime()+7*86400000) : null;
  const trialActive=trialEnd && now<trialEnd;
  const subscription=!user.guest && (await db.query("SELECT * FROM commercial_subscriptions WHERE user_id=$1 AND status='active' AND period_end>NOW() ORDER BY CASE plan WHEN 'pro' THEN 0 ELSE 1 END,period_end DESC LIMIT 1",[user.id])).rows[0];
  const management=!user.guest && (await db.query("SELECT plan FROM commercial_subscriptions WHERE user_id=$1 AND status NOT IN ('canceled','incomplete_expired') ORDER BY verified_at DESC LIMIT 1",[user.id])).rows[0];
  const credits=user.guest?0:(await db.query('SELECT COUNT(*)::int AS n FROM commercial_payments WHERE user_id=$1 AND credit_available=true',[user.id])).rows[0].n;
  const periodUsed=subscription?(await db.query('SELECT COUNT(*)::int AS n FROM commercial_usage WHERE user_id=$1 AND subscription_id=$2 AND period_start=$3',[user.id,subscription.id,subscription.period_start])).rows[0].n:0;
  const unlimited=subscribed||trialActive||subscription?.plan==='pro';
  const remaining=unlimited?null:user.guest?0:Math.max(0,(subscription?6-periodUsed:0))+credits;
  return {owner,trial_id:owner.trial_id,used:allowance.used,remaining,subscribed:subscribed||!!subscription,
    can_create:unlimited||remaining>0,unlimited,trial_active:!!trialActive,trial_ends_at:trialEnd,
    plan:subscribed?'legacy':subscription?.plan||(trialActive?'trial':'payg'),management_plan:management?.plan||null,subscription,period_used:periodUsed,credits};
}

function limitError(guest=false){return Object.assign(new Error(guest?'Your seven days of free use have ended. Choose £5 per quote, £19/month Starter (6 quotes), or £29/month Pro (unlimited).':'Choose £5 for one quote, £19/month Starter (6 quotes), or £29/month Pro (unlimited).'),{status:402,code:guest?'trial_expired':'subscription_required'});}
async function consume(db,a,user){
  if(!a.can_create) throw limitError(user.guest);
  if(user.guest){await db.query('UPDATE quote_allowances SET used=used+1 WHERE id=$1',[a.trial_id]);return;}
  if(a.unlimited)return;
  if(a.subscription && a.period_used<6){
    await db.query('INSERT INTO commercial_usage(user_id,subscription_id,period_start) VALUES($1,$2,$3)',[user.id,a.subscription.id,a.subscription.period_start]);
  }else{
    const result=await db.query('UPDATE commercial_payments SET credit_available=false WHERE session_id=(SELECT session_id FROM commercial_payments WHERE user_id=$1 AND credit_available=true ORDER BY created_at LIMIT 1 FOR UPDATE) RETURNING session_id',[user.id]);
    if(!result.rows.length)throw limitError();
  }
}
function publicAccess(a){return {quotes_used:a.used,quotes_remaining:a.remaining,subscribed:a.subscribed,
  can_create:a.can_create,unlimited:a.unlimited,billing_plan:a.plan,billing_management_plan:a.management_plan,trial_active:a.trial_active,trial_ends_at:a.trial_ends_at,
  period_quotes_used:a.period_used,payg_credits:a.credits,period_ends_at:a.subscription?.period_end||null,
  subscription_required:!a.can_create};}
module.exports={LIMIT,MONTHLY_LINK,UUID,digest,ipHash,browserTrial,setTrialCookie,access,consume,limitError,publicAccess};
