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
  created_at TIMESTAMP DEFAULT NOW()
);

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
