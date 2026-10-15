# Customer journey fixes for review

No deployment or merge is included in this change. Design, pricing, quote allowances and calculation rules are unchanged.

- Explicit `?login=1` opens the login form before restoring any cached Guest, expired or registered token. Reset links retain priority. Stored drafts are preserved.
- Registered quote emails use the business contact email as Reply-To, falling back to the account email when no contact email is set. The authenticated account controls this address; the customer-email request cannot override it. Guest senders are asked for their business reply address without creating an account. Invalid addresses are rejected before calling the mail provider. ProfitQuote remains the sender.
- Existing Google tag client/session identifiers accompany public CTA and authenticated funnel events. Query strings and fragments are excluded. Missing/blocked tagging is not replaced with fabricated GA visitors. Internal reporting remains available independently.
- Verified PAYG purchases and the first paid Starter/Pro subscription queue a GA4 `purchase` with GBP value, items and a stable transaction ID. The additive `ga_purchase_outbox` table is created through the existing startup migration. A bounded background worker retries failed sends; delivery receipts and GA transaction IDs protect against duplicate webhook/confirmation deliveries. Subscription renewals are outside this initial-conversion change. Historical attribution is not backfilled.

## Validation

- `node --test --test-concurrency=1`: 89 passed.
- `node scripts/customer-journey-fixes.e2e.cjs`: cached Guest/expired/registered sign-in, draft retention, actual local signup/login, shared browser/session attribution for trial/account/quote events.
- `node scripts/trade-flow.e2e.cjs`: quote calculation, mobile layout, draft reload, real persistence, registered PDF and editing without additional allowance use.
- `node scripts/guest-pdf.e2e.cjs`: guest PDF, repeat/reload, failure handling, Print, Save gate, tampering and cross-guest isolation.
- Focused payment tests cover £5, £19 and £29, unpaid exclusion, webhook/confirmation replay, failed GA delivery and migration reapplication.

All tests used disposable local data. Email, Stripe and Google delivery were mocked; no real emails, purchases or production analytics events were generated. Browser checks used the installed Edge executable via `PQ_BROWSER_PATH`.

## Review/deployment notes

The existing `GA_MEASUREMENT_ID` and `GA_API_SECRET` must refer to the same web stream as browser tag `G-D6L8EB3PWK`. No external analytics settings are changed by this PR. After an approved deployment, verify the first real events in GA4 and inspect an actual business reply address. A successful mocked request cannot prove production provider ingestion or inbox delivery.
