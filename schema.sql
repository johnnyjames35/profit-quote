CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  trade VARCHAR(100),
  plan VARCHAR(20) DEFAULT 'solo',
  day_rate DECIMAL(10,2) DEFAULT 250,
  hourly_rate DECIMAL(10,2) DEFAULT 35,
  markup_percent INTEGER DEFAULT 20,
  profit_target INTEGER DEFAULT 30,
  vat_registered BOOLEAN DEFAULT true,
  skip_clean DECIMAL(10,2) DEFAULT 180,
  skip_mixed DECIMAL(10,2) DEFAULT 240,
  skip_plasterboard DECIMAL(10,2) DEFAULT 320,
  skip_inert DECIMAL(10,2) DEFAULT 200,
  skip_hazardous DECIMAL(10,2) DEFAULT 480,
  trial_started_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMP DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS town VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS overhead_per_day DECIMAL(10,2) DEFAULT 50;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS guest_sessions (
  id UUID PRIMARY KEY,
  browser_hash VARCHAR(64) UNIQUE NOT NULL,
  ip_hash VARCHAR(64) NOT NULL,
  quote_count INTEGER NOT NULL DEFAULT 0,
  ai_requests INTEGER NOT NULL DEFAULT 0,
  converted_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);
CREATE INDEX IF NOT EXISTS guest_sessions_ip_created_idx ON guest_sessions(ip_hash, created_at);

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  customer_name VARCHAR(200),
  trade VARCHAR(100),
  job_description TEXT,
  spec_level VARCHAR(20),
  skip_type VARCHAR(30),
  skip_cost DECIMAL(10,2),
  day_rate DECIMAL(10,2),
  days DECIMAL(5,1),
  markup_percent INTEGER,
  profit_target INTEGER,
  other_costs TEXT,
  quote_data JSONB,
  total DECIMAL(10,2),
  profit_percent DECIMAL(5,2),
  status VARCHAR(20) DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES guest_sessions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS quotes_guest_id_idx ON quotes(guest_id);

-- Durable free allowance: deleting a quote or opening another account never resets it.
CREATE TABLE IF NOT EXISTS quote_allowances (
  id UUID PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_id UUID REFERENCES quote_allowances(id);
ALTER TABLE guest_sessions ADD COLUMN IF NOT EXISTS trial_id UUID REFERENCES quote_allowances(id);
INSERT INTO quote_allowances(id,used)
  SELECT md5('user:'||u.id)::uuid, COUNT(q.id)::int FROM users u LEFT JOIN quotes q ON q.user_id=u.id
  WHERE u.trial_id IS NULL GROUP BY u.id ON CONFLICT DO NOTHING;
UPDATE users SET trial_id=md5('user:'||id)::uuid WHERE trial_id IS NULL;
INSERT INTO quote_allowances(id,used)
  SELECT md5('guest:'||id)::uuid,quote_count FROM guest_sessions WHERE trial_id IS NULL AND converted_user_id IS NULL
  ON CONFLICT DO NOTHING;
UPDATE guest_sessions g SET trial_id=u.trial_id FROM users u WHERE g.converted_user_id=u.id AND g.trial_id IS NULL;
UPDATE guest_sessions SET trial_id=md5('guest:'||id)::uuid WHERE trial_id IS NULL;
CREATE TABLE IF NOT EXISTS trial_browsers (browser_hash TEXT PRIMARY KEY, trial_id UUID NOT NULL REFERENCES quote_allowances(id));
INSERT INTO trial_browsers SELECT browser_hash,trial_id FROM guest_sessions ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS signup_attempts (ip_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS signup_attempts_ip_idx ON signup_attempts(ip_hash,created_at);
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_reference UUID DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS users_billing_reference_idx ON users(billing_reference);
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending', period_end TIMESTAMPTZ, event_created BIGINT NOT NULL DEFAULT 0,
  checkout_paid BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS billing_events (id TEXT PRIMARY KEY, processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
-- Commercial model v2. Shared trial dates survive account/quote deletion.
ALTER TABLE quote_allowances ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
UPDATE quote_allowances a SET trial_started_at=u.started FROM
 (SELECT trial_id,MIN(trial_started_at) AS started FROM users GROUP BY trial_id) u
 WHERE a.id=u.trial_id AND a.trial_started_at IS NULL;
CREATE TABLE IF NOT EXISTS commercial_subscriptions (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 customer_id TEXT NOT NULL, plan TEXT NOT NULL CHECK(plan IN ('starter','pro')),
 status TEXT NOT NULL, period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ NOT NULL,
 verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS commercial_payments (
 session_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 amount INTEGER NOT NULL, credit_available BOOLEAN NOT NULL DEFAULT TRUE,
 payment_intent TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS commercial_usage (
 id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL, period_start TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS commercial_usage_period ON commercial_usage(user_id,subscription_id,period_start);
CREATE TABLE IF NOT EXISTS commercial_checkouts (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL, plan TEXT NOT NULL
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_managed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS creation_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS quotes_creation_key_idx ON quotes(creation_key) WHERE creation_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS issues (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  issue_type VARCHAR(50),
  description TEXT,
  extra_hours DECIMAL(5,1),
  extra_materials DECIMAL(10,2),
  hourly_rate DECIMAL(10,2),
  total_extra DECIMAL(10,2),
  variation_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS job_photos (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP;

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source VARCHAR(50),
  meta JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
UPDATE users u
SET first_login_at = COALESCE(u.first_login_at, first_logins.created_at),
    last_active_at = COALESCE(u.last_active_at, first_logins.created_at)
FROM (
  SELECT user_id, MIN(created_at) AS created_at
  FROM events
  WHERE event_type = 'first_login' AND user_id IS NOT NULL
  GROUP BY user_id
) first_logins
WHERE u.id = first_logins.user_id
  AND (u.first_login_at IS NULL OR u.last_active_at IS NULL);

CREATE TABLE IF NOT EXISTS template_downloads (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  source VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_bundle_access (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 subscription_id TEXT UNIQUE NOT NULL,customer_id TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,valid_until TIMESTAMPTZ,
 plan TEXT NOT NULL DEFAULT 'starter',allowance INTEGER NOT NULL DEFAULT 0,
 stripe_status TEXT NOT NULL DEFAULT 'pending',warning TEXT NOT NULL DEFAULT '',checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_emails_enabled BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS trial_campaign_log(user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,stage TEXT NOT NULL,sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,stage));
