const crypto = require('crypto');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GA4_API_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const SEARCH_CONSOLE_API_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/webmasters.readonly'];
let cachedToken = null;

function base64url(value) { return Buffer.from(value).toString('base64url'); }
function loadConfig(env = process.env) {
  const required = ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GA4_PROPERTY_ID', 'SEARCH_CONSOLE_SITE_URL'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing reporting configuration: ${missing.join(', ')}`);
  let credentials;
  try { credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON); }
  catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
  if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not a valid service account credential');
  return { credentials: { ...credentials, private_key: credentials.private_key.replace(/\\n/g, '\n') }, propertyId: env.GA4_PROPERTY_ID, siteUrl: env.SEARCH_CONSOLE_SITE_URL, hostname: env.GA4_HOSTNAME || 'profitquote.co.uk' };
}
function validateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('date must use YYYY-MM-DD');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('date must be a real calendar date');
  return date;
}
function yesterday() { return new Date(Date.now() - 86400000).toISOString().slice(0, 10); }
async function getAccessToken(credentials, fetchImpl) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({ iss: credentials.client_email, scope: SCOPES.join(' '), aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claim}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), credentials.private_key).toString('base64url');
  const response = await fetchImpl(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }) });
  if (!response.ok) throw new Error(`Google authentication failed (${response.status})`);
  const data = await response.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}
async function googlePost(url, body, token, fetchImpl) {
  const response = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Google reporting request failed (${response.status})`);
  return response.json();
}
function metric(row, index) { return Number(row?.metricValues?.[index]?.value || 0); }
function searchMetric(row, index) { return Number(row?.[['clicks', 'impressions', 'ctr', 'position'][index]] || 0); }

async function getDailyTrafficReport({ date = yesterday(), searchConsoleDate = date, env = process.env, fetchImpl = fetch } = {}) {
  validateDate(date); validateDate(searchConsoleDate);
  const { credentials, propertyId, siteUrl, hostname } = loadConfig(env);
  const token = await getAccessToken(credentials, fetchImpl);
  const gaUrl = `${GA4_API_BASE}/properties/${encodeURIComponent(propertyId)}:runReport`;
  const scUrl = `${SEARCH_CONSOLE_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const gaRange = { startDate: date, endDate: date };
  const scRange = { startDate: searchConsoleDate, endDate: searchConsoleDate };
  const dimensionFilter = { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: hostname, caseSensitive: false } } };
  const [gaTotals, gaSources, gaPages, scTotals, scQueries, scPages] = await Promise.all([
    googlePost(gaUrl, { dateRanges: [gaRange], dimensionFilter, metrics: [{ name: 'activeUsers' }, { name: 'sessions' }] }, token, fetchImpl),
    googlePost(gaUrl, { dateRanges: [gaRange], dimensionFilter, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }, token, fetchImpl),
    googlePost(gaUrl, { dateRanges: [gaRange], dimensionFilter, dimensions: [{ name: 'landingPagePlusQueryString' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }, token, fetchImpl),
    googlePost(scUrl, scRange, token, fetchImpl),
    googlePost(scUrl, { ...scRange, dimensions: ['query'], rowLimit: 10 }, token, fetchImpl),
    googlePost(scUrl, { ...scRange, dimensions: ['page'], rowLimit: 10 }, token, fetchImpl)
  ]);
  const totals = scTotals.rows?.[0] || {};
  return {
    date, generatedAt: new Date().toISOString(),
    ga4: { date, provisional: true, users: metric(gaTotals.rows?.[0], 0), sessions: metric(gaTotals.rows?.[0], 1), trafficSources: (gaSources.rows || []).map((row) => ({ source: row.dimensionValues?.[0]?.value || '(not set)', sessions: metric(row, 0), users: metric(row, 1) })), landingPages: (gaPages.rows || []).map((row) => ({ page: row.dimensionValues?.[0]?.value || '(not set)', sessions: metric(row, 0), users: metric(row, 1) })) },
    searchConsole: { date: searchConsoleDate, clicks: searchMetric(totals, 0), impressions: searchMetric(totals, 1), ctr: searchMetric(totals, 2), averagePosition: searchMetric(totals, 3), topQueries: (scQueries.rows || []).map((row) => ({ query: row.keys?.[0] || '', clicks: searchMetric(row, 0), impressions: searchMetric(row, 1), ctr: searchMetric(row, 2), averagePosition: searchMetric(row, 3) })), topPages: (scPages.rows || []).map((row) => ({ page: row.keys?.[0] || '', clicks: searchMetric(row, 0), impressions: searchMetric(row, 1), ctr: searchMetric(row, 2), averagePosition: searchMetric(row, 3) })) }
  };
}
function clearTokenCache() { cachedToken = null; }
module.exports = { getDailyTrafficReport, clearTokenCache, validateDate };
