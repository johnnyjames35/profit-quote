const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const https = require('https');
const crypto = require('crypto');
const {browserTrial,setTrialCookie,access,publicAccess,ipHash}=require('../utils/quote-access');
const { sendToGA } = require('../utils/ga');
const { isFreeOnboardingOfferActive } = require('../utils/onboarding-offer');

const USER_FIELDS = 'id,name,email,trade,plan,day_rate,hourly_rate,overhead_per_day,markup_percent,profit_target,vat_registered,vat_rate,skip_clean,skip_mixed,skip_plasterboard,skip_inert,skip_hazardous,business_name,phone,contact_email,town,trial_started_at,paid_at';

function sendBrevoEmail(to, subject, html) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      sender: { name: 'ProfitQuote', email: 'hello@profitquote.co.uk' },
      to: [{ email: to }],
      subject,
      htmlContent: html
    });
    const options = {
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
      }
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendWelcomeEmail(name, email) {
  const onboardingItem = isFreeOnboardingOfferActive()
    ? '<li>Personal setup included free until 30 September 2026</li>'
    : '<li>£99 one-off onboarding fee</li>';
  return sendBrevoEmail(email,
    'Welcome to ProfitQuote — your first three quotes are included',
    `<p>Hi ${name},</p>
<p>Welcome to ProfitQuote! Your first three quotes are included. Quotes created before signup count towards the same allowance.</p>
<p>You can log in any time at <a href="https://profitquote.co.uk">profitquote.co.uk</a></p>
<p>To create quote four and keep quoting, you'll need:</p>
<ul>
${onboardingItem}
<li>£37/month subscription</li>
</ul>
<p>Your existing quotes stay available when your free allowance is used.</p>
<p>John James<br>ProfitQuote | Cambrian Digital</p>`
  );
}

function sendNotifyJohnEmail(name, email) {
  return sendBrevoEmail(
    process.env.ADMIN_EMAIL || 'hello@cambriandigital.co.uk',
    `New ProfitQuote trial started — ${name}`,
    `<p>New user signed up for ProfitQuote:</p>
<p><strong>Name:</strong> ${name}<br>
<strong>Email:</strong> ${email}</p>
<p>Their three-quote free allowance is available now. Guest quotes count towards the same allowance.</p>`
  );
}

function sendResetEmail(name, email, resetLink) {
  return sendBrevoEmail(email,
    'Reset your ProfitQuote password',
    `<p>Hi ${name},</p>
<p>We received a request to reset your ProfitQuote password.</p>
<p><a href="${resetLink}">Click here to set a new password</a></p>
<p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
<p>John James<br>ProfitQuote | Cambrian Digital</p>`
  );
}

function logEvent(pool, eventType, userId, source) {
  return pool.query(
    'INSERT INTO events (event_type, user_id, source) VALUES ($1,$2,$3)',
    [eventType, userId || null, source || null]
  ).then(() => sendToGA(eventType, userId, source))
   .catch(e => console.error('Event log error:', e.message));
}

