ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
CREATE TABLE oauth_flows (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  next_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_flows_expiry ON oauth_flows(expires_at);
