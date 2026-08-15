const https = require('https');
const { getDailyTrafficReport } = require('./google-reporting');
const TIME_ZONE = 'Europe/London';
const CHECK_INTERVAL_MS = 60 * 1000;

function londonParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}
function shiftDate(date, days) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function pct(current, baseline) { if (!baseline) return current ? 'new' : '0%'; const value = ((current - baseline) / baseline) * 100; return `${value >= 0 ? '+' : ''}${value.toFixed(0)}%`; }
function rate(value, total) { return total ? `${((value / total) * 100).toFixed(1)}%` : '0%'; }
function rows(items, label, value) { return items.length ? items.slice(0, 5).map((item) => `<tr><td>${escapeHtml(item[label])}</td><td>${escapeHtml(item[value])}</td></tr>`).join('') : '<tr><td colspan="2">None</td></tr>'; }
function products(env = process.env) { return [
  { key: 'profitquote', name: 'ProfitQuote', hostname: env.PROFITQUOTE_GA4_HOSTNAME || env.GA4_HOSTNAME || 'profitquote.co.uk', siteUrl: env.SEARCH_CONSOLE_SITE_URL },
  { key: 'callback', name: 'CallbackApp', hostname: env.CALLBACK_GA4_HOSTNAME || 'callbackapp.co.uk', siteUrl: env.CALLBACK_SEARCH_CONSOLE_SITE_URL || 'sc-domain:callbackapp.co.uk' },
  { key: 'latepay', name: 'LatePay', hostname: env.LATEPAY_GA4_HOSTNAME || 'latepay.co.uk', siteUrl: env.LATEPAY_SEARCH_CONSOLE_SITE_URL || 'sc-domain:latepay.co.uk' },
  { key: 'zenflo', name: 'Zenflo', hostname: env.ZENFLO_GA4_HOSTNAME || 'zenflo.co.uk', siteUrl: env.ZENFLO_SEARCH_CONSOLE_SITE_URL || 'https://zenflo.co.uk/' }
]; }

