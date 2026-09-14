# Profit Quote

AI Quote Builder for UK Tradespeople — by Cambrian Digital / Big Bulldog UK Ltd

## Stack
- Node.js + Express
- PostgreSQL
- JWT authentication
- Hosted on Railway

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
