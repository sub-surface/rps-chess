-- Signup throttle buckets. `/api/account` is the one unauthenticated endpoint that writes
-- an unbounded row, so repeat mints from one source are counted in a rolling window.
-- The key is a salted, truncated hash of the client IP: enough to count, never stored
-- against an account, and not reversible to an address without the deployment secret.
-- Rows are pruned as they age out, so this table stays proportional to live traffic.
CREATE TABLE signups (
  ip_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE INDEX idx_signups_window ON signups(window_start);
