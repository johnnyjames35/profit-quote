/* Optional PostHog measurement. Internal events and Google Analytics stay independent. */
(() => {
  'use strict';
  if (window.pqAnalytics || /\/(admin|monitoring)(\.html)?(?:\/|$)/.test(location.pathname)) return;
  const KEY = 'pq_posthog_consent';
  const EVENTS = new Set(['page_viewed','trial_click','quote_started','quote_completed','anonymous_quote_completed',
    'save_prompt_shown','quote_saved','quote_downloaded','signup_screen_viewed','signup_attempted','signup_failed',
    'checkout_started','account_created']);
  let choice = null, sdk = null, loading = false, settings = null, account = null, authToken = null;
  let queue = [], pageSent = false;
  try { choice = localStorage.getItem(KEY); } catch (_) {}
  const permitted = () => choice === 'yes' && navigator.doNotTrack !== '1' && !navigator.globalPrivacyControl;
  const safe = fn => { try { return fn(); } catch (_) {} };
  const cleanUrl = value => {
    try { const url = new URL(value, location.origin); return url.origin + url.pathname; } catch (_) { return ''; }
  };

  function beforeSend(event) {
    if (!permitted() || !event || (!EVENTS.has(event.event) && !['$identify','$snapshot'].includes(event.event))) return null;
    // SDK enrichment must not reintroduce referrers, query strings, campaign values,
    // document titles, person properties, quote content or form values.
    const allowed = new Set(['token','distinct_id','$device_id','$session_id','$window_id','$anon_distinct_id',
      '$user_id','$is_identified','$process_person_profile','$lib','$lib_version','$insert_id',
      '$browser','$browser_version','$os','$os_version','$device_type','$screen_height','$screen_width',
      '$viewport_height','$viewport_width','$snapshot_data','$snapshot_bytes']);
    const properties = {};
    for (const [key, value] of Object.entries(event.properties || {})) if (allowed.has(key)) properties[key] = value;
    properties.$current_url = cleanUrl(location.href);
    properties.$pathname = location.pathname;
    properties.$geoip_disable = true;
    event.properties = properties;
    return event;
  }

  function capture(name) {
    if (!EVENTS.has(name) || !permitted()) return;
    safe(() => {
      if (sdk) sdk.capture(name);
      else if (queue.length < 50) queue.push(['capture', name]);
    });
  }
  function identify() {
    if (!permitted() || !account || account.guest) return;
    const id = 'pq-user-' + account.id;
    safe(() => {
      if (sdk) {
        // Shared browsers must never merge two signed-in accounts.
        if (sdk.get_distinct_id().startsWith('pq-user-') && sdk.get_distinct_id() !== id) sdk.reset(true);
        sdk.identify(id);
      } else queue.push(['identify', id]);
    });
  }
  async function syncConsent() {
    // Preferences can also be changed from the homepage/privacy page while signed in.
    const token = authToken || safe(() => localStorage.getItem('pq_token'));
    if (!token || account?.guest) return true;
    try {
      const response = await fetch('/api/analytics/consent', { method: 'POST', keepalive: true,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: permitted() }) });
      return response.ok;
    } catch (_) { return false; }
  }
  function start() {
    if (!permitted() || !settings?.enabled || sdk || loading) return;
    loading = true;
    const script = document.createElement('script');
    script.src = 'https://eu-assets.i.posthog.com/static/array.js';
    script.async = true;
    script.onerror = () => { loading = false; queue = []; };
    script.onload = () => safe(() => {
      loading = false;
      if (!permitted()) return;
      window.posthog.init(settings.token, {
        api_host: settings.apiHost, ui_host: 'https://eu.posthog.com',
        autocapture: false, capture_pageview: false, capture_pageleave: false,
        capture_performance: false, capture_dead_clicks: false, capture_heatmaps: false,
        capture_exceptions: false, rageclick: false, disable_surveys: true,
        disable_web_experiments: true, enable_recording_console_log: false,
        person_profiles: 'identified_only', persistence: 'localStorage',
        cross_subdomain_cookie: false, respect_dnt: true, ip: false,
        save_referrer: false, store_google: false, before_send: beforeSend,
        session_recording: {
          maskAllInputs: true, maskTextSelector: '*',
          blockSelector: 'input,textarea,select,img,svg,canvas,video,audio,iframe,object,embed,script,[contenteditable],.ph-no-capture,[href*="?"],[href^="mailto:"],[href^="tel:"],#quotes-list,#recent-quotes-list,#photo-overlay,#tab-issues,#tab-setup,#step-6',
          recordCrossOriginIframes: false, recordHeaders: false, recordBody: false,
          captureCanvas: { recordCanvas: false },
          maskCapturedNetworkRequestFn: request => ({ ...request, name: cleanUrl(request.name) })
        },
        loaded(instance) {
          if (!permitted()) { instance.opt_out_capturing(); return; }
          sdk = instance;
          const pending = queue; queue = [];
          for (const [method, value] of pending) {
            if (method === 'identify') {
              if (sdk.get_distinct_id().startsWith('pq-user-') && sdk.get_distinct_id() !== value) sdk.reset(true);
              sdk.identify(value);
            } else sdk.capture(value);
          }
        }
      });
    });
    document.head.appendChild(script);
  }
  function pageView() {
    if (permitted() && !pageSent) { pageSent = true; capture('page_viewed'); }
  }
  async function choose(value) {
    choice = value;
    safe(() => localStorage.setItem(KEY, value));
    if (!permitted()) {
      queue = [];
      safe(() => { sdk?.stopSessionRecording(); sdk?.opt_out_capturing(); });
    } else {
      safe(() => sdk?.opt_in_capturing({ captureEventName: null }));
      identify(); start(); pageView();
    }
    const saved = await syncConsent();
    const panel = document.getElementById('pq-analytics-choice');
    if (panel) {
      if (saved) panel.hidden = true;
      else panel.querySelector('p').textContent = 'Your browser preference is saved. We could not update your account preference. Please retry.';
    }
  }
  function showChoice() {
    const panel = document.getElementById('pq-analytics-choice');
    if (panel) panel.hidden = false;
  }
  window.pqAnalytics = {
    capture,
    account(user, token) { account = user; authToken = token; identify(); void syncConsent(); },
    logout() { safe(() => sdk?.reset(true)); queue = []; account = null; authToken = null; },
    quoteResult(result) {
      // Only the server's fresh-success marker, never the quote/customer object.
      if (result?.analytics_event === 'quote_completed') { capture('quote_completed'); capture('quote_saved'); }
      else if (['anonymous_quote_completed','quote_saved'].includes(result?.analytics_event)) capture(result.analytics_event);
    },
    showChoice
  };
  document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/analytics/config').then(r => r.ok ? r.json() : null).then(config => {
      settings = config;
      if (!settings?.enabled) { queue = []; return; }
      const panel = document.createElement('aside');
      panel.id = 'pq-analytics-choice'; panel.className = 'ph-no-capture';
      panel.setAttribute('aria-label', 'Optional product analytics');
      panel.style.cssText = 'position:fixed;bottom:52px;left:12px;right:12px;max-width:440px;padding:18px;background:#fff;color:#17252c;border:1px solid #9ca3af;border-radius:12px;z-index:100000;box-shadow:0 4px 24px #0003;font:15px/1.5 system-ui';
      panel.innerHTML = '<p>Help improve ProfitQuote with optional PostHog analytics and masked session replay, processed in the EU. <a href="/privacy.html">Privacy details</a></p><button type="button" data-choice="yes">Allow</button> <button type="button" data-choice="no">No thanks</button>';
      panel.querySelectorAll('button').forEach(button => {
        button.style.cssText = 'font:inherit;padding:9px 15px;cursor:pointer';
        button.addEventListener('click', () => { void choose(button.dataset.choice); });
      });
      panel.hidden = choice !== null;
      document.body.appendChild(panel);
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = 'Analytics choices'; button.className = 'ph-no-capture';
      button.style.cssText = 'position:fixed;bottom:10px;left:12px;z-index:99999;padding:7px 10px;font:12px system-ui;background:#fff;color:#17252c;border:1px solid #9ca3af;border-radius:6px;cursor:pointer';
      button.addEventListener('click', showChoice); document.body.appendChild(button);
      start(); pageView();
    }).catch(() => { queue = []; });
  });
  window.addEventListener('storage', event => {
    if (event.key === KEY) {
      choice = event.newValue;
      if (!permitted()) { queue = []; safe(() => { sdk?.stopSessionRecording(); sdk?.opt_out_capturing(); }); }
      else { safe(() => sdk?.opt_in_capturing({ captureEventName: null })); identify(); start(); pageView(); }
      void syncConsent();
    }
  });
})();
