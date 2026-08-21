const { getDailyAggregateSourceReport, validateDate } = require('./google-reporting');

const PORTFOLIO_SITES = Object.freeze([
  { business: 'ProfitQuote', hostname: 'profitquote.co.uk', siteUrl: 'https://profitquote.co.uk/' },
  { business: 'CallbackApp', hostname: 'callbackapp.co.uk', siteUrl: 'sc-domain:callbackapp.co.uk' },
  { business: 'LatePay', hostname: 'latepay.co.uk', siteUrl: 'sc-domain:latepay.co.uk' },
  { business: 'ZenFlo', hostname: 'zenflo.co.uk', siteUrl: 'https://zenflo.co.uk/' }
]);

async function getPortfolioDailyTrafficReport({ date, reportGetter = getDailyAggregateSourceReport } = {}) {
  validateDate(date);
  const businesses = await Promise.all(PORTFOLIO_SITES.map(async (site) => {
    try {
      const report = await reportGetter({
        date,
        hostname: site.hostname,
        siteUrl: site.siteUrl
      });
      const sourceStatuses = [report.ga4.status, report.searchConsole.status];
      return {
        business: site.business,
        hostname: site.hostname,
        status: sourceStatuses.every((status) => status === 'OK') ? 'OK' : sourceStatuses.some((status) => status === 'OK') ? 'PARTIAL' : 'MONITORING_UNRESOLVED',
        ga4: report.ga4,
        searchConsole: report.searchConsole
      };
    } catch (error) {
      console.error(`Portfolio reporting failed for ${site.business}:`, error.message);
      return {
        business: site.business,
        hostname: site.hostname,
        status: 'MONITORING_UNRESOLVED',
        ga4: { status: 'MONITORING_UNRESOLVED', date, error: 'Unable to retrieve GA4 data' },
        searchConsole: { status: 'MONITORING_UNRESOLVED', date, error: 'Unable to retrieve Search Console data' }
      };
    }
  }));
  return { date, generatedAt: new Date().toISOString(), businesses };
}

module.exports = { getPortfolioDailyTrafficReport, PORTFOLIO_SITES };
