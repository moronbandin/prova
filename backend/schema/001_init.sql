PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS territories (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  cod INTEGER NOT NULL,
  nome TEXT NOT NULL,
  slug TEXT NOT NULL,
  search TEXT NOT NULL,
  prov_cod INTEGER,
  com_cod INTEGER,
  con_cod INTEGER,
  parent_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_territories_tipo ON territories(tipo);
CREATE INDEX IF NOT EXISTS idx_territories_nome ON territories(nome);
CREATE INDEX IF NOT EXISTS idx_territories_prov_cod ON territories(prov_cod);
CREATE INDEX IF NOT EXISTS idx_territories_cod ON territories(cod);

CREATE TABLE IF NOT EXISTS coplas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  incipit TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coplas_normalized_text ON coplas(normalized_text);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

CREATE TABLE IF NOT EXISTS copla_tags (
  copla_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (copla_id, tag_id),
  FOREIGN KEY (copla_id) REFERENCES coplas(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  author TEXT NOT NULL,
  context_territory_id TEXT,
  description TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (context_territory_id) REFERENCES territories(id)
);

CREATE TABLE IF NOT EXISTS copla_territories (
  copla_id INTEGER NOT NULL,
  territory_id TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'direct',
  is_direct INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (copla_id, territory_id, relation_type),
  FOREIGN KEY (copla_id) REFERENCES coplas(id) ON DELETE CASCADE,
  FOREIGN KEY (territory_id) REFERENCES territories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS piece_coplas (
  piece_id INTEGER NOT NULL,
  copla_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  section_label TEXT,
  notes TEXT,
  PRIMARY KEY (piece_id, position),
  FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE,
  FOREIGN KEY (copla_id) REFERENCES coplas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  author_or_source TEXT,
  thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_links (
  media_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'direct',
  PRIMARY KEY (media_id, entity_type, entity_id),
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);
