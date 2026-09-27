# PostHog EU analytics and session replay

## Deployment

This change is disabled by default. Merge the PR through the normal review process, deploy it, and set `POSTHOG_ENABLED=true` only on the intended deployment. The public EU project token is centralized in `utils/posthog.js`; no personal API key or extra npm dependency is needed. Ingestion is fixed to `https://eu.i.posthog.com`, UI to `https://eu.posthog.com`, and the browser SDK loads from `https://eu-assets.i.posthog.com/static/array.js`.

Startup applies the existing idempotent `schema.sql`, adding `posthog_consent`, `posthog_paid_deliveries` and a partial events index. Confirm startup reports `Database ready`. The payment exporter starts only after successful migration. Roll back capture with `POSTHOG_ENABLED=false` and a restart; already-open browser tabs need a refresh. Leave the new tables in place to preserve consent and delivery receipts.

Enable session replay in the EU PostHog project settings and choose retention/sampling. No project settings have been changed by this PR. The standard CDN SDK is unpinned (as with the official snippet); the real-browser smoke test was checked against 1.434.15. If a CSP is added, allow the EU ingestion/assets hosts. Test with an unblocked browser; ad blockers may prevent optional analytics.

## Event ownership and counting

| PostHog event | Trigger |
| --- | --- |
| `page_viewed` | Once per loaded document after opt-in; automatic `$pageview`/`$pageleave` disabled. Existing internal session-based visit counting is unchanged. |
| `trial_click` | Existing homepage, commercial page and quote-template CTA tracking functions. |
| `quote_started`, `save_prompt_shown`, `quote_downloaded`, `signup_screen_viewed`, `signup_attempted`, `signup_failed`, `checkout_started` | Existing dashboard funnel call sites. PostHog can capture signup validation without an auth token; the internal endpoint retains its existing auth requirement. |
| `quote_completed` | New account quote committed successfully, using a response-only `analytics_event` marker. |
| `anonymous_quote_completed` | Successful anonymous preview response after its existing internal event has been saved. |
| `quote_saved` | Fresh saved quote response. An account quote emits completion + save (different milestones). Saving an already-completed guest quote emits save only. The browser's older save hook is not mirrored to PostHog. |
| `account_created` | Successful registration response, after identifying the new account. No client-generated internal account event is added. |
| `paid_conversion` | First committed Stripe-backed `subscription_started` or `payg_purchased` internal record for an opted-in account. Checked every 30 seconds. |

Saved-quote retries and edits carry no new success marker, so they do not produce another PostHog completion/save. Anonymous preview regeneration retains the existing semantics: each successful preview is a completion. For a combined completion funnel, match either completion event; do not add a second capture or sum completions and saves as separate quotes.

The server continues to own all internal quote/account/billing facts. `/api/events`, GA4, existing Microsoft Clarity and the quote/payment logic remain intact. PostHog browser successes depend on the response reaching a consenting browser, so totals can be lower than internal reports. This integration does not backfill or replace internal reporting.

Paid conversion sends only once per account, not once per renewal or PAYG purchase. Only existing verified `stripe_webhook` payment records qualify; manual admin grants and Trade Toolkit bundle access are not treated as paid conversions. Pre-consent or historical first purchases are excluded. The exporter reads committed rows without changing payment transactions. Failed delivery retries; its stable UUID/`$insert_id` deduplicates retries and concurrent replicas in PostHog. Delivery receipts survive restarts. Monitor the generic `PostHog paid conversion delivery pending; will retry` log for ingestion failures. No session ID is fabricated for off-session payments.

## Privacy and identity

- PostHog alone is opt-in, with a persistent **Analytics choices** button and a privacy-notice update. No SDK request or PostHog browser ID is created before acceptance. DNT and Global Privacy Control suppress capture. Existing GA/Clarity consent behavior is outside this change.
- Anonymous browser identity is linked with `identify('pq-user-' + user.id)` only after successful authentication/registration. Names, email addresses, JWTs, guest tokens and customer/quote objects are never passed to PostHog. Logout and switching accounts reset browser identity. Anonymous identity is retained across normal public-page/dashboard navigation.
- Event properties are allowlisted. The public SDK ingestion token and identity/session metadata are retained; person properties, referrers, campaign values, titles, query strings, hashes, quote amounts and free text are removed. IP geolocation is disabled. Providers necessarily see transport-level network information.
- Replay masks all text and blocks all form controls, customer quote lists/output, account settings/issues, media, editable elements and potentially sensitive links. Console, network/performance, canvas, exception capture, autocapture, heatmaps, surveys and web experiments are disabled. Snapshot page URLs have queries/hashes removed through the replay masking callback. Masking deliberately reduces replay detail.
- Signed-in consent is stored for server payment reporting. Revocation updates that account from any page with its saved sign-in token; a failed update is visibly reported for retry. Other tabs react to consent storage changes. Already-delivered data is not deleted by withdrawal. Changing a browser choice while signed out cannot revoke a different account's stored choice; sign in or contact support for that account.

## Validation and release checklist

Automated: `node --test` (77 passing), including existing quote, signup, payment, GA and internal-funnel regression tests; added consent/property/identity/paid-retry tests and quote response deduplication assertions.

Real SDK smoke test: `node scripts/posthog-smoke.cjs`. Uses Playwright Chromium, or `CHROME_PATH` for installed Chrome. Only public SDK JavaScript is downloaded; all project configuration and ingestion requests are intercepted with a synthetic token. It verifies no PostHog network before opt-in, real event/replay emission, ingestion-token preservation, fixture-secret masking and withdrawal. This test needs network access for public SDK assets and does not verify ingestion into the live project.

Before production acceptance:

1. Check `/api/analytics/config` is enabled on the deployed build, then decline in a fresh browser: no EU PostHog requests should occur and quoting should work.
2. Accept, visit a landing page, click trial, complete an anonymous quote, view signup, trigger one failed signup, register, save/download, and start checkout. Verify the named events and one linked person in EU Live Events; existing admin/GA reports should continue to work.
3. Inspect a replay containing test names, emails, postcode, job details, quote output, photos and a URL with dummy query/hash values. Confirm masking and inspect payloads; never use real sensitive data for this check.
4. With an approved test billing setup, complete a verified payment and wait up to 30 seconds. Confirm one `paid_conversion`; repeat confirmation/webhook/restart and confirm no second conversion. Do not buy a live subscription solely for testing.
5. Decline via Analytics choices, verify account preference success, and ensure replay stops. Check logout/account switching and blocked SDK behavior.

Live project ingestion, replay appearance/retention, production migration and payment acceptance remain unverified until this deployment checklist is performed.
