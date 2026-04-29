PRAGMA foreign_keys = OFF;

ALTER TABLE coplas ADD COLUMN status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE coplas ADD COLUMN updated_at TEXT;
UPDATE coplas SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE pieces RENAME TO pieces_old;

CREATE TABLE pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  author TEXT NOT NULL DEFAULT '',
  context_territory_id TEXT,
  description TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (context_territory_id) REFERENCES territories(id)
);

INSERT INTO pieces (
  id,
  title,
  slug,
  author,
  context_territory_id,
  description,
  notes,
  status,
  created_at,
  updated_at
)
SELECT
  id,
  title,
  slug,
  '',
  NULL,
  description,
  NULL,
  'draft',
  created_at,
  CURRENT_TIMESTAMP
FROM pieces_old;

DROP TABLE pieces_old;

ALTER TABLE piece_coplas RENAME TO piece_coplas_old;

CREATE TABLE piece_coplas (
  piece_id INTEGER NOT NULL,
  copla_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  section_label TEXT,
  notes TEXT,
  PRIMARY KEY (piece_id, position),
  FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE,
  FOREIGN KEY (copla_id) REFERENCES coplas(id) ON DELETE CASCADE
);

INSERT INTO piece_coplas (piece_id, copla_id, position, section_label, notes)
SELECT piece_id, copla_id, position, NULL, NULL
FROM piece_coplas_old;

DROP TABLE piece_coplas_old;

ALTER TABLE media RENAME TO media_old;

CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'other',
  media_kind TEXT NOT NULL DEFAULT 'external',
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  author_or_source TEXT,
  thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO media (
  id,
  provider,
  media_kind,
  title,
  url,
  description,
  author_or_source,
  thumbnail_url,
  status,
  created_at,
  updated_at
)
SELECT
  id,
  'other',
  type,
  title,
  url,
  description,
  NULL,
  NULL,
  'published',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM media_old;

DROP TABLE media_old;

ALTER TABLE media_links RENAME TO media_links_old;

CREATE TABLE media_links (
  media_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'direct',
  PRIMARY KEY (media_id, entity_type, entity_id),
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

INSERT INTO media_links (media_id, entity_type, entity_id, relation_type)
SELECT media_id, entity_type, entity_id, 'direct'
FROM media_links_old;

DROP TABLE media_links_old;

PRAGMA foreign_keys = ON;
