const router = require('express').Router();
const https = require('https');

// This is the "secret" — it lives only in this URL, not copied from Stripe.
// Your Stripe webhook endpoint URL must end in exactly this:
const WEBHOOK_SECRET_SLUG = 'pq-544f2eaa71dedba8';

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

function notifyPaid(name, email) {
  return sendBrevoEmail(
    process.env.ADMIN_EMAIL || 'hello@cambriandigital.co.uk',
    `🎉 ${name} just paid — ProfitQuote`,
    `<p>Payment received via Stripe:</p>
     <p><strong>Name:</strong> ${name}<br>
     <strong>Email:</strong> ${email}</p>
     <p>They've been automatically marked as paid — no action needed.</p>`
  );
}

function notifyCancelled(email) {
  return sendBrevoEmail(
    process.env.ADMIN_EMAIL || 'hello@cambriandigital.co.uk',
    `ProfitQuote subscription cancelled — ${email}`,
    `<p>A ProfitQuote subscription was cancelled via Stripe:</p>
     <p><strong>Email:</strong> ${email}</p>
     <p>This has been logged automatically. Their access has not been removed.</p>`
  );
}

function logEvent(pool, eventType, userId) {
  return pool.query(
    'INSERT INTO events (event_type, user_id, source) VALUES ($1,$2,$3)',
    [eventType, userId || null, 'stripe_webhook']
  ).catch(e => console.error('Event log error:', e.message));
}

// Mounted at /webhook in server.js, so the full path is:
// /webhook/pq-544f2eaa71dedba8
router.post('/:secret', async (req, res) => {
  if (req.params.secret !== WEBHOOK_SECRET_SLUG) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Always acknowledge fast so Stripe doesn't retry — do the work after.
  res.json({ received: true });

  const pool = req.app.locals.pool;
  const event = req.body;

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = (session.customer_details && session.customer_details.email) || session.customer_email;
      const customerId = session.customer;
      if (!email) return;

      const result = await pool.query(
        'SELECT id, name, paid_at FROM users WHERE email=$1',
        [email.toLowerCase()]
      );
      const user = result.rows[0];
      if (!user) {
        console.error('Stripe webhook: no ProfitQuote user found for email', email);
        return;
      }

      await pool.query(
        'UPDATE users SET paid_at = COALESCE(paid_at, NOW()), stripe_customer_id = $1 WHERE id=$2',
        [customerId, user.id]
      );
      logEvent(pool, 'subscription_started', user.id);
      notifyPaid(user.name, email).catch(e => console.error('Paid notify email error:', e.message));

    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      const result = await pool.query(
        'SELECT id, email FROM users WHERE stripe_customer_id=$1',
        [customerId]
      );
      const user = result.rows[0];
      if (!user) {
        console.error('Stripe webhook: no ProfitQuote user found for customer', customerId);
        return;
      }

      logEvent(pool, 'subscription_cancelled', user.id);
      notifyCancelled(user.email).catch(e => console.error('Cancel notify email error:', e.message));
    }
  } catch(e) {
    console.error('Stripe webhook processing error:', e.message);
  }
});

module.exports = router;
