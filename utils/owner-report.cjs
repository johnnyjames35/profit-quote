'use strict';
// Aggregate-only owner reporting: no writes and no personal records in responses.
const { timingSafeEqual } = require('node:crypto');
const DAY = 86400000;
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use YYYY-MM-DD dates.');
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== value) throw new Error('Invalid calendar date.');
  return value;
}
function range(start, end) {
  day(start); day(end);
  const days = (Date.parse(end) - Date.parse(start)) / DAY + 1;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
  if (days < 1 || days > 31 || end > today) throw new Error('Choose a past or current period of 1–31 days.');
  return { start, end, days };
}
function authorized(header, expected) {
  if (typeof expected !== 'string' || expected.length < 32) return false;
  const supplied = Buffer.from(typeof header === 'string' ? header : '');
  const correct = Buffer.from('Bearer ' + expected);
  return supplied.length === correct.length && timingSafeEqual(supplied, correct);
}
const SPECS = Object.freeze({
  profitquote: { unit:'Registered accounts',activityLabel:'Quotes saved',table:'quotes',date:'created_at',condition:'TRUE' },
  callback: { unit:'Registered accounts',activityLabel:'Missed-call texts recorded sent',table:'missed_calls',date:'text_sent_at',condition:'a.text_sent=1' },
  latepay: { unit:'Registered accounts',activityLabel:'Invoices added',table:'invoices',date:'created_at',condition:'TRUE' },
  kelvori: { unit:'Registered workspaces',activityLabel:'Stored assessments updated',table:'workspace_assessments',date:'updated_at',condition:'TRUE' }
});
function queryFor(kind) {
  const spec=SPECS[kind]; if (!spec) throw new Error('Unknown reporting app');
  const eligible = kind === 'kelvori'
    ? `SELECT a.id,a.created_at FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.account_id=a.id AND m.role='owner' AND lower(u.email)=ANY($3::text[]))`
    : `SELECT u.id,u.created_at FROM users u WHERE NOT(lower(u.email)=ANY($3::text[])) ${kind==='latepay'?'AND COALESCE(u.is_admin,0)=0':''}`;
  return `WITH bounds AS (SELECT (($1::date::timestamp AT TIME ZONE 'Europe/London') AT TIME ZONE 'UTC') AS lo, ((($2::date+1)::timestamp AT TIME ZONE 'Europe/London') AT TIME ZONE 'UTC') AS hi), eligible AS (${eligible})
  SELECT (SELECT COUNT(*)::int FROM eligible) AS registered,
  (SELECT COUNT(*)::int FROM eligible,bounds WHERE created_at>=lo AND created_at<hi) AS registrations,
  (SELECT COUNT(*)::int FROM ${spec.table} a JOIN eligible u ON u.id=a.${kind==='kelvori'?'account_id':'user_id'} CROSS JOIN bounds WHERE a.${spec.date}>=lo AND a.${spec.date}<hi AND ${spec.condition}) AS activity`;
}
async function report({query,kind,start,end,env=process.env}) {
  const window=range(start,end), spec=SPECS[kind];
  const excluded=(env.OWNER_REPORT_EXCLUDE_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
  const result=await query(queryFor(kind),[start,end,excluded]);
  const row=(result.rows||result)[0];
  if (!row || ['registered','registrations','activity'].some(k=>!Number.isSafeInteger(Number(row[k])) || Number(row[k])<0)) throw new Error('Invalid aggregate');
  return { status:'connected',kind,window,timezone:'Europe/London',fetchedAt:new Date().toISOString(),registered:Number(row.registered),registrations:Number(row.registrations),activity:Number(row.activity),unit:spec.unit,activityLabel:spec.activityLabel,
    exclusions:{knownTestAddresses:excluded.length,adminAccounts:kind==='latepay'},
    note:'Counts cover records still present, not verified customers. '+(excluded.length?'Identified internal addresses excluded; unidentified tests may remain.':'Internal test accounts may be included.')+(kind==='kelvori'?' Assessments are stored workspace records updated during this period, not all public assessment completions.':'') };
}
function handler({query,kind,env=process.env}) {
  return async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    if (!env.OWNER_REPORT_TOKEN || env.OWNER_REPORT_TOKEN.length<32) return res.status(503).json({error:'Owner reporting is not configured.'});
    if (!authorized(req.headers.authorization,env.OWNER_REPORT_TOKEN)) return res.status(401).json({error:'Not authorized'});
    try { range(req.query.start,req.query.end); } catch(e){ return res.status(400).json({error:e.message}); }
    try { res.json(await report({query,kind,start:req.query.start,end:req.query.end,env})); }
    catch { res.status(503).json({error:'App records are temporarily unavailable.'}); }
  };
}
module.exports={range,authorized,report,handler,queryFor};
