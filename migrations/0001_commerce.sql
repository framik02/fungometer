PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
  trial_started_at INTEGER, trial_ends_at INTEGER, analytics INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_codes (id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), plan TEXT NOT NULL,
  amount INTEGER NOT NULL, days INTEGER NOT NULL, mode TEXT NOT NULL,
  created_at INTEGER NOT NULL, session_id TEXT UNIQUE, checkout_url TEXT,
  payment_intent TEXT UNIQUE, paid_at INTEGER, access_start INTEGER, access_end INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0, terms_version TEXT NOT NULL
);
CREATE INDEX orders_user ON orders(user_id, access_end);
CREATE TABLE webhook_events (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
CREATE TABLE funnel_events (user_id TEXT NOT NULL REFERENCES users(id), event TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(user_id,event,day));
