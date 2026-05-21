const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const https = require('https');

const USER_FIELDS = 'id,name,email,trade,plan,day_rate,hourly_rate,markup_percent,profit_target,vat_registered,skip_clean,skip_mixed,skip_plasterboard,skip_inert,skip_hazardous,business_name,phone,contact_email,town,trial_started_at,paid_at';

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
  return sendBrevoEmail(email,
    'Welcome to ProfitQuote — your 7-day free trial starts now',
    `<p>Hi ${name},</p>
     <p>Welcome to ProfitQuote! Your 7-day free trial has started.</p>
     <p>You can log in any time at <a href="https://profitquote.co.uk">profitquote.co.uk</a></p>
     <p>After your trial, you'll need:</p>
     <ul>
       <li>£99 one-off onboarding fee</li>
       <li>£49/month subscription</li>
     </ul>
     <p>I'll be in touch before your trial ends to get you set up personally.</p>
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
     <p>Their 7-day trial starts today. Chase them on day 6!</p>`
  );
}

function sendTrialExpiryEmail(name, email) {
  return sendBrevoEmail(email,
    'Your ProfitQuote trial expires tomorrow',
    `<p>Hi ${name},</p>
     <p>Your 7-day free trial expires tomorrow.</p>
     <p>To keep using ProfitQuote you'll need to complete your onboarding:</p>
     <p><strong>Step 1 — Pay the £99 one-off onboarding fee:</strong><br>
     <a href="https://buy.stripe.com/eVq00d6z96TcdzN9QUc3m0b">Pay £99 onboarding fee</a></p>
     <p><strong>Step 2 — Set up your £49/month subscription:</strong><br>
     <a href="https://buy.stripe.com/4gMdR32iTb9s67l2osc3m0a">Start £49/month subscription</a></p>
     <p>Once you've paid I'll personally set you up and make sure everything is running perfectly.</p>
     <p>John James<br>ProfitQuote | Cambrian Digital</p>`
  );
}

router.post('/register', async (req, res) => {
  const { name, email, password, trade } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  try {
    const pool = req.app.locals.pool;
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(400).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name,email,password_hash,trade,trial_started_at)
       VALUES ($1,$2,$3,$4,NOW())
       RETURNING ${USER_FIELDS}`,
      [name, email.toLowerCase(), hash, trade || '']
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user });

    sendWelcomeEmail(name, email).catch(e => console.error('Welcome email error:', e.message));
    sendNotifyJohnEmail(name, email).catch(e => console.error('Notify email error:', e.message));

  } catch(e) {
    res.status(500).json({ error: e.message });
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

    if (!user.paid_at) {
      const started = new Date(user.trial_started_at);
      const now = new Date();
      const daysSince = Math.floor((now - started) / (1000 * 60 * 60 * 24));
      if (daysSince === 6) {
        sendTrialExpiryEmail(user.name, user.email).catch(e => console.error('Expiry email error:', e.message));
      }
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
    delete user.password_hash;
    res.json({ token, user });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', require('../middleware/auth'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT ${USER_FIELDS} FROM users WHERE id=$1`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
