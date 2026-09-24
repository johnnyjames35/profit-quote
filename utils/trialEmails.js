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
      res.on('end', () => res.statusCode>=200&&res.statusCode<300?resolve(body):reject(new Error('Email delivery failed: '+res.statusCode)));
    });
    req.on('error', reject);
    req.setTimeout?.(20000,()=>req.destroy(new Error('Email provider timeout')));
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

const {stageFor,message}=require('./trial-message');
const crypto=require('crypto');
function optoutToken(id){return crypto.createHmac('sha256',process.env.JWT_SECRET).update('trial-optout:'+id).digest('hex');}
async function checkAndSendTrialEmails(pool,now=new Date(),deliver=sendBrevoEmail){
  if(isSundayInLondon(now))return;
  const rows=await pool.query('SELECT id FROM users WHERE trial_started_at>$1 AND trial_started_at<=$2 AND trial_emails_enabled=true',[new Date(now-14*86400000),now]);
  for(const row of rows.rows){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)',[row.id]);
      const user=(await client.query('SELECT * FROM users WHERE id=$1',[row.id])).rows[0];
      const a=await require('./quote-access').access(client,{id:user.id});
      const converted=(await client.query('SELECT 1 FROM commercial_payments WHERE user_id=$1 LIMIT 1',[user.id])).rows.length;
      if(a.subscribed||converted||user.paid_at||!user.trial_emails_enabled){await client.query('COMMIT');continue;}
      const activated=(await client.query('SELECT 1 FROM quotes WHERE user_id=$1 LIMIT 1',[user.id])).rows.length>0;
      const stage=stageFor((now-new Date(user.trial_started_at))/86400000,activated);
      if(!stage||(await client.query('SELECT 1 FROM trial_campaign_log WHERE user_id=$1 AND stage=$2',[user.id,stage])).rows.length){await client.query('COMMIT');continue;}
      const msg=message(stage,String(user.name||'').split(' ')[0]);
      msg.html+=`<p><a href="https://profitquote.co.uk/api/billing/email-preferences?id=${user.id}&token=${optoutToken(user.id)}">Stop trial tips and reminders</a></p>`;
      await deliver(user.email,msg.subject,msg.html);
      await client.query('INSERT INTO trial_campaign_log(user_id,stage) VALUES($1,$2)',[user.id,stage]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');console.error('Trial email failed for account',row.id,e.message);}
    finally{client.release();}
  }
}
function startTrialEmailScheduler(pool){
  let busy=false;
  async function check(){if(busy)return;busy=true;try{await checkAndSendTrialEmails(pool);}catch(e){console.error('Trial scheduler:',e.message);}finally{busy=false;}}
  check();const timer=setInterval(check,15*60*1000);timer.unref?.();
}
module.exports={checkAndSendTrialEmails,startTrialEmailScheduler,isSundayInLondon,optoutToken};
