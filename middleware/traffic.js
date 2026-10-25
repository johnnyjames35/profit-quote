const crypto = require('node:crypto');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function source(req) {
  const campaign = req.query?.utm_source;
  if (typeof campaign === 'string' && campaign.trim()) return campaign.trim().toLowerCase().slice(0, 50);
  let host;
  try { host = new URL(req.get('referer')).hostname.toLowerCase(); } catch { return 'direct'; }
  if (host === req.hostname.toLowerCase()) return 'internal';
  for (const [domain, name] of [['linkedin.com','linkedin'],['google.com','google'],['google.co.uk','google'],['bing.com','bing'],['facebook.com','facebook'],['fb.com','facebook']]) {
    if (host === domain || host.endsWith('.' + domain)) return name;
  }
  return 'referral';
}

module.exports = function traffic(req, res, next) {
  const path = req.path.toLowerCase();
  if (req.method !== 'GET' || !req.get('accept')?.includes('text/html') ||
      /^\/(api|admin|monitoring)([/.]|$)/.test(path) ||
      /\.[^/]+$/.test(path) && !path.endsWith('.html') ||
      /bot|crawler|spider|slurp|headless|lighthouse|facebookexternalhit/i.test(req.get('user-agent') || '') ||
      req.get('dnt') === '1' || req.get('sec-gpc') === '1') return next();
  const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('pq_visitor='))?.slice(11);
  const id = UUID.test(cookie || '') ? cookie : crypto.randomUUID();
  // Random first-party identity only: never fingerprint an IP, user agent or account.
  if (id !== cookie) res.cookie('pq_visitor', id, {httpOnly:true, secure:process.env.NODE_ENV === 'production', sameSite:'lax', maxAge:30*86400000, path:'/'});
  res.set('Cache-Control', 'private, no-store');
  // A rendered cached 304 is still a view. Return the HTML so this server sees
  // every tracked navigation, including the first request after this release.
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  const visitor = crypto.createHmac('sha256', process.env.JWT_SECRET).update('traffic|' + id).digest('hex');
  const attribution = source(req);
  res.once('finish', () => {
    if (res.statusCode !== 200 || !String(res.get('Content-Type') || '').includes('text/html')) return;
    req.app.locals.pool.query('INSERT INTO page_visits(visitor_hash,path,source) VALUES($1,$2,$3)', [visitor,req.path.slice(0,500),attribution])
      .catch(() => console.error('Page visit recording failed'));
  });
  next();
};
