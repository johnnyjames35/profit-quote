const https = require('https');

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

function day1Email(name, email) {
  return sendBrevoEmail(email,
    "Quick tip for your first ProfitQuote quote",
    `<p>Hi ${name},</p>
     <p>You started your ProfitQuote trial yesterday — here's the fastest way to get value from it.</p>
     <p>Describe your next job in as much detail as you can (materials, measurements, labour) and ProfitQuote will price it properly and check for costs people usually forget.</p>
     <p><a href="https://profitquote.co.uk">Build your next quote</a></p>
     <p>John James<br>ProfitQuote | Cambrian Digital</p>`
  );
}

function day3Email(name, email) {
  return sendBrevoEmail(email,
    "Stuck on a quote? Here's a 2-minute walkthrough",
    `<p>Hi ${name},</p>
     <p>Just checking in — if you haven't built a quote yet, it only takes about 10 minutes and no card is needed during your trial.</p>
     <p>Add the job description, check the hidden costs it flags for you, and send the finished quote straight to your customer.</p>
     <p><a href="https://profitquote.co.uk">Try it now</a></p>
     <p>John James<br>ProfitQuote | Cambrian Digital</p>`
  );
}

function day7Email(name, email) {
  return sendBrevoEmail(email,
    "Your ProfitQuote free trial period is ending",
    `<p>Hi ${name},</p>
     <p>Your 7-day free trial period is coming to an end. If ProfitQuote has been useful, here's how to keep going:</p>
     <p><strong>Step 1 — Pay the £99 one-off onboarding fee:</strong><br>
     <a href="https://buy.stripe.com/eVq00d6z96TcdzN9QUc3m0b">Pay £99 onboarding fee</a></p>
     <p><strong>Step 2 — Set up your £49/month subscription:</strong><br>
     <a href="https://buy.stripe.com/4gMdR32iTb9s67l2osc3m0a">Start £49/month subscription</a></p>
     <p>Reply to this email any time if you have questions — happy to help personally.</p>
     <p>John James<br>ProfitQuote | Cambrian Digital</p>`
  );
}

async function checkAndSendTrialEmails(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trial_email_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      email_type TEXT NOT NULL,
      sent_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, email_type)
    )
  `);

  const result = await pool.query(
    'SELECT id, name, email, trial_started_at FROM users WHERE paid_at IS NULL AND trial_started_at IS NOT NULL'
  );

  const stages = [
    { days: 1, type: 'day1', send: day1Email },
    { days: 3, type: 'day3', send: day3Email },
    { days: 7, type: 'day7', send: day7Email }
  ];

  for (const user of result.rows) {
    const started = new Date(user.trial_started_at);
    const now = new Date();
    const daysSince = Math.floor((now - started) / (1000 * 60 * 60 * 24));

    for (const stage of stages) {
      if (daysSince === stage.days) {
        const already = await pool.query(
          'SELECT 1 FROM trial_email_log WHERE user_id=$1 AND email_type=$2',
          [user.id, stage.type]
        );
        if (!already.rows.length) {
          try {
            await stage.send(user.name, user.email);
            await pool.query(
              'INSERT INTO trial_email_log (user_id, email_type) VALUES ($1,$2)',
              [user.id, stage.type]
            );
            console.log(`Sent ${stage.type} email to ${user.email}`);
          } catch (e) {
            console.error(`Failed to send ${stage.type} email to ${user.email}:`, e.message);
          }
        }
      }
    }
  }
}

function startTrialEmailScheduler(pool) {
  async function check() {
    try {
      await checkAndSendTrialEmails(pool);
    } catch (error) {
      console.error('Trial email scheduler error:', error.message);
    }
  }
  check();
  const timer = setInterval(check, 60 * 60 * 1000);
  timer.unref?.();
  console.log('Trial nudge email scheduler started (checks hourly)');
}

module.exports = { checkAndSendTrialEmails, startTrialEmailScheduler };
