const https = require('https');
const { getDailyTrafficReport } = require('./google-reporting');

const TIME_ZONE = 'Europe/London';
const CHECK_INTERVAL_MS = 60 * 1000;

function londonParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function rows(items, label, value) {
  if (!items.length) return '<tr><td colspan="2">None</td></tr>';
  return items.slice(0, 5).map((item) =>
    `<tr><td>${escapeHtml(item[label])}</td><td>${escapeHtml(item[value])}</td></tr>`
  ).join('');
}

function reportHtml(report) {
  return `
    <h2>ProfitQuote daily traffic brief — ${escapeHtml(report.date)}</h2>
    <p><strong>GA4:</strong> ${report.ga4.users} users · ${report.ga4.sessions} sessions</p>
    <p><strong>Search Console:</strong> ${report.searchConsole.clicks} clicks · ${report.searchConsole.impressions} impressions · average position ${report.searchConsole.averagePosition}</p>
    <h3>Traffic sources</h3><table cellpadding="6"><tr><th align="left">Source</th><th align="left">Sessions</th></tr>${rows(report.ga4.trafficSources, 'source', 'sessions')}</table>
    <h3>Landing pages</h3><table cellpadding="6"><tr><th align="left">Page</th><th align="left">Sessions</th></tr>${rows(report.ga4.landingPages, 'page', 'sessions')}</table>
    <h3>Top search queries</h3><table cellpadding="6"><tr><th align="left">Query</th><th align="left">Clicks</th></tr>${rows(report.searchConsole.topQueries, 'query', 'clicks')}</table>
    <p style="color:#666">Generated automatically at 8:00 AM UK time.</p>`;
}

function sendBrevoEmail(to, subject, htmlContent) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      sender: { name: 'ProfitQuote', email: 'hello@profitquote.co.uk' },
      to: [{ email: to }], subject, htmlContent
    });
    const request = https.request({
      hostname: 'api.brevo.com', path: '/v3/smtp/email', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY }
    }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve();
        reject(new Error(`Brevo request failed (${response.statusCode})`));
      });
    });
    request.on('error', reject);
    request.write(data);
    request.end();
  });
}

async function runDailyBrief(pool, date) {
  await pool.query(`CREATE TABLE IF NOT EXISTS daily_reporting_runs (
    report_date DATE PRIMARY KEY,
    sent_at TIMESTAMPTZ
  )`);
  const claim = await pool.query(
    'INSERT INTO daily_reporting_runs (report_date) VALUES ($1) ON CONFLICT DO NOTHING RETURNING report_date',
    [date]
  );
  if (!claim.rows.length) return;
  try {
    const report = await getDailyTrafficReport({ date });
    const recipient = process.env.ADMIN_EMAIL || 'hello@cambriandigital.co.uk';
    await sendBrevoEmail(recipient, `ProfitQuote traffic brief — ${date}`, reportHtml(report));
    await pool.query('UPDATE daily_reporting_runs SET sent_at=NOW() WHERE report_date=$1', [date]);
    console.log(`Daily traffic brief sent for ${date}`);
  } catch (error) {
    await pool.query('DELETE FROM daily_reporting_runs WHERE report_date=$1 AND sent_at IS NULL', [date]);
    throw error;
  }
}

function startDailyTrafficEmailScheduler(pool) {
  async function check() {
    const parts = londonParts();
    if (parts.hour !== '08' || Number(parts.minute) > 9) return;
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const reportDate = new Date(`${today}T12:00:00Z`);
    reportDate.setUTCDate(reportDate.getUTCDate() - 1);
    try { await runDailyBrief(pool, reportDate.toISOString().slice(0, 10)); }
    catch (error) { console.error('Daily traffic email error:', error.message); }
  }
  check();
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  timer.unref?.();
  console.log('Daily traffic email scheduled for 08:00 Europe/London');
}

module.exports = { startDailyTrafficEmailScheduler, londonParts, reportHtml };
