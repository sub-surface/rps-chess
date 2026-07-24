-- A tiny, public replay feed for the homepage theatre. This belongs in D1 rather
-- than the global Lobby Durable Object: it is historical data, not coordination.
CREATE TABLE showcases (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  played_at INTEGER NOT NULL
);

CREATE INDEX idx_showcases_played_at ON showcases(played_at DESC);
