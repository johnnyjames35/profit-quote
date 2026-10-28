/* First-party UI events. Never collect form values or full URLs. */
(() => {
  if (window.pqTrackPublicEvent) return;
  const signup = new Set(['signup_screen_viewed', 'signup_attempted', 'signup_failed']);
  // Opt-in diagnostics contain enums only, never identities, URLs or form values.
  const debug = new URLSearchParams(location.search).get('tracking_debug') === '1';
  function diagnostic(key, value) {
    if (debug) document.documentElement?.setAttribute('data-pq-' + key, value);
  }
  diagnostic('tracking-status', 'ready');
  function source() {
    const campaign = new URLSearchParams(location.search).get('utm_source');
    if (campaign?.trim()) return campaign.trim().toLowerCase().slice(0, 50);
    let host;
    try { host = new URL(document.referrer).hostname.toLowerCase(); } catch (_) { return 'direct'; }
    if (host === location.hostname) return 'internal';
    for (const [domain, name] of [['google.com','google'],['google.co.uk','google'],['linkedin.com','linkedin'],['bing.com','bing'],['facebook.com','facebook'],['fb.com','facebook']]) {
      if (host === domain || host.endsWith('.' + domain)) return name;
    }
    return 'referral';
  }
  window.pqTrackPublicEvent = async eventType => {
    if (!signup.has(eventType) && eventType !== 'trial_click') return false;
    diagnostic('tracking-event', eventType);
    if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) {
      diagnostic('tracking-status', 'privacy-disabled'); return false;
    }
    diagnostic('tracking-status', 'preparing');
    try {
      try { window.pqAnalytics?.capture(eventType); } catch (_) { /* Optional product analytics is independent. */ }
      let analytics;
      try { analytics = await window.pqGAContext?.(); } catch (_) { /* Internal counts do not require Google tags. */ }
      diagnostic('ga-identity', analytics?.client_id ? 'available' : 'unavailable');
      const body = JSON.stringify({event_type:eventType, source:source(), analytics});
      const url = signup.has(eventType) ? '/api/events/signup' : '/api/events';
      try { if (navigator.sendBeacon?.(url, new Blob([body], {type:'application/json'}))) {
        diagnostic('tracking-status', 'beacon-queued'); return true;
      } } catch (_) { /* Try keepalive below. */ }
      diagnostic('tracking-status', 'fetch-queued');
      void fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body, keepalive:true})
        .then(r => diagnostic('tracking-status', r.ok ? 'recorded' : 'request-rejected'))
        .catch(() => diagnostic('tracking-status', 'request-failed'));
      return true;
    } catch (_) { diagnostic('tracking-status', 'failed'); return false; }
  };
  function click(event) {
    diagnostic('tracking-click', event.defaultPrevented ? 'already-prevented' : 'received');
    if (event.defaultPrevented || (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0)) return;
    const link = event.target?.closest?.('a[href]');
    if (!link || link.hasAttribute('download')) return;
    let url;
    try { url = new URL(link.href, location.href); } catch (_) { return; }
    if (url.origin !== location.origin || !['/dashboard','/dashboard.html'].includes(url.pathname) || url.searchParams.get('try') !== '1') return;
    const ordinary = event.type === 'click' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && (!link.target || link.target === '_self');
    if (ordinary) {
      event.preventDefault();
      // Identity lookup is bounded by pqGAContext; measurement errors cannot trap navigation.
      void window.pqTrackPublicEvent('trial_click').finally(() => location.assign(link.href));
    } else void window.pqTrackPublicEvent('trial_click');
  }
  document.addEventListener('click', click);
  document.addEventListener('auxclick', click);
})();
