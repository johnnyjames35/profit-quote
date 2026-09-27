const crypto = require('node:crypto');

// Public ingestion token, never a PostHog personal API key.
const PROJECT_TOKEN = 'phc_ovuVHBwSAoYdhdA3p5KUVnMtXaFD8ikySHsNXfJNBshs';
const API_HOST = 'https://eu.i.posthog.com';
function config() {
  return { enabled: process.env.POSTHOG_ENABLED === 'true', token: PROJECT_TOKEN, apiHost: API_HOST };
}

// Read committed payment facts, without changing billing or its transactions.
// One first paid conversion per account. No historical/pre-consent backfill.
async function flushPaidConversions(pool, send = fetch) {
  if (!config().enabled) return;
  const result = await pool.query(`
    SELECT c.user_id, e.id, e.event_type, e.meta, e.created_at
    FROM posthog_consent c
    JOIN LATERAL (
      SELECT id,event_type,meta,created_at FROM events
      WHERE user_id=c.user_id AND source='stripe_webhook'
        AND event_type IN ('subscription_started','payg_purchased')
      ORDER BY id LIMIT 1
    ) e ON e.created_at >= c.enabled_since
    LEFT JOIN posthog_paid_deliveries d ON d.user_id=c.user_id
    WHERE c.enabled AND d.user_id IS NULL ORDER BY e.id LIMIT 50`);
  for (const row of result.rows) {
    // Recheck consent immediately before dispatch, including revocations during a batch.
    const consent = await pool.query('SELECT 1 FROM posthog_consent WHERE user_id=$1 AND enabled AND enabled_since<=$2', [row.user_id, row.created_at]);
    if (!consent.rows.length) continue;
    const hex = crypto.createHash('sha256').update('profitquote:paid:' + row.user_id).digest('hex');
    const uuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
    const plan = ['payg','starter','pro'].includes(row.meta?.plan) ? row.meta.plan : 'legacy';
    const response = await send(API_HOST + '/capture/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ api_key: PROJECT_TOKEN, uuid, event: 'paid_conversion',
        timestamp: new Date(row.created_at).toISOString(),
        properties: { distinct_id: 'pq-user-' + row.user_id, $insert_id: uuid, $ip: null,
          $geoip_disable: true, source: 'stripe_webhook', payment_type: row.event_type, plan } })
    });
    if (!response.ok) throw new Error('PostHog ingestion returned HTTP ' + response.status);
    await pool.query('INSERT INTO posthog_paid_deliveries(user_id) VALUES($1) ON CONFLICT DO NOTHING', [row.user_id]);
  }
}

function startPaidConversionDelivery(pool) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await flushPaidConversions(pool); }
    catch (_) { console.error('PostHog paid conversion delivery pending; will retry'); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  return timer;
}
module.exports = { config, flushPaidConversions, startPaidConversionDelivery };
