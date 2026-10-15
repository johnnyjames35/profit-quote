const ORIGIN = 'https://profitquote.co.uk';

function analyticsContext(value) {
  if (!value || !/^[a-zA-Z0-9._-]{1,100}$/.test(value.client_id || '') || !/^\d{1,16}$/.test(String(value.session_id || ''))) return null;
  let page;
  try { page = new URL(value.page_location); } catch { return null; }
  if (page.origin !== ORIGIN || !/^\/[a-zA-Z0-9/_.-]*$/.test(page.pathname)) return null;
  return {client_id:value.client_id, session_id:String(value.session_id), page_location:page.origin + page.pathname};
}
function requestContext(req) {
  try {
    const raw=req.headers?.['x-pq-analytics'];
    if(raw && (typeof raw!=='string' || raw.length>1024)) return null;
    return analyticsContext(raw?JSON.parse(raw):req.body?.analytics);
  } catch { return null; }
}

// Sends an event to Google Analytics 4. Never throws — safe to call anywhere without try/catch.
async function sendToGA(event_type, user_id, source, context, parameters = {}) {
  const identity = analyticsContext(context);
  if (!process.env.GA_MEASUREMENT_ID || !process.env.GA_API_SECRET || !identity) return false;
  try {
    const response = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(process.env.GA_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(process.env.GA_API_SECRET)}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          client_id: identity.client_id,
          events: [{
            name: event_type,
            params: { ...parameters, source: source || 'unknown', session_id:Number(identity.session_id), page_location:identity.page_location, engagement_time_msec:1 }
          }]
        })
      }
    );
    return response.ok;
  } catch (e) {
    return false;
  }
}

// Commit this outbox with fulfilment. GA transaction IDs dedupe an ambiguous retry.
async function flushPurchases(pool) {
  if (!process.env.GA_MEASUREMENT_ID || !process.env.GA_API_SECRET) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query('SELECT * FROM ga_purchase_outbox WHERE delivered_at IS NULL ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED');
    for (const row of rows.rows) {
      if (await sendToGA('purchase', null, 'stripe_webhook', row.context, row.parameters)) {
        await client.query('UPDATE ga_purchase_outbox SET delivered_at=NOW() WHERE transaction_id=$1', [row.transaction_id]);
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
function startPurchaseDelivery(pool) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await flushPurchases(pool); } catch { console.error('GA purchase delivery deferred'); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(run, 30000); timer.unref(); return timer;
}
module.exports = { sendToGA, analyticsContext, requestContext, flushPurchases, startPurchaseDelivery };