async function funnelForDate(pool, date) {
  const result = await pool.query(`SELECT event_type, COUNT(*)::int AS count FROM events WHERE created_at >= $1::date AND created_at < $1::date + INTERVAL '1 day' AND event_type = ANY($2) GROUP BY event_type`, [date, ['page_viewed', 'trial_click', 'account_created', 'first_quote', 'subscription_started']]);
  const values = { visitors: 0, trialClicks: 0, accounts: 0, firstQuotes: 0, paid: 0 };
  const map = { page_viewed: 'visitors', trial_click: 'trialClicks', account_created: 'accounts', first_quote: 'firstQuotes', subscription_started: 'paid' };
  for (const row of result.rows) values[map[row.event_type]] = row.count;
  return values;
}
function alertsFor(report, previous, weekAgo, funnel) {
  const alerts = [];
  if (weekAgo.ga4.sessions && report.ga4.sessions < weekAgo.ga4.sessions * 0.7) alerts.push(`Sessions are down ${pct(report.ga4.sessions, weekAgo.ga4.sessions)} versus the same day last week.`);
  const unassigned = report.ga4.trafficSources.find((row) => row.source === 'Unassigned')?.sessions || 0;
  if (report.ga4.sessions && unassigned / report.ga4.sessions >= 0.25) alerts.push(`${rate(unassigned, report.ga4.sessions)} of sessions are Unassigned; review campaign tagging.`);
  const notSet = report.ga4.landingPages.find((row) => row.page === '(not set)')?.sessions || 0;
  if (report.ga4.sessions && notSet / report.ga4.sessions >= 0.25) alerts.push(`${rate(notSet, report.ga4.sessions)} of sessions have no landing page.`);
  if (previous.searchConsole.impressions && !report.searchConsole.impressions) alerts.push('Search Console impressions fell to zero versus the prior comparison day.');
  if (funnel?.visitors && !funnel.accounts) alerts.push('Traffic was recorded but no accounts were created.');
  return alerts;
}
async function loadProduct(product, date) {
  const previousDate = shiftDate(date, -1), weekDate = shiftDate(date, -7);
  try {
    const [report, previous, weekAgo] = await Promise.all([
      getDailyTrafficReport({ date, searchConsoleDate: shiftDate(date, -2), hostname: product.hostname, siteUrl: product.siteUrl }),
      getDailyTrafficReport({ date: previousDate, searchConsoleDate: shiftDate(date, -3), hostname: product.hostname, siteUrl: product.siteUrl }),
      getDailyTrafficReport({ date: weekDate, searchConsoleDate: shiftDate(date, -9), hostname: product.hostname, siteUrl: product.siteUrl })
    ]);
    return { ...product, report, previous, weekAgo, alerts: alertsFor(report, previous, weekAgo) };
  } catch (error) { return { ...product, error: error.message, alerts: [`Reporting connection failed: ${error.message}`] }; }
}
function reportHtml({ portfolio, date, funnel, previousFunnel, weekFunnel }) {
  const alerts = portfolio.flatMap((item) => item.alerts.map((alert) => `${item.name}: ${alert}`));
  const scoreRows = portfolio.map((item) => item.error
    ? `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td colspan="6">Unavailable — ${escapeHtml(item.error)}</td></tr>`
    : `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${item.report.ga4.users}</td><td>${item.report.ga4.sessions}</td><td>${pct(item.report.ga4.sessions, item.previous.ga4.sessions)}</td><td>${pct(item.report.ga4.sessions, item.weekAgo.ga4.sessions)}</td><td>${item.report.searchConsole.clicks}</td><td>${item.report.searchConsole.impressions}</td></tr>`).join('');
  const details = portfolio.filter((item) => !item.error).map((item) => `<h3>${escapeHtml(item.name)}</h3>
    <p><strong>Traffic sources</strong></p><table cellpadding="6"><tr><th>Source</th><th>Sessions</th></tr>${rows(item.report.ga4.trafficSources, 'source', 'sessions')}</table>
    <p><strong>Landing pages</strong></p><table cellpadding="6"><tr><th>Page</th><th>Sessions</th></tr>${rows(item.report.ga4.landingPages, 'page', 'sessions')}</table>
    <p><strong>Top search queries</strong></p><table cellpadding="6"><tr><th>Query</th><th>Clicks</th></tr>${rows(item.report.searchConsole.topQueries, 'query', 'clicks')}</table>`).join('');
  const alertHtml = alerts.length ? `<h3>Needs attention</h3><ul>${alerts.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>` : '<p><strong>No threshold alerts triggered.</strong></p>';
  return `<h2>Four-product morning performance brief</h2><p>Traffic date: <strong>${date}</strong> (GA4 provisional) · Search Console date: <strong>${shiftDate(date, -2)}</strong></p>
    <table cellpadding="6"><tr><th>Product</th><th>Users</th><th>Sessions</th><th>Day</th><th>Week</th><th>Search clicks</th><th>Impressions</th></tr>${scoreRows}</table>
    ${alertHtml}<h3>ProfitQuote customer funnel — ${date}</h3>
    <table cellpadding="6"><tr><th>Stage</th><th>Count</th><th>Day</th><th>Week</th></tr>
    <tr><td>Visitors</td><td>${funnel.visitors}</td><td>${pct(funnel.visitors, previousFunnel.visitors)}</td><td>${pct(funnel.visitors, weekFunnel.visitors)}</td></tr>
    <tr><td>Trial clicks</td><td>${funnel.trialClicks}</td><td>${pct(funnel.trialClicks, previousFunnel.trialClicks)}</td><td>${pct(funnel.trialClicks, weekFunnel.trialClicks)}</td></tr>
    <tr><td>Accounts</td><td>${funnel.accounts}</td><td>${pct(funnel.accounts, previousFunnel.accounts)}</td><td>${pct(funnel.accounts, weekFunnel.accounts)}</td></tr>
    <tr><td>First quotes</td><td>${funnel.firstQuotes}</td><td>${pct(funnel.firstQuotes, previousFunnel.firstQuotes)}</td><td>${pct(funnel.firstQuotes, weekFunnel.firstQuotes)}</td></tr>
    <tr><td>Paid</td><td>${funnel.paid}</td><td>${pct(funnel.paid, previousFunnel.paid)}</td><td>${pct(funnel.paid, weekFunnel.paid)}</td></tr></table>
    <p><strong>Visitor → account:</strong> ${rate(funnel.accounts, funnel.visitors)} · <strong>Account → first quote:</strong> ${rate(funnel.firstQuotes, funnel.accounts)} · <strong>Account → paid:</strong> ${rate(funnel.paid, funnel.accounts)}</p>
    ${details}<p style="color:#666">GA4 may continue processing. Search Console uses data three days old for completeness. Generated automatically at 8:00 AM UK time.</p>`;
}
function sendBrevoEmail(to, subject, htmlContent) { return new Promise((resolve, reject) => { const data = JSON.stringify({ sender: { name: 'Cambrian Digital', email: 'hello@profitquote.co.uk' }, to: [{ email: to }], subject, htmlContent }); const request = https.request({ hostname: 'api.brevo.com', path: '/v3/smtp/email', method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY } }, (response) => { response.resume(); response.on('end', () => response.statusCode >= 200 && response.statusCode < 300 ? resolve() : reject(new Error(`Brevo request failed (${response.statusCode})`))); }); request.on('error', reject); request.write(data); request.end(); }); }

