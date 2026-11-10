CREATE TABLE IF NOT EXISTS users (
  id           BIGINT PRIMARY KEY,
  username     TEXT,
  multiplier   INT  NOT NULL DEFAULT 1,
  max_capacity INT  NOT NULL DEFAULT 600,
  automine     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payments (
  charge_id  TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  item_key   TEXT NOT NULL,
  stars      INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS referrals (
  referred_id BIGINT PRIMARY KEY REFERENCES users(id),
  referrer_id BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