router.post('/register', async (req, res) => {
  const { name, email, password, trade, source, guest_token } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  try {
    const pool = req.app.locals.pool;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<6) return res.status(400).json({error:'Enter a valid email and a password of at least six characters.'});
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(400).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    let guest=null;
    if(guest_token){
      try{ guest=jwt.verify(guest_token,process.env.JWT_SECRET); }
      catch(e){ return res.status(400).json({error:'Your guest session has expired. Please return to your quote before signing up.'}); }
      if(!guest.guest||!guest.id) return res.status(400).json({error:'Invalid guest session.'});
    }
    const client=await pool.connect();
    let user;
    try{
      await client.query('BEGIN');
      const network=ipHash(req);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[network]);
      const attempts=await client.query("SELECT COUNT(*)::int AS n FROM signup_attempts WHERE ip_hash=$1 AND created_at>NOW()-INTERVAL '24 hours'",[network]);
      if(attempts.rows[0].n>=5) throw Object.assign(new Error('Too many accounts created from this connection today. Please sign in or try again tomorrow.'),{status:429});
      let trialId;
      if(guest){
        const session=await client.query('SELECT id,trial_id FROM guest_sessions WHERE id=$1 AND expires_at>NOW() AND converted_user_id IS NULL FOR UPDATE',[guest.id]);
        if(!session.rows.length) throw new Error('Your guest session is no longer available. Please sign in if you already created an account.');
      }
      if(guest){ const a=await access(client,guest,true); trialId=a.trial_id; setTrialCookie(res,trialId); }
      else trialId=await browserTrial(client,req,res);
      const result=await client.query(
        `INSERT INTO users (name,email,password_hash,trade,trial_started_at)
         VALUES ($1,$2,$3,$4,NOW()) RETURNING ${USER_FIELDS}`,
        [name,email.toLowerCase(),hash,trade||'']
      );
      user=result.rows[0];
      await client.query('UPDATE users SET trial_id=$1 WHERE id=$2',[trialId,user.id]);
      await client.query('INSERT INTO signup_attempts(ip_hash) VALUES($1)',[network]);
      if(guest){
        await client.query('UPDATE quotes SET user_id=$1,guest_id=NULL WHERE guest_id=$2',[user.id,guest.id]);
        await client.query('UPDATE guest_sessions SET converted_user_id=$1,last_active_at=NOW() WHERE id=$2',[user.id,guest.id]);
        await client.query("INSERT INTO events(event_type,user_id,source,meta) VALUES('guest_converted',$1,'guest',jsonb_build_object('guest_id',$2::text))",[user.id,guest.id]);
      }
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK');
      throw error;
    }finally{ client.release(); }
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user });

    logEvent(pool, 'account_created', user.id, source);
    sendWelcomeEmail(name, email).catch(e => console.error('Welcome email error:', e.message));
    sendNotifyJohnEmail(name, email).catch(e => console.error('Notify email error:', e.message));

  } catch(e) {
    res.status(e.status||500).json({ error: e.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid email or password' });
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ error: 'Invalid email or password' });

    await pool.query(
      'UPDATE users SET first_login_at=COALESCE(first_login_at,NOW()), last_active_at=NOW() WHERE id=$1',
      [user.id]
    );
    user.first_login_at = user.first_login_at || new Date();
    user.last_active_at = new Date();

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    delete user.password_hash;
    res.json({ token, user });

    const alreadyLogged = await pool.query(
      "SELECT 1 FROM events WHERE event_type='first_login' AND user_id=$1",
      [user.id]
    );
    if (!alreadyLogged.rows.length) {
      logEvent(pool, 'first_login', user.id, null);
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query('SELECT id,name,email FROM users WHERE email=$1', [email.toLowerCase()]);
    if (result.rows.length) {
      const user = result.rows[0];
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000);
      await pool.query('UPDATE users SET reset_token=$1, reset_token_expires=$2 WHERE id=$3', [hashedToken, expires, user.id]);
      const resetLink = `https://profitquote.co.uk/dashboard?reset=${rawToken}`;
      sendResetEmail(user.name, user.email, resetLink).catch(e => console.error('Reset email error:', e.message));
    }
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and new password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const pool = req.app.locals.pool;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query('SELECT id FROM users WHERE reset_token=$1 AND reset_token_expires > NOW()', [hashedToken]);
    if (!result.rows.length) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    const user = result.rows[0];
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2', [hash, user.id]);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', require('../middleware/auth'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const client=await pool.connect();
    let a;
    try{await client.query('BEGIN');a=await access(client,req.user,true);await client.query('COMMIT');}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    if(req.user.guest) return res.json({id:req.user.id,guest:true,name:'Guest',trade:'',plan:'guest',day_rate:200,hourly_rate:35,overhead_per_day:50,markup_percent:20,profit_target:30,vat_rate:0,business_name:'',phone:'',contact_email:'',town:'',guest_quotes_used:a.used,guest_quotes_remaining:a.remaining,...publicAccess(a)});
    const result = await pool.query(
      `SELECT ${USER_FIELDS} FROM users WHERE id=$1`,
      [req.user.id]
    );
    res.json({...result.rows[0],...publicAccess(a)});
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