async function runDailyBrief(pool, date) {
  await pool.query(`CREATE TABLE IF NOT EXISTS daily_reporting_runs (report_date DATE PRIMARY KEY, started_at TIMESTAMPTZ DEFAULT NOW(), sent_at TIMESTAMPTZ)`);
  await pool.query('ALTER TABLE daily_reporting_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW()');
  const claim = await pool.query(`INSERT INTO daily_reporting_runs (report_date, started_at) VALUES ($1, NOW()) ON CONFLICT (report_date) DO UPDATE SET started_at=NOW() WHERE daily_reporting_runs.sent_at IS NULL AND daily_reporting_runs.started_at < NOW() - INTERVAL '15 minutes' RETURNING report_date`, [date]);
  if (!claim.rows.length) return;
  try {
    const previousDate = shiftDate(date, -1), weekDate = shiftDate(date, -7);
    const [portfolio, funnel, previousFunnel, weekFunnel] = await Promise.all([
      Promise.all(products().map((product) => loadProduct(product, date))),
      funnelForDate(pool, date), funnelForDate(pool, previousDate), funnelForDate(pool, weekDate)
    ]);
    const alertCount = portfolio.reduce((sum, item) => sum + item.alerts.length, 0);
    const html = reportHtml({ portfolio, date, funnel, previousFunnel, weekFunnel });
    await sendBrevoEmail(process.env.ADMIN_EMAIL || 'hello@cambriandigital.co.uk', `Four-product performance brief — ${date}${alertCount ? ` (${alertCount} alert${alertCount === 1 ? '' : 's'})` : ''}`, html);
    await pool.query('UPDATE daily_reporting_runs SET sent_at=NOW() WHERE report_date=$1', [date]);
    console.log(`Four-product traffic brief sent for ${date}`);
  } catch (error) { await pool.query('DELETE FROM daily_reporting_runs WHERE report_date=$1 AND sent_at IS NULL', [date]); throw error; }
}
function startDailyTrafficEmailScheduler(pool) {
  async function check() { const parts = londonParts(); if (Number(parts.hour) < 8 || Number(parts.hour) >= 12) return; const today = `${parts.year}-${parts.month}-${parts.day}`; try { await runDailyBrief(pool, shiftDate(today, -1)); } catch (error) { console.error('Daily traffic email error:', error.message); } }
  check(); const timer = setInterval(check, CHECK_INTERVAL_MS); timer.unref?.(); console.log('Four-product traffic email scheduled for 08:00 Europe/London with morning catch-up');
}
module.exports = { startDailyTrafficEmailScheduler, londonParts, reportHtml, shiftDate, alertsFor, products };
