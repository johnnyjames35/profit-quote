// Shared by the three apps. This module only READS Stripe; it never charges,
// cancels, refunds or edits a customer's subscription.
const BUNDLE_PRICE = 'price_1UHgrl8466uzy1MNJ2L0eqAV';
const PRICES = {
  price_1TZX0w8466uzy1MNeVvWz2Ew: ['profitquote','solo',1],
  price_1UHgUj8466uzy1MNcCnTWJbi: ['profitquote','solo',1],
  price_1UHgVS8466uzy1MNFKXS6fFW: ['latepay','starter',10],
  price_1TI6Dp8466uzy1MN2HVFlpHL: ['latepay','starter',10],
  price_1TI6Hg8466uzy1MNJU7X22uz: ['latepay','standard',30],
  price_1TI6Jb8466uzy1MNyOq4FMwX: ['latepay','pro',100],
  price_1UHgVX8466uzy1MNTaf98YS5: ['callback','starter',50],
  price_1UGRRm8466uzy1MNCTRh9Nd1: ['callback','starter',50],
  price_1UGRS98466uzy1MNKAQMX8gF: ['callback','plus',200]
};
const idOf = value => typeof value === 'string' ? value : value?.id;
const emailOf = value => String(value || '').trim().toLowerCase();
const endOf = sub => Math.max(0, sub.current_period_end || 0, ...(sub.items?.data || []).map(i => i.current_period_end || 0));
const isOpen = sub => !['canceled','incomplete_expired'].includes(sub.status);
const paid = sub => sub.status === 'active' && sub.latest_invoice?.status === 'paid' && !sub.pause_collection;

