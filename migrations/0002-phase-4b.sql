-- Public stage bodies stay immutable. Only anonymous visit details and counters change.
CREATE TABLE stage_visitors (
  stage_id INTEGER NOT NULL REFERENCES published_stages(id),
  visitor_key TEXT NOT NULL,
  first_play_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_clear_at TEXT,
  PRIMARY KEY (stage_id, visitor_key)
);
CREATE TABLE stage_month_visitors (
  stage_id INTEGER NOT NULL REFERENCES published_stages(id),
  month_key TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  first_play_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_clear_at TEXT,
  PRIMARY KEY (stage_id, month_key, visitor_key)
);
CREATE INDEX idx_month_visitors_retention ON stage_month_visitors(month_key);
CREATE TABLE stage_stats (
  stage_id INTEGER PRIMARY KEY REFERENCES published_stages(id),
  unique_plays INTEGER NOT NULL DEFAULT 0,
  unique_clears INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE stage_month_stats (
  stage_id INTEGER NOT NULL REFERENCES published_stages(id),
  month_key TEXT NOT NULL,
  unique_plays INTEGER NOT NULL DEFAULT 0,
  unique_clears INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (stage_id, month_key)
);
CREATE INDEX idx_month_stats_rank ON stage_month_stats(month_key, unique_plays DESC, unique_clears DESC);
CREATE INDEX idx_stage_stats_rank ON stage_stats(unique_plays DESC, unique_clears DESC);
CREATE TABLE community_rate_limits (
  rate_key TEXT NOT NULL,
  window_minute TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rate_key, window_minute)
);
CREATE INDEX idx_community_rate_retention ON community_rate_limits(window_minute);

CREATE TRIGGER stage_visitor_play AFTER INSERT ON stage_visitors BEGIN
  INSERT INTO stage_stats(stage_id, unique_plays) VALUES (NEW.stage_id, 1)
    ON CONFLICT(stage_id) DO UPDATE SET unique_plays = unique_plays + 1;
END;
CREATE TRIGGER stage_visitor_clear AFTER UPDATE OF first_clear_at ON stage_visitors
WHEN OLD.first_clear_at IS NULL AND NEW.first_clear_at IS NOT NULL BEGIN
  UPDATE stage_stats SET unique_clears = unique_clears + 1 WHERE stage_id = NEW.stage_id;
END;
CREATE TRIGGER stage_month_visitor_play AFTER INSERT ON stage_month_visitors BEGIN
  INSERT INTO stage_month_stats(stage_id, month_key, unique_plays) VALUES (NEW.stage_id, NEW.month_key, 1)
    ON CONFLICT(stage_id, month_key) DO UPDATE SET unique_plays = unique_plays + 1;
END;
CREATE TRIGGER stage_month_visitor_clear AFTER UPDATE OF first_clear_at ON stage_month_visitors
WHEN OLD.first_clear_at IS NULL AND NEW.first_clear_at IS NOT NULL BEGIN
  UPDATE stage_month_stats SET unique_clears = unique_clears + 1
  WHERE stage_id = NEW.stage_id AND month_key = NEW.month_key;
END;

