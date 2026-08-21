function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function metric(value) {
  return Number.isFinite(value) ? String(value) : 'Unavailable';
}

function renderSource(label, source, fields) {
  const status = source?.status || 'MONITORING_UNRESOLVED';
  const values = status === 'OK'
    ? fields.map(([name, key]) => `<li>${escapeHtml(name)}: ${escapeHtml(metric(source[key]))}</li>`).join('')
    : `<li>Reason: ${escapeHtml(source?.error || 'Unable to retrieve data')}</li>`;
  return `<section><h3>${escapeHtml(label)} — ${escapeHtml(status)}</h3><ul><li>Data date: ${escapeHtml(source?.date || 'Unavailable')}</li>${values}</ul></section>`;
}

function renderPortfolioMonitoringPage(report) {
  const businesses = (report.businesses || []).map((business) => `
    <article>
      <h2>${escapeHtml(business.business)} — ${escapeHtml(business.status)}</h2>
      <p>Hostname: ${escapeHtml(business.hostname)}</p>
      ${renderSource('GA4', business.ga4, [['Users', 'users'], ['Sessions', 'sessions']])}
      ${renderSource('Search Console', business.searchConsole, [['Clicks', 'clicks'], ['Impressions', 'impressions'], ['CTR', 'ctr'], ['Average position', 'averagePosition']])}
    </article>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Cambrian Digital portfolio monitoring</title></head><body><main><h1>Cambrian Digital portfolio monitoring</h1><p>Report date: ${escapeHtml(report.date)}</p><p>Generated at: ${escapeHtml(report.generatedAt)}</p>${businesses}</main></body></html>`;
}

module.exports = { renderPortfolioMonitoringPage };
