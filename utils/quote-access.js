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
    await db.query('INSERT INTO quote_allowances(id,used) VALUES($1,$2)',[owner.trial_id,user.guest?Math.max(owner.quote_count,count.rows[0].used):count.rows[0].used]);
    await db.query(`UPDATE ${table} SET trial_id=$1 WHERE id=$2`,[owner.trial_id,user.id]);
  }
  const allowance=(await db.query(`SELECT used FROM quote_allowances WHERE id=$1${lock?' FOR UPDATE':''}`,[owner.trial_id])).rows[0];
  let subscribed=false;
  if(!user.guest){
    const paid=await db.query("SELECT 1 FROM billing_subscriptions WHERE user_id=$1 AND status='active' AND checkout_paid=true AND period_end>NOW() LIMIT 1",[user.id]);
    // Preserve explicit existing admin grants; Stripe-managed accounts must have a live entitlement.
    subscribed=!!paid.rows.length||(!owner.billing_managed&&!!owner.paid_at);
  }
  return {owner,trial_id:owner.trial_id,used:allowance.used,remaining:Math.max(0,LIMIT-allowance.used),subscribed};
}

function limitError(guest=false){return Object.assign(new Error(guest?'Create your free account to keep your quotes and subscribe to continue.':'Your three free quotes are used. Subscribe to create your next quote.'),{status:402,code:guest?'guest_limit':'subscription_required'});}
function publicAccess(a){return {quotes_used:a.used,quotes_remaining:a.remaining,subscribed:a.subscribed,subscription_required:!a.subscribed&&a.remaining===0};}
module.exports={LIMIT,MONTHLY_LINK,UUID,digest,ipHash,browserTrial,setTrialCookie,access,limitError,publicAccess};
