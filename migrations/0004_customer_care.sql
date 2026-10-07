CREATE TABLE order_documents (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  confirmation_sent_at INTEGER
);
CREATE TABLE service_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('privacy','deletion','withdrawal','support')),
  order_id TEXT REFERENCES orders(id),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution TEXT
);
CREATE INDEX service_requests_open ON service_requests(resolved_at,due_at);
CREATE UNIQUE INDEX service_requests_one_deletion ON service_requests(user_id) WHERE kind='deletion' AND resolved_at IS NULL;
ALTER TABLE users ADD COLUMN privacy_delete_token TEXT;
CREATE TABLE privacy_deletions (id TEXT PRIMARY KEY,completed_at INTEGER NOT NULL);