async function migrate(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS trade_bundle_access (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    subscription_id TEXT UNIQUE NOT NULL, customer_id TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE, valid_until TIMESTAMPTZ,
    plan TEXT NOT NULL DEFAULT 'starter', allowance INTEGER NOT NULL DEFAULT 0,
    stripe_status TEXT NOT NULL DEFAULT 'pending', warning TEXT NOT NULL DEFAULT '',
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

function createBundleBilling({ db, stripe, app, now = () => Date.now() }) {
  async function account(userId, customerId, verifyEmail=true) {
    if (!stripe) throw new Error('Stripe access is not configured for bundle checks.');
    if (!/^cus_[A-Za-z0-9]+$/.test(customerId || '')) throw new Error('Enter the Stripe customer ID.');
    const user = (await db.query('SELECT * FROM users WHERE id=$1',[userId])).rows[0];
    if (!user) throw new Error('Account not found.');
    const customer = await stripe.customers.retrieve(customerId);
    if(customer.deleted && !verifyEmail)return {user,customer:{...customer,email:user.email},subscriptions:[]};
    if (customer.deleted || customer.livemode !== true || (verifyEmail && emailOf(customer.email) !== emailOf(user.email))) throw new Error('The Stripe customer email must match this app account. Verify the customer before linking.');
    const ids = new Set([customerId]);
    if (user.stripe_customer_id) ids.add(user.stripe_customer_id);
    if (user.stripe_subscription_id) ids.add(idOf((await stripe.subscriptions.retrieve(user.stripe_subscription_id)).customer));
    // Include duplicate Stripe customer records with the same email.
    for await (const item of (customer.email ? stripe.customers.list({email:customer.email,limit:100}) : [])) ids.add(item.id);
    const subscriptions = [];
    for (const id of ids) {
      for await (const sub of stripe.subscriptions.list({customer:id,status:'all',limit:100,expand:['data.latest_invoice']})) subscriptions.push(sub);
    }
    return {user,customer,subscriptions};
  }

  function preflight(subscriptions, except) {
    const blockers = [], existing = [];
    let paidThrough = 0;
    for (const sub of subscriptions.filter(s => s.id !== except && isOpen(s))) {
      const items = sub.items?.data || [];
      if (items.some(i => idOf(i.price) === BUNDLE_PRICE)) blockers.push(`Another bundle subscription is still open: ${sub.id}.`);
      if (!items.some(i => PRICES[idOf(i.price)])) {
        if (!items.some(i=>idOf(i.price)===BUNDLE_PRICE)) blockers.push(`Review unrecognised subscription ${sub.id} before switching; it may duplicate a trade product.`);
        continue;
      }
      const end = sub.status === 'trialing' ? sub.trial_end : endOf(sub);
      existing.push({id:sub.id,status:sub.status,endsAt:end ? new Date(end*1000).toISOString() : null,cancelsAtPeriodEnd:!!sub.cancel_at_period_end});
      if (!sub.cancel_at_period_end) blockers.push(`Disable the next renewal in Stripe for ${sub.id} before switching.`);
      if (sub.schedule) blockers.push(`Review and finish the subscription schedule for ${sub.id} before switching.`);
      if (!end || !['active','trialing'].includes(sub.status)) blockers.push(`Resolve ${sub.id} (${sub.status}) before switching.`);
      paidThrough = Math.max(paidThrough,end || 0);
    }
    return {blockers,existing,paidThrough};
  }

  async function check(userId, customerId) {
    const data = await account(userId,customerId);
    const bundles=data.subscriptions.filter(s=>isOpen(s)&&(s.items?.data || []).some(i=>idOf(i.price)===BUNDLE_PRICE));
    const check = preflight(data.subscriptions,bundles.length===1?bundles[0].id:undefined);
    return {customerId,customerName:data.customer.name || '',email:data.customer.email,...check,
      earliestChargeAt:check.paidThrough ? new Date(check.paidThrough*1000).toISOString() : null};
  }

  async function inspect(userId, customerId, subscriptionId, linking) {
    if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId || '')) throw new Error('Enter the Stripe subscription ID.');
    const {user,customer,subscriptions} = await account(userId,customerId,linking);
    const sub = await stripe.subscriptions.retrieve(subscriptionId,{expand:['latest_invoice']});
    if (sub.livemode !== true || idOf(sub.customer) !== customerId) throw new Error('Bundle subscription does not belong to this Stripe customer.');
    const items = sub.items?.data || [];
    const validPrice = items.length === 1 && items[0].quantity === 1 && idOf(items[0].price) === BUNDLE_PRICE;
    if (linking && !validPrice) throw new Error('Only the £49/month Trade Toolkit subscription can be linked.');
    const migration = preflight(subscriptions,sub.id);
    if (linking && migration.blockers.length) throw new Error(migration.blockers.join(' '));
    if (linking && migration.paidThrough > now()/1000 && !(sub.status === 'trialing' && sub.trial_end >= migration.paidThrough)) throw new Error('Delay the bundle first charge until all existing paid/trial periods end. Use a Stripe trial ending no earlier than '+new Date(migration.paidThrough*1000).toISOString()+'.');
    let validUntil = validPrice && (paid(sub) || (sub.status === 'trialing' && !sub.pause_collection))
      ? (sub.status === 'trialing' ? sub.trial_end : endOf(sub)) : 0;
    let plan = app === 'profitquote' ? 'solo' : 'starter';
    let allowance = app === 'latepay' ? 10 : app === 'callback' ? 50 : 1;
    // Preserve an existing higher tier for the time already paid for.
    for (const native of subscriptions.filter(s=>s.id!==sub.id && paid(s) && endOf(s)>now()/1000)) {
      for (const item of native.items?.data || []) {
        const tier = PRICES[idOf(item.price)];
        if (tier?.[0] !== app) continue;
        validUntil = Math.max(validUntil || 0,endOf(native));
        if (tier[2] > allowance) {plan=tier[1];allowance=tier[2];}
      }
    }
    return {userId:user.id,customerId,subscriptionId,email:customer.email,customerName:customer.name || '',
      enabled:validUntil>now()/1000,validUntil:validUntil?new Date(validUntil*1000).toISOString():null,
      plan,allowance,stripeStatus:sub.status,warning:migration.blockers.join(' '),existing:migration.existing};
  }

  async function apply(client, result) {
    await client.query(`UPDATE trade_bundle_access SET enabled=$2,valid_until=$3,plan=$4,allowance=$5,
      stripe_status=$6,warning=$7,checked_at=NOW() WHERE user_id=$1`,[result.userId,result.enabled,result.validUntil,result.plan,result.allowance,result.stripeStatus,result.warning]);
    if (app === 'profitquote') return;
    await client.query(`UPDATE users SET plan=$2,${app==='latepay'?'sms_limit=$4,billing_managed=TRUE,':''}
      account_status=CASE WHEN account_status='frozen' THEN 'frozen' ELSE $3 END WHERE id=$1`,
    app==='latepay'?[result.userId,result.plan,result.enabled?'active':'locked',result.allowance]:[result.userId,result.plan,result.enabled?'active':'locked']);
  }

  async function link(userId, customerId, subscriptionId) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
      const previous=(await client.query('SELECT subscription_id FROM trade_bundle_access WHERE user_id=$1',[userId])).rows[0];
      if (previous && previous.subscription_id !== subscriptionId && isOpen(await stripe.subscriptions.retrieve(previous.subscription_id))) throw new Error('The previous bundle is still open. End it in Stripe before linking a replacement.');
      const result = await inspect(userId,customerId,subscriptionId,true);
      if (!result.enabled) throw new Error('The bundle is not paid or in an active trial. Resolve billing before linking.');
      await client.query(`INSERT INTO trade_bundle_access(user_id,subscription_id,customer_id) VALUES($1,$2,$3)
        ON CONFLICT(user_id) DO UPDATE SET subscription_id=EXCLUDED.subscription_id,customer_id=EXCLUDED.customer_id`,[userId,subscriptionId,customerId]);
      await apply(client,result);await client.query('COMMIT');return result;
    } catch (error) {await client.query('ROLLBACK');throw error;}
    finally {client.release();}
  }

  async function sync(userId) {
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
      const row=(await client.query('SELECT * FROM trade_bundle_access WHERE user_id=$1',[userId])).rows[0];
      if (row) await apply(client,await inspect(userId,row.customer_id,row.subscription_id,false));
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK');throw error;}
    finally {client.release();}
  }

  async function expire() {
    await db.query('UPDATE trade_bundle_access SET enabled=FALSE WHERE valid_until IS NULL OR valid_until<=NOW()');
    if (app !== 'profitquote') await db.query(`UPDATE users SET account_status='locked' WHERE account_status<>'frozen'
      AND id IN(SELECT user_id FROM trade_bundle_access WHERE enabled=FALSE)`);
  }

  let busy=false;
  async function reconcile() {
    if(busy)return;busy=true;
    try {
      await expire();
      const rows=await db.query('SELECT user_id FROM trade_bundle_access');
      for(const row of rows.rows) {
        try{await sync(row.user_id);}catch(error){console.error('Bundle check failed for account',row.user_id,error.type || error.message);}
      }
    } finally{busy=false;}
  }
  const hasBinding = async userId => !!(await db.query('SELECT 1 FROM trade_bundle_access WHERE user_id=$1',[userId])).rows.length;
  async function nativeUpdate(userId,sql,params) {
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
      const bound=(await client.query('SELECT 1 FROM trade_bundle_access WHERE user_id=$1',[userId])).rows.length;
      if(!bound)await client.query(sql,params);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
  function register(router, auth, prefix='/api/admin/users') {
    router.post(prefix+'/:id/bundle/check',auth,async(req,res)=>{
      try{res.json(await check(Number(req.params.id),req.body.customerId));}catch(e){res.status(400).json({error:e.message});}
    });
    router.post(prefix+'/:id/bundle',auth,async(req,res)=>{
      try{
        const fn=req.body.confirm===true?link:(id,c,s)=>inspect(id,c,s,true);
        res.json(await fn(Number(req.params.id),req.body.customerId,req.body.subscriptionId));
      }catch(e){res.status(400).json({error:e.code==='23505'?'This bundle is already linked to another account.':e.message});}
    });
    router.get(prefix+'/:id/bundle',auth,async(req,res)=>{
      try{await sync(Number(req.params.id));await expire();res.json((await db.query('SELECT * FROM trade_bundle_access WHERE user_id=$1',[Number(req.params.id)])).rows[0] || null);}
      catch(e){res.status(503).json({error:'Stripe could not be checked. Existing access is limited to the last verified expiry. '+e.message});}
    });
  }
  return {check,inspect,link,sync,expire,reconcile,hasBinding,nativeUpdate,register};
}
module.exports={migrate,createBundleBilling,BUNDLE_PRICE};
