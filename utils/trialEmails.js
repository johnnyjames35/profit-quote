const https = require('https');
const { isFreeOnboardingOfferActive } = require('./onboarding-offer');

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

function isSundayInLondon(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short'
  }).format(now) === 'Sun';
}

async function hasCompletedQuote(pool, userId) {
  const result = await pool.query('SELECT 1 FROM quotes WHERE user_id=$1 LIMIT 1', [userId]);
  return result.rows.length > 0;
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

function day3Email(name, email, activated) {
  if (activated) {
    return sendBrevoEmail(email,
      "Nice one on your first quote",
      `<p>Hi ${name},</p>
<p>Saw you've already built your first quote in ProfitQuote — that's the hard part done.</p>
<p>A couple of things worth trying next: mark a quote Won or Lost once you hear back from the customer, and use the variation order feature if the job scope changes partway through.</p>
<p><a href="https://profitquote.co.uk">Build another quote</a></p>
<p>John James<br>ProfitQuote | Cambrian Digital</p>`
    );
  }
  return sendBrevoEmail(email,
    "Stuck on a quote? Here's a 2-minute walkthrough",
    `<p>Hi ${name},</p>
<p>Just checking in — if you haven't built a quote yet, it only takes about 10 minutes and no card is needed during your trial.</p>
<p>Add the job description, check the hidden costs it flags for you, and send the finished quote straight to your customer.</p>
<p><a href="https://profitquote.co.uk">Try it now</a></p>
<p>John James<br>ProfitQuote | Cambrian Digital</p>`
  );
}

function day7Email(name, email, activated, now = new Date()) {
  const paymentSteps = isFreeOnboardingOfferActive(now)
    ? `<p><strong>Free onboarding is available until 30 September 2026.</strong> There is no £99 setup fee during the offer.</p>
<p><strong>Continue with your £37/month subscription:</strong><br>
<a href="https://profitquote.co.uk/dashboard?subscribe=1">Start £37/month subscription</a></p>`
    : `<p><strong>Step 1 — Pay the £99 one-off onboarding fee:</strong><br>
<a href="https://buy.stripe.com/eVq00d6z96TcdzN9QUc3m0b">Pay £99 onboarding fee</a></p>
<p><strong>Step 2 — Set up your £37/month subscription:</strong><br>
<a href="https://profitquote.co.uk/dashboard?subscribe=1">Start £37/month subscription</a></p>`;

  const intro = activated
    ? `<p>Your free allowance includes three quotes, with a subscription required to create quote four. If ProfitQuote has been useful, here's how to keep going:</p>`
    : `<p>Your free allowance includes three quotes, with no time limit. If you haven't had a chance to try it properly yet, just reply to this email and I'll personally help you get your first quote done — no pressure either way. If you'd like to keep going:</p>`;

  return sendBrevoEmail(email,
    "Your three free ProfitQuote quotes",
    `<p>Hi ${name},</p>
${intro}
${paymentSteps}
<p>Reply to this email any time if you have questions — happy to help personally.</p>
<p>John James<br>ProfitQuote | Cambrian Digital</p>`
  );
}

function sendJohnStuckAlert(name, email, daysSince) {
  const firstName = String(name || '').split(' ')[0] || name;
  return sendBrevoEmail(
    process.env.ADMIN_EMAIL || 'hello@cambriandigital.co.uk',
    `ProfitQuote: ${name} hasn't tried it yet — message ready to send`,
    `<p>${name} (${email}) signed up ${daysSince} days ago and hasn't built a quote yet.</p>
<p>Copy the message below and send it to them directly at ${email}:</p>
<hr>
<p>Hi ${firstName},<br>
Saw you signed up for ProfitQuote a couple of days ago — just wanted to check in and see if you've had a chance to try it, or if you got stuck anywhere.</p>
<p>If it's easier, I'm happy to jump on a quick call and get your first quote built together, no cost. Just let me know what works.</p>
<p>John</p>
<hr>
<p><em>Sent automatically by ProfitQuote's trial monitoring.</em></p>`
  );
}

async function checkAndSendTrialEmails(pool, now = new Date()) {
  // Customer/prospect email is deliberately suppressed on Sundays in Europe/London.
  // Because stages are eligible once their due day has been reached, a Sunday-due
  // message remains eligible and is sent on Monday rather than being discarded.
  if (isSundayInLondon(now)) {
    console.log('Trial email scheduler: Sunday in Europe/London — sends deferred until Monday');
    return;
  }

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
    { days: 1, type: 'day1', send: (name, email) => day1Email(name, email) },
    { days: 3, type: 'day3', send: (name, email, activated) => day3Email(name, email, activated) },
    { days: 7, type: 'day7', send: (name, email, activated) => day7Email(name, email, activated, now) }
  ];

  for (const user of result.rows) {
    const started = new Date(user.trial_started_at);
    const daysSince = Math.floor((now - started) / (1000 * 60 * 60 * 24));
    const activated = await hasCompletedQuote(pool, user.id);

    // Internal alert to John — not sent to the customer — when someone is
    // two or more days into their trial and still hasn't built a quote.
    if (daysSince >= 2 && !activated) {
      const alreadyAlerted = await pool.query(
        'SELECT 1 FROM trial_email_log WHERE user_id=$1 AND email_type=$2',
        [user.id, 'day2_stuck_alert']
      );
      if (!alreadyAlerted.rows.length) {
        try {
          await sendJohnStuckAlert(user.name, user.email, daysSince);
          await pool.query(
            'INSERT INTO trial_email_log (user_id, email_type) VALUES ($1,$2)',
            [user.id, 'day2_stuck_alert']
          );
          console.log(`Sent day2_stuck_alert for ${user.email}`);
        } catch (e) {
          console.error(`Failed to send day2_stuck_alert for ${user.email}:`, e.message);
        }
      }
    }

    for (const stage of stages) {
      // >= ensures an email that became due on Sunday is deferred to Monday.
      if (daysSince >= stage.days) {
        const already = await pool.query(
          'SELECT 1 FROM trial_email_log WHERE user_id=$1 AND email_type=$2',
          [user.id, stage.type]
        );
        if (!already.rows.length) {
          try {
            await stage.send(user.name, user.email, activated);
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
  console.log('Trial nudge email scheduler started (checks hourly; Sunday sends deferred)');
}

module.exports = { checkAndSendTrialEmails, startTrialEmailScheduler, isSundayInLondon, day7Email };
