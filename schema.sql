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
