PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stage_bodies (
  content_hash TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  columns_count INTEGER NOT NULL CHECK (columns_count = 10),
  rows_count INTEGER NOT NULL CHECK (rows_count = 12),
  blocks_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS published_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE CHECK (length(public_id) = 16),
  body_hash TEXT NOT NULL REFERENCES stage_bodies(content_hash),
  author_clear_ms INTEGER NOT NULL CHECK (author_clear_ms BETWEEN 100 AND 3600000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_published_stages_status_created
  ON published_stages(status, created_at DESC);

CREATE TABLE IF NOT EXISTS publish_rate_limits (
  rate_key TEXT NOT NULL,
  window_date TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rate_key, window_date)
);


