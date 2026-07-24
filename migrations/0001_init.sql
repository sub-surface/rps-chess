-- Accounts are device-bound pseudonyms: an unguessable id + secret pair minted by the
-- Worker. Ratings are plain Elo, updated transactionally alongside each match row.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  rating REAL NOT NULL DEFAULT 1200,
  peak REAL NOT NULL DEFAULT 1200,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);

-- One row per completed rated game. The primary key doubles as the idempotency guard:
-- the insert shares a transaction with both rating updates, so a duplicate report
-- fails the whole batch and nothing double-counts.
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  blue TEXT NOT NULL REFERENCES accounts(id),
  red TEXT NOT NULL REFERENCES accounts(id),
  winner TEXT,                 -- 'B' | 'R' | NULL for a draw
  reason TEXT NOT NULL,        -- 'board' | 'abandon'
  variant TEXT NOT NULL,
  delta_b REAL NOT NULL,
  delta_r REAL NOT NULL,
  rating_b REAL NOT NULL,      -- post-game snapshots
  rating_r REAL NOT NULL,
  played_at INTEGER NOT NULL
);

CREATE INDEX idx_matches_blue ON matches(blue, played_at);
CREATE INDEX idx_matches_red ON matches(red, played_at);
