PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS copla_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  copla_id INTEGER NOT NULL,
  label TEXT,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  incipit TEXT,
  notes TEXT,
  position INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (copla_id) REFERENCES coplas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_copla_versions_copla_id ON copla_versions(copla_id);
CREATE INDEX IF NOT EXISTS idx_copla_versions_normalized_text ON copla_versions(normalized_text);
