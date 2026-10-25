(() => {
  const page = document.body.dataset.landingPage;
  function trafficSource() {
    const campaign = new URLSearchParams(location.search).get('utm_source');
    if (campaign) return campaign.toLowerCase().slice(0, 50);
    let host = '';
    try { host = new URL(document.referrer).hostname.toLowerCase(); } catch (_) {}
    for (const domain of ['linkedin.com', 'google.com', 'google.co.uk', 'bing.com', 'facebook.com', 'fb.com']) {
      if (host === domain || host.endsWith('.' + domain)) return domain.split('.')[0] === 'fb' ? 'facebook' : domain.split('.')[0];
    }
    return host ? (host === location.hostname ? 'internal' : 'referral') : 'direct';
  }
  async function record(eventType) {
    if (eventType !== 'page_viewed' && typeof window !== 'undefined') window.pqAnalytics?.capture(eventType);
    const body = JSON.stringify({ event_type: eventType, source: trafficSource(), analytics: await window.pqGAContext?.() });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }))) return;
      fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    } catch (_) { /* Measurement must never block the quote builder. */ }
  }
  try {
    const key = 'pq_landing_visit_' + page;
    if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); record('page_viewed'); }
  } catch (_) { void record('page_viewed'); }
  document.querySelectorAll('a[href^="/dashboard?try=1"],a[href^="/dashboard?try=1"]').forEach(link => {
    link.addEventListener('click', async (event) => {
      if (event.defaultPrevented) return;
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) { void record('trial_click'); return; }
      event.preventDefault();
      try { await record('trial_click'); }
      finally { location.assign(link.href); }
    });
  });
})();
