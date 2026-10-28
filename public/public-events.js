/* First-party UI events. Never collect form values or full URLs. */
(() => {
  if (window.pqTrackPublicEvent) return;
  const signup = new Set(['signup_screen_viewed', 'signup_attempted', 'signup_failed']);
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
    if ((!signup.has(eventType) && eventType !== 'trial_click') || navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return false;
    try {
      try { window.pqAnalytics?.capture(eventType); } catch (_) { /* Optional product analytics is independent. */ }
      let analytics;
      try { analytics = await window.pqGAContext?.(); } catch (_) { /* Internal counts do not require Google tags. */ }
      const body = JSON.stringify({event_type:eventType, source:source(), analytics});
      const url = signup.has(eventType) ? '/api/events/signup' : '/api/events';
      try { if (navigator.sendBeacon?.(url, new Blob([body], {type:'application/json'}))) return true; } catch (_) { /* Try keepalive below. */ }
      void fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body, keepalive:true}).catch(() => {});
      return true;
    } catch (_) { return false; }
  };
  function click(event) {
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
