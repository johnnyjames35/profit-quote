const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const USER_FIELDS = 'id,name,email,trade,plan,day_rate,hourly_rate,markup_percent,profit_target,vat_registered,skip_clean,skip_mixed,skip_plasterboard,skip_inert,skip_hazardous,business_name,phone,contact_email,town,trial_started_at,paid_at';

function getMailer() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.ionos.co.uk',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

async function sendWelcomeEmail(name, email) {
  const mailer = getMailer();
  await mailer.sendMail({
    from: `"ProfitQuote" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Welcome to ProfitQuote — your 7-day free trial starts now',
    html: `
      <p>Hi ${name},</p>
      <p>Welcome to ProfitQuote! Your 7-day free trial has started.</p>
      <p>You can log in any time at <a href="https://profitquote.co.uk">profitquote.co.uk</a></p>
      <p>After your trial, you'll need:</p>
      <ul>
        <li>£99 one-off onboarding fee</li>
        <li>£49/month subscription</li>
      </ul>
      <p>I'll be in touch before your trial ends to get you set up personally.</p>
      <p>Any questions — just reply to this email.</p>
      <p>John James<br>ProfitQuote | Cambrian Digital</p>
    `
  });
}

async function sendNotifyJohnEmail(name, email) {
  const mailer = getMailer();
  await mailer.sendMail({
    from: `"ProfitQuote" <${process.env.EMAIL_USER}>`,
    to: process.env.ADMIN_EMAIL || 'hello@cambriandigital.co.uk',
    subject: `New ProfitQuote trial started — ${name}`,
    html: `
      <p>New user signed up for ProfitQuote:</p>
      <p><strong>Name:</strong> ${name}<br>
      <strong>Email:</strong> ${email}</p>
      <p>Their 7-day trial starts today. Chase them on day 6!</p>
    `
  });
}

async function sendTrialExpiryEmail(name, email) {
  const mailer = getMailer();
  await mailer.sendMail({
    from: `"ProfitQuote" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your ProfitQuote trial expires tomorrow',
    html: `
      <p>Hi ${name},</p>
      <p>Your 7-day free trial expires tomorrow.</p>
      <p>To keep using ProfitQuote you'll need to complete your onboarding:</p>
      <p><strong>Step 1 — Pay the £99 one-off onboarding fee:</strong><br>
      <a href="https://buy.stripe.com/eVq00d6z96TcdzN9QUc3m0b">Pay £99 onboarding fee</a></p>
      <p><strong>Step 2 — Set up your £49/month subscription:</strong><br>
      <a href="https://buy.stripe.com/4gMdR32iTb9s67l2osc3m0a">Start £49/month subscription</a></p>
      <p>Once you've paid I'll personally set you up and make sure everything is running perfectly.</p>
      <p>John James<br>ProfitQuote | Cambrian Digital</p>
    `
  });
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

    // Send emails (don't block registration if email fails)
    try {
      await sendWelcomeEmail(name, email);
      await sendNotifyJohnEmail(name, email);
    } catch(emailErr) {
      console.error('Email error:', emailErr.message);
    }

    res.json({ token, user });
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

    // Check if trial expires tomorrow (day 6) — send warning email
    if (!user.paid_at) {
      const started = new Date(user.trial_started_at);
      const now = new Date();
      const daysSince = Math.floor((now - started) / (1000 * 60 * 60 * 24));
      if (daysSince === 6) {
        try { await sendTrialExpiryEmail(user.name, user.email); } catch(e) {}
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
