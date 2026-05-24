CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS capabilities (
  id              TEXT PRIMARY KEY,
  source_type     TEXT NOT NULL,
  name            TEXT NOT NULL,
  canonical_name  TEXT NOT NULL,
  description     TEXT,
  keywords        TEXT,
  installed       INTEGER NOT NULL,
  enabled         INTEGER,
  bundle_id       TEXT,
  bundle_version  TEXT,
  bundle_path     TEXT,
  source_url      TEXT,
  source_sha      TEXT,
  last_seen_epoch INTEGER NOT NULL,
  content_hash    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_capabilities_source_type ON capabilities(source_type);
CREATE INDEX IF NOT EXISTS idx_capabilities_bundle_id ON capabilities(bundle_id);

CREATE VIRTUAL TABLE IF NOT EXISTS capabilities_fts USING fts5(
  name, canonical_name, description, keywords,
  content='capabilities', content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS capabilities_ai AFTER INSERT ON capabilities BEGIN
  INSERT INTO capabilities_fts(rowid, name, canonical_name, description, keywords)
  VALUES (new.rowid, new.name, new.canonical_name, new.description, new.keywords);
END;

CREATE TRIGGER IF NOT EXISTS capabilities_ad AFTER DELETE ON capabilities BEGIN
  INSERT INTO capabilities_fts(capabilities_fts, rowid, name, canonical_name, description, keywords)
  VALUES('delete', old.rowid, old.name, old.canonical_name, old.description, old.keywords);
END;

CREATE TRIGGER IF NOT EXISTS capabilities_au AFTER UPDATE ON capabilities BEGIN
  INSERT INTO capabilities_fts(capabilities_fts, rowid, name, canonical_name, description, keywords)
  VALUES('delete', old.rowid, old.name, old.canonical_name, old.description, old.keywords);
  INSERT INTO capabilities_fts(rowid, name, canonical_name, description, keywords)
  VALUES (new.rowid, new.name, new.canonical_name, new.description, new.keywords);
END;

CREATE TABLE IF NOT EXISTS install_history (
  capability_id   TEXT NOT NULL,
  source_sha      TEXT NOT NULL,
  installed_at    INTEGER NOT NULL,
  installed_by    TEXT,
  PRIMARY KEY (capability_id, installed_at)
);

CREATE TABLE IF NOT EXISTS trust_pins (
  capability_id   TEXT PRIMARY KEY,
  source_sha      TEXT NOT NULL,
  pinned_at       INTEGER NOT NULL,
  pinned_by       TEXT NOT NULL,
  source_url      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_tool_cache (
  server_name        TEXT PRIMARY KEY,
  server_config_hash TEXT NOT NULL,
  tools_json         TEXT NOT NULL,
  fetched_at         INTEGER NOT NULL
);
