const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID;
const GA_API_SECRET = process.env.GA_API_SECRET;

// Sends an event to Google Analytics 4. Never throws — safe to call anywhere without try/catch.
async function sendToGA(event_type, user_id, source) {
  if (!GA_MEASUREMENT_ID || !GA_API_SECRET) return; // does nothing if env vars aren't set yet
  try {
    const clientId = user_id ? `user-${user_id}` : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`,
      {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          events: [{
            name: event_type,
            params: { source: source || 'unknown' }
          }]
        })
      }
    );
  } catch (e) {
    console.error('GA event send error:', e.message);
  }
}

module.exports = { sendToGA };
