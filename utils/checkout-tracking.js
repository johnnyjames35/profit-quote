const crypto = require('node:crypto');
const {sendToGA,requestContext} = require('./ga');

module.exports = async function trackedCheckout(req, res) {
  const db=req.app.locals.pool, id=crypto.randomUUID();
  const plan=['payg','starter','pro'].includes(req.body?.plan || 'pro') ? (req.body?.plan || 'pro') : 'invalid';
  try {
    await db.query(`INSERT INTO checkout_attempts(id,user_id,guest_id,plan) VALUES($1,
      (SELECT id FROM users WHERE id=$2),$3,$4)`,[id,req.user.guest?null:req.user.id,req.user.guest?req.user.id:null,plan]);
  } catch (_) { return res.status(503).json({error:'Checkout is temporarily unavailable. Please try again.'}); }
  let status=200, body;
  const response={status(code){status=code;return this;},json(value){body=value;return this;}};
  try { await require('./commercial-billing').checkout(req,response); }
  catch (error) {
    status=Number.isInteger(error.status) && error.status>=400 && error.status<=599 ? error.status : 503;
    body={error:error.status?error.message:'Checkout is temporarily unavailable. Please try again or contact support.'};
  }
  const opened=status===200 && typeof body?.url==='string' && /^https:\/\//.test(body.url);
  if (!opened && status<400) {status=503;body={error:'Checkout is temporarily unavailable. Please try again.'};}
  const failure=opened?null:status===400?'invalid_request':status===403?'account_required':status===409?'billing_conflict':'provider_unavailable';
  try {
    // The terminal outcome and its event are committed together, once per request.
    await db.query(`WITH done AS (UPDATE checkout_attempts SET outcome=$2,http_status=$3,failure_code=$4,completed_at=NOW()
      WHERE id=$1 AND outcome='pending' RETURNING user_id,guest_id,plan)
      INSERT INTO events(event_type,user_id,source,meta)
      SELECT $5,user_id,'billing_server',jsonb_build_object('attempt_id',$1::text,'plan',plan,'failure_code',$4::text) FROM done`,
      [id,opened?'opened':'failed',status,failure,opened?'checkout_opened':'checkout_failed']);
  } catch (_) {
    // A pending row means the outcome is uncertain; never invent a failure or start a second payment.
    return res.status(503).json({error:'Checkout status could not be confirmed. Please retry; an open checkout will be reused.'});
  }
  if(opened) void sendToGA('checkout_started',req.user.guest?null:req.user.id,'billing_server',requestContext(req));
  else void sendToGA('checkout_failed',req.user.guest?null:req.user.id,'billing_server',requestContext(req));
  res.set('Cache-Control','private, no-store');
  return res.status(status).json(body);
};
