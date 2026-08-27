# Profit Quote

AI Quote Builder for UK Tradespeople — by Cambrian Digital / Big Bulldog UK Ltd

## Stack
- Node.js + Express
- PostgreSQL
- JWT authentication
- Hosted on Railway

## Setup
1. Clone the repo
2. Add environment variables in Railway (see .env.example)
3. Deploy via GitHub

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (Railway provides this)
- `JWT_SECRET` — any long random string
- `PORT` — Railway sets this automatically
- `GOOGLE_SERVICE_ACCOUNT_JSON` — service-account JSON stored only in Railway; never commit a real credential
- `GA4_PROPERTY_ID` — GA4 property ID (ProfitQuote: `532416392`)
- `SEARCH_CONSOLE_SITE_URL` — exact Search Console property URL

## Daily traffic reporting

Authenticated administrators can request `GET /api/admin/reporting/daily`. GA4 defaults to the previous UK calendar day, while Search Console defaults to two days earlier so its daily figures are finalised; use `?date=YYYY-MM-DD` for a specific GA4 day. The endpoint reads GA4 users, sessions, channels and landing pages plus Search Console clicks, impressions, CTR and average position. Top Search Console queries and pages use the rolling 30 days ending on the finalised Search Console date, return the 15 strongest impression opportunities, and include clicks, impressions, CTR and average position. It also returns rolling 7-day and 30-day totals compared with their immediately preceding periods. It requests Google's read-only scopes and does not persist reporting data or credentials.
