(() => {
  const page = document.body.dataset.landingPage;
  function record(eventType) {
    const body = JSON.stringify({ event_type: eventType, source: page });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }))) return;
      fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    } catch (_) { /* Measurement must never block the quote builder. */ }
  }
  try {
    const key = 'pq_landing_visit_' + page;
    if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); record('page_viewed'); }
  } catch (_) { /* Storage can be unavailable in privacy modes. */ }
  document.querySelectorAll('a[href^="/dashboard?try=1"],a[href^="/dashboard?try=1"]').forEach(link => {
    link.addEventListener('click', () => record('trial_click'));
  });
})();
