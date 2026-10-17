/* Share the existing Google tag identity; never manufacture another visitor. */
(() => {
  const measurement = 'G-D6L8EB3PWK';
  if (typeof window.pqGAContext === 'function') return;
  window.pqGAContext = async () => {
    if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl || typeof window.gtag !== 'function') return {};
    const get = field => new Promise(resolve => {
      const timeout = setTimeout(() => resolve(null), 250);
      try { window.gtag('get', measurement, field, value => { clearTimeout(timeout); resolve(value); }); }
      catch (_) { clearTimeout(timeout); resolve(null); }
    });
    const [client_id, session_id] = await Promise.all([get('client_id'), get('session_id')]);
    if (!client_id || !session_id) return {};
    return {client_id, session_id: String(session_id), page_location: location.origin + location.pathname};
  };
})();

