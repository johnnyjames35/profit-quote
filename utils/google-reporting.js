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
function ukCalendarDate() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function yesterday() { return shiftDate(ukCalendarDate(), -1); }
function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function change(current, previous) {
  return previous ? (current - previous) / previous : null;
}
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
function topSearchRows(rows, key) {
  return (rows || [])
    .map((row) => ({ [key]: row.keys?.[0] || '', clicks: searchMetric(row, 0), impressions: searchMetric(row, 1), ctr: searchMetric(row, 2), averagePosition: searchMetric(row, 3) }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.averagePosition - b.averagePosition)
    .slice(0, 15);
}

function reportingDimensionFilter(hostname) {
  return {
    andGroup: {
      expressions: [
        { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: hostname, caseSensitive: false } } },
        { notExpression: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/admin', caseSensitive: false } } } }
      ]
    }
  };
}

async function getDailyAggregateSourceReport({ date = yesterday(), hostname: hostnameOverride, siteUrl: siteUrlOverride, env = process.env, fetchImpl = fetch } = {}) {
  validateDate(date);
  const config = loadConfig(env);
  const hostname = hostnameOverride || config.hostname;
  const siteUrl = siteUrlOverride || config.siteUrl;
  const token = await getAccessToken(config.credentials, fetchImpl);
  const gaUrl = `${GA4_API_BASE}/properties/${encodeURIComponent(config.propertyId)}:runReport`;
  const scUrl = `${SEARCH_CONSOLE_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const dimensionFilter = reportingDimensionFilter(hostname);
  const [gaResult, searchResult] = await Promise.allSettled([
    googlePost(gaUrl, { dateRanges: [{ startDate: date, endDate: date }], dimensionFilter, metrics: [{ name: 'activeUsers' }, { name: 'sessions' }] }, token, fetchImpl),
    googlePost(scUrl, { startDate: date, endDate: date }, token, fetchImpl)
  ]);
  const gaRow = gaResult.status === 'fulfilled' ? gaResult.value.rows?.[0] : null;
  const searchRow = searchResult.status === 'fulfilled' ? searchResult.value.rows?.[0] : null;
  return {
    ga4: gaResult.status === 'fulfilled'
      ? { status: 'OK', date, provisional: true, users: metric(gaRow, 0), sessions: metric(gaRow, 1) }
      : { status: 'MONITORING_UNRESOLVED', date, error: 'Unable to retrieve GA4 data' },
    searchConsole: searchResult.status === 'fulfilled'
      ? { status: 'OK', date, clicks: searchMetric(searchRow, 0), impressions: searchMetric(searchRow, 1), ctr: searchMetric(searchRow, 2), averagePosition: searchMetric(searchRow, 3) }
      : { status: 'MONITORING_UNRESOLVED', date, error: 'Unable to retrieve Search Console data' }
  };
}

async function getDailyTrafficReport({ date = yesterday(), searchConsoleDate = date, hostname: hostnameOverride, siteUrl: siteUrlOverride, includeComparisons = false, env = process.env, fetchImpl = fetch } = {}) {
  validateDate(date); validateDate(searchConsoleDate);
  const config = loadConfig(env);
  const hostname = hostnameOverride || config.hostname;
  const siteUrl = siteUrlOverride || config.siteUrl;
  const token = await getAccessToken(config.credentials, fetchImpl);
  const gaUrl = `${GA4_API_BASE}/properties/${encodeURIComponent(config.propertyId)}:runReport`;
  const scUrl = `${SEARCH_CONSOLE_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const gaRange = { startDate: date, endDate: date };
  const scRange = { startDate: searchConsoleDate, endDate: searchConsoleDate };
  const scTopRange = { startDate: shiftDate(searchConsoleDate, -29), endDate: searchConsoleDate };
  const dimensionFilter = reportingDimensionFilter(hostname);
  const comparisonRanges = {
    sevenDay: {
      current: { startDate: shiftDate(date, -6), endDate: date },
      previous: { startDate: shiftDate(date, -13), endDate: shiftDate(date, -7) },
      searchCurrent: { startDate: shiftDate(searchConsoleDate, -6), endDate: searchConsoleDate },
      searchPrevious: { startDate: shiftDate(searchConsoleDate, -13), endDate: shiftDate(searchConsoleDate, -7) }
    },
    thirtyDay: {
      current: { startDate: shiftDate(date, -29), endDate: date },
      previous: { startDate: shiftDate(date, -59), endDate: shiftDate(date, -30) },
      searchCurrent: { startDate: shiftDate(searchConsoleDate, -29), endDate: searchConsoleDate },
      searchPrevious: { startDate: shiftDate(searchConsoleDate, -59), endDate: shiftDate(searchConsoleDate, -30) }
    }
  };
  const gaSummary = (range) => googlePost(gaUrl, { dateRanges: [range], dimensionFilter, metrics: [{ name: 'activeUsers' }, { name: 'sessions' }] }, token, fetchImpl);
  const scSummary = (range) => googlePost(scUrl, range, token, fetchImpl);
  const responses = await Promise.all([
    googlePost(gaUrl, { dateRanges: [gaRange], dimensionFilter, metrics: [{ name: 'activeUsers' }, { name: 'sessions' }] }, token, fetchImpl),
    googlePost(gaUrl, { dateRanges: [gaRange], dimensionFilter, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }, token, fetchImpl),
    googlePost(gaUrl, { dateRanges: [gaRange], dimensionFilter, dimensions: [{ name: 'landingPagePlusQueryString' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }, token, fetchImpl),
    googlePost(scUrl, scRange, token, fetchImpl),
    googlePost(scUrl, { ...scTopRange, dimensions: ['query'], rowLimit: 100 }, token, fetchImpl),
    googlePost(scUrl, { ...scTopRange, dimensions: ['page'], rowLimit: 100 }, token, fetchImpl),
    ...(includeComparisons ? [
      gaSummary(comparisonRanges.sevenDay.current), gaSummary(comparisonRanges.sevenDay.previous),
      scSummary(comparisonRanges.sevenDay.searchCurrent), scSummary(comparisonRanges.sevenDay.searchPrevious),
      gaSummary(comparisonRanges.thirtyDay.current), gaSummary(comparisonRanges.thirtyDay.previous),
      scSummary(comparisonRanges.thirtyDay.searchCurrent), scSummary(comparisonRanges.thirtyDay.searchPrevious)
    ] : [])
  ]);
  const [gaTotals, gaSources, gaPages, scTotals, scQueries, scPages, ga7, gaPrevious7, sc7, scPrevious7, ga30, gaPrevious30, sc30, scPrevious30] = responses;
  const totals = scTotals.rows?.[0] || {};
  function comparison(period, currentGa, previousGa, currentSc, previousSc) {
    const currentGaRow = currentGa.rows?.[0];
    const previousGaRow = previousGa.rows?.[0];
    const currentScRow = currentSc.rows?.[0];
    const previousScRow = previousSc.rows?.[0];
    const current = { users: metric(currentGaRow, 0), sessions: metric(currentGaRow, 1), clicks: searchMetric(currentScRow, 0), impressions: searchMetric(currentScRow, 1), ctr: searchMetric(currentScRow, 2), averagePosition: searchMetric(currentScRow, 3) };
    const previous = { users: metric(previousGaRow, 0), sessions: metric(previousGaRow, 1), clicks: searchMetric(previousScRow, 0), impressions: searchMetric(previousScRow, 1), ctr: searchMetric(previousScRow, 2), averagePosition: searchMetric(previousScRow, 3) };
    return { period, current, previous, change: { users: change(current.users, previous.users), sessions: change(current.sessions, previous.sessions), clicks: change(current.clicks, previous.clicks), impressions: change(current.impressions, previous.impressions), ctr: change(current.ctr, previous.ctr), averagePosition: change(current.averagePosition, previous.averagePosition) } };
  }
  const report = {
    date, generatedAt: new Date().toISOString(), reportWindow: { type: 'calendar-day', timezone: 'Europe/London', startDate: date, endDate: date },
    ga4: { date, provisional: true, excludesAdminTraffic: true, users: metric(gaTotals.rows?.[0], 0), sessions: metric(gaTotals.rows?.[0], 1), trafficSources: (gaSources.rows || []).map((row) => ({ source: row.dimensionValues?.[0]?.value || '(not set)', sessions: metric(row, 0), users: metric(row, 1) })), landingPages: (gaPages.rows || []).map((row) => ({ page: row.dimensionValues?.[0]?.value || '(not set)', sessions: metric(row, 0), users: metric(row, 1) })) },
    searchConsole: { date: searchConsoleDate, clicks: searchMetric(totals, 0), impressions: searchMetric(totals, 1), ctr: searchMetric(totals, 2), averagePosition: searchMetric(totals, 3), topResultsPeriod: { startDate: scTopRange.startDate, endDate: scTopRange.endDate, days: 30 }, topQueries: topSearchRows(scQueries.rows, 'query'), topPages: topSearchRows(scPages.rows, 'page') }
  };
  if (includeComparisons) report.comparisons = {
      sevenDay: comparison('7 days', ga7, gaPrevious7, sc7, scPrevious7),
      thirtyDay: comparison('30 days', ga30, gaPrevious30, sc30, scPrevious30)
  };
  return report;
}

function aggregateHourlyRows(rows, latestHour, pageKeyIndex = null) {
  if (!latestHour) return pageKeyIndex === null ? { clicks: 0, impressions: 0, ctr: 0, averagePosition: 0 } : [];
  const cutoff = latestHour.getTime() - (23 * 60 * 60 * 1000);
  const selected = (rows || []).filter((row) => {
    const hour = new Date(row.keys?.[0] || '');
    return !Number.isNaN(hour.getTime()) && hour.getTime() >= cutoff && hour.getTime() <= latestHour.getTime();
  });
  const summarize = (items) => {
    const clicks = items.reduce((sum, row) => sum + searchMetric(row, 0), 0);
    const impressions = items.reduce((sum, row) => sum + searchMetric(row, 1), 0);
    const weightedPosition = items.reduce((sum, row) => sum + (searchMetric(row, 3) * searchMetric(row, 1)), 0);
    return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, averagePosition: impressions ? weightedPosition / impressions : 0 };
  };
  if (pageKeyIndex === null) return summarize(selected);
  const groups = new Map();
  selected.forEach((row) => {
    const key = row.keys?.[pageKeyIndex] || '(not set)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.entries()]
    .map(([page, items]) => ({ page, ...summarize(items) }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    .slice(0, 10);
}

async function getLiveSearchReport({ siteUrl: siteUrlOverride, env = process.env, fetchImpl = fetch } = {}) {
  const config = loadConfig(env);
  const siteUrl = siteUrlOverride || config.siteUrl;
  const token = await getAccessToken(config.credentials, fetchImpl);
  const scUrl = `${SEARCH_CONSOLE_API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const endDate = ukCalendarDate();
  const startDate = shiftDate(endDate, -2);
  const baseRequest = { startDate, endDate, dataState: 'HOURLY_ALL', rowLimit: 25000 };
  const [hourly, hourlyPages] = await Promise.all([
    googlePost(scUrl, { ...baseRequest, dimensions: ['HOUR'] }, token, fetchImpl),
    googlePost(scUrl, { ...baseRequest, dimensions: ['HOUR', 'PAGE'] }, token, fetchImpl)
  ]);
  const availableHours = (hourly.rows || [])
    .map((row) => new Date(row.keys?.[0] || ''))
    .filter((hour) => !Number.isNaN(hour.getTime()));
  const latestHour = availableHours.length ? new Date(Math.max(...availableHours.map((hour) => hour.getTime()))) : null;
  return {
    generatedAt: new Date().toISOString(),
    window: { type: 'latest-24-available-hours', hours: 24, partial: true, latestHour: latestHour?.toISOString() || null },
    ...aggregateHourlyRows(hourly.rows, latestHour),
    topPages: aggregateHourlyRows(hourlyPages.rows, latestHour, 1)
  };
}
function clearTokenCache() { cachedToken = null; }
module.exports = { getDailyTrafficReport, getDailyAggregateSourceReport, getLiveSearchReport, clearTokenCache, validateDate };
