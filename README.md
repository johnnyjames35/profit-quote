# Profit Quote

AI Quote Builder for UK Tradespeople — by Cambrian Digital / Big Bulldog UK Ltd

## Stack
- Node.js + Express
- PostgreSQL
- JWT authentication
- Hosted on Railway

## Trade-aware quote verification

The saved trade supplies the starting job type. Electricians select property/room scope; plumbing uses rooms, systems or fittings. Dimensions remain available for area-based work, including decorating and tiling. Job scope is retained in drafts, saved quotes and customer descriptions. Labour prompts are review heuristics, not minimum-duration claims; the tradesperson remains in control. The margin nudge compares the existing pricing calculation at 30% with the chosen target, including contingency, whole-pound rounding and the materials markup floor, before VAT.

Run `npm test` and `npm run test:e2e` after installing development dependencies and a Playwright Chromium browser (`npx playwright install chromium`). Alternatively set `PQ_BROWSER_PATH` to an installed Chrome executable. The end-to-end test uses real auth/quote routes and disposable PostgreSQL, simulates signup email, blocks external browser requests and does not touch production. Set `PQ_OUTPUT_DIR` to save mobile screenshots and the sample PDF. Automated completion time verifies the flow has no blocking delay; it is not a human usability timing study.

## Setup
1. Clone the repo
2. Add environment variables in Railway (see env.example)
3. Deploy via GitHub

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (Railway provides this)
- `JWT_SECRET` — any long random string
- `PORT` — Railway sets this automatically
- `GOOGLE_SERVICE_ACCOUNT_JSON` — service-account JSON stored only in Railway; never commit a real credential
- `GA4_PROPERTY_ID` — GA4 property ID (ProfitQuote: `532416392`)
- `SEARCH_CONSOLE_SITE_URL` — exact Search Console property URL
- `ADMIN_PASSWORD`, `ADMIN_SECRET` — admin login password and signing secret
- `GA4_HOSTNAME` — report hostname filter; defaults to `profitquote.co.uk`
- `GA_MEASUREMENT_ID`, `GA_API_SECRET` — optional server-side GA4 event forwarding. These are independent of Google reporting credentials and PostgreSQL funnel tracking.

## Reporting verification

Run `node --test` after installing development dependencies. Reporting integration tests use disposable embedded PostgreSQL (PGlite) and simulated Google responses; they do not contact production or prove production Google access.

The Sales Funnel reads `events`, `users`, `quotes`, and `guest_sessions` from `DATABASE_URL`, independently of GA4. Its default is the current UK calendar day; compare All Time when diagnosing zeros. Homepage visits are recorded once per browser tab session, so an admin visit or a homepage reload in that session does not add another visit. Guest activity and registered-user quote activity have separate counters.

For production verification, sign in at `/admin`, refresh Traffic Reporting and Sales Funnel, and compare Today with All Time. Inspect Railway logs if reporting fails. Confirm the service account can read the configured GA4 property and Search Console property. Never replace failed reads with zero metrics. Optional live-report failure should leave the daily report visible; non-JSON responses now include their HTTP status in the displayed error. Google HTTP requests time out after 20 seconds so upstream stalls can return an API error.

## Daily traffic reporting

Authenticated administrators can request `GET /api/admin/reporting/daily`. GA4 defaults to the previous UK calendar day, while Search Console defaults to two days earlier so its daily figures are finalised; use `?date=YYYY-MM-DD` for a specific GA4 day. The endpoint reads GA4 users, sessions, channels and landing pages plus Search Console clicks, impressions, CTR and average position. Search Console detail uses the rolling 30 days ending on the finalised date. It includes query + page combinations, classifies combinations with at least five impressions at positions 8–30 as quick wins and positions 31–100 as longer-term opportunities, and flags positions based on only one or two impressions. Property-wide average position is explicitly labelled as an aggregate rather than a rank for a particular search. It also returns rolling 7-day and 30-day totals compared with their immediately preceding periods. It requests Google's read-only scopes and does not persist reporting data or credentials.

## Three-quote allowance and billing

Guests and accounts share three free generated quotes. Signup and deleting quotes do not reset use. A signed browser cookie and persisted browser identifier share the allowance across repeat accounts; signup is capped at five accounts per network per 24 hours. Clearing all browser storage or changing devices/networks can still evade these lightweight controls. Existing saved quotes remain editable and exportable. This is abuse reduction, not identity verification.

The startup schema migration seeds existing accounts from their saved quotes and preserves counters on subsequent runs. Existing explicit admin paid grants remain valid. Stripe-managed access requires a paid checkout for the configured ProfitQuote payment link plus an active subscription with an unexpired paid period. No card or payment is required for the first three quotes.

Configure STRIPE_WEBHOOK_SECRET in the hosting service for POST /api/billing/webhook. Subscribe to checkout.session.completed, checkout.session.async_payment_succeeded and customer.subscription.created/updated/deleted/paused/resumed. The route verifies the signature against the raw request body and records processed event IDs. Checkout URLs must come from authenticated POST /api/billing/checkout so the random account reference is included; an unreferenced direct payment requires support reconciliation. Set the payment link return URL to /dashboard?billing=returned.

Run node --test test/*.test.js. Integration coverage includes signup preservation, retry idempotency, concurrent final credit requests, deletion, repeat signup, signed payment notifications in different orders, cancellation, and saved-quote export/email ownership.

Quotation PDFs use the shared public/quotation-document.js template and bundled Chromium on Linux. Node 22.17+ is required. For local Windows/macOS testing, set PQ_BROWSER_PATH to an installed Chromium browser. Run npm run test:pdf for the isolated guest desktop download checks. No customer PDF files are stored on the server.
