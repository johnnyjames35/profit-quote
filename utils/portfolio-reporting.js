const { getDailyTrafficReport, validateDate } = require('./google-reporting');

const PORTFOLIO_SITES = Object.freeze([
  { business: 'ProfitQuote', hostname: 'profitquote.co.uk', siteUrl: 'https://profitquote.co.uk/' },
  { business: 'CallbackApp', hostname: 'callbackapp.co.uk', siteUrl: 'sc-domain:callbackapp.co.uk' },
  { business: 'LatePay', hostname: 'latepay.co.uk', siteUrl: 'sc-domain:latepay.co.uk' },
  { business: 'ZenFlo', hostname: 'zenflo.co.uk', siteUrl: 'https://zenflo.co.uk/' }
]);

async function getPortfolioDailyTrafficReport({ date, reportGetter = getDailyTrafficReport } = {}) {
  validateDate(date);
  const businesses = await Promise.all(PORTFOLIO_SITES.map(async (site) => {
    try {
      const report = await reportGetter({
        date,
        searchConsoleDate: date,
        hostname: site.hostname,
        siteUrl: site.siteUrl,
        includeComparisons: false
      });
      return {
        business: site.business,
        hostname: site.hostname,
        status: 'OK',
        ga4: {
          date: report.ga4.date,
          provisional: report.ga4.provisional,
          users: report.ga4.users,
          sessions: report.ga4.sessions
        },
        searchConsole: {
          date: report.searchConsole.date,
          clicks: report.searchConsole.clicks,
          impressions: report.searchConsole.impressions,
          ctr: report.searchConsole.ctr,
          averagePosition: report.searchConsole.averagePosition
        }
      };
    } catch (error) {
      console.error(`Portfolio reporting failed for ${site.business}:`, error.message);
      return {
        business: site.business,
        hostname: site.hostname,
        status: 'MONITORING_UNRESOLVED',
        error: 'Unable to retrieve Google reporting data'
      };
    }
  }));
  return { date, generatedAt: new Date().toISOString(), businesses };
}

module.exports = { getPortfolioDailyTrafficReport, PORTFOLIO_SITES };
