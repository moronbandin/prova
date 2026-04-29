import json
import sqlite3

from .db_paths import (
    COPLAS_EXPORT_DIR,
    COPLAS_EXPORT_JSON,
    MEDIA_EXPORT_DIR,
    MEDIA_EXPORT_JSON,
    PIECES_EXPORT_DIR,
    PIECES_EXPORT_JSON,
    TERRITORIES_EXPORT_DIR,
    TERRITORIES_EXPORT_JSON,
)


def ensure_export_dirs() -> None:
    TERRITORIES_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    COPLAS_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    PIECES_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    MEDIA_EXPORT_DIR.mkdir(parents=True, exist_ok=True)


def export_territories(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
          id,
          tipo,
          cod,
          nome,
          slug,
          search,
          prov_cod AS prov,
          com_cod AS com,
          con_cod AS con,
          parent_id
        FROM territories
        ORDER BY tipo, nome
        """
    ).fetchall()
    return [dict(row) for row in rows]


def export_coplas(conn: sqlite3.Connection) -> list[dict]:
    coplas = conn.execute(
        """
        SELECT
          c.id,
          c.text,
          c.normalized_text,
          c.incipit,
          c.notes,
          c.status,
          c.created_at,
          c.updated_at
        FROM coplas c
        ORDER BY c.id DESC
        """
    ).fetchall()

    result = []
    for copla in coplas:
        territories = conn.execute(
            """
            SELECT t.id, t.nome, t.tipo, ct.relation_type, ct.is_direct
            FROM copla_territories ct
            JOIN territories t ON t.id = ct.territory_id
            WHERE ct.copla_id = ?
            ORDER BY t.tipo, t.nome
            """,
            (copla["id"],),
        ).fetchall()
        tags = conn.execute(
            """
            SELECT tg.name
            FROM copla_tags ct
            JOIN tags tg ON tg.id = ct.tag_id
            WHERE ct.copla_id = ?
            ORDER BY tg.name
            """,
            (copla["id"],),
        ).fetchall()

        result.append(
            {
                "id": copla["id"],
                "text": copla["text"],
                "normalized_text": copla["normalized_text"],
                "incipit": copla["incipit"],
                "notes": copla["notes"],
                "status": copla["status"],
                "created_at": copla["created_at"],
                "updated_at": copla["updated_at"],
                "territories": [dict(item) for item in territories],
                "tags": [item["name"] for item in tags],
            }
        )

    return result


def export_pieces(conn: sqlite3.Connection) -> list[dict]:
    pieces = conn.execute(
        """
        SELECT
          p.id,
          p.title,
          p.slug,
          p.author,
          p.context_territory_id,
          p.description,
          p.notes,
          p.status,
          p.created_at,
          p.updated_at,
          t.nome AS context_nome,
          t.tipo AS context_tipo
        FROM pieces p
        LEFT JOIN territories t ON t.id = p.context_territory_id
        ORDER BY p.updated_at DESC, p.id DESC
        """
    ).fetchall()

    result = []
    for piece in pieces:
        coplas = conn.execute(
            """
            SELECT
              pc.position,
              pc.section_label,
              pc.notes,
              c.id,
              c.incipit,
              c.text
            FROM piece_coplas pc
            JOIN coplas c ON c.id = pc.copla_id
            WHERE pc.piece_id = ?
            ORDER BY pc.position ASC
            """,
            (piece["id"],),
        ).fetchall()

        result.append(
            {
                "id": piece["id"],
                "title": piece["title"],
                "slug": piece["slug"],
                "author": piece["author"],
                "context_territory": (
                    {
                        "id": piece["context_territory_id"],
                        "nome": piece["context_nome"],
                        "tipo": piece["context_tipo"],
                    }
                    if piece["context_territory_id"]
                    else None
                ),
                "description": piece["description"],
                "notes": piece["notes"],
                "status": piece["status"],
                "created_at": piece["created_at"],
                "updated_at": piece["updated_at"],
                "copla_count": len(coplas),
                "coplas": [dict(item) for item in coplas],
            }
        )

    return result


def export_media(conn: sqlite3.Connection) -> list[dict]:
    media_rows = conn.execute(
        """
        SELECT
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
        FROM media
        ORDER BY updated_at DESC, id DESC
        """
    ).fetchall()

    result = []
    for media in media_rows:
        links = conn.execute(
            """
            SELECT entity_type, entity_id, relation_type
            FROM media_links
            WHERE media_id = ?
            ORDER BY entity_type, entity_id
            """,
            (media["id"],),
        ).fetchall()
        result.append(
            {
                "id": media["id"],
                "provider": media["provider"],
                "media_kind": media["media_kind"],
                "title": media["title"],
                "url": media["url"],
                "description": media["description"],
                "author_or_source": media["author_or_source"],
                "thumbnail_url": media["thumbnail_url"],
                "status": media["status"],
                "created_at": media["created_at"],
                "updated_at": media["updated_at"],
                "links": [dict(item) for item in links],
            }
        )

    return result


def write_json(path, payload) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def export_web(conn: sqlite3.Connection) -> dict[str, int]:
    ensure_export_dirs()

    territories = export_territories(conn)
    coplas = export_coplas(conn)
    pieces = export_pieces(conn)
    media = export_media(conn)

    write_json(TERRITORIES_EXPORT_JSON, territories)
    write_json(COPLAS_EXPORT_JSON, coplas)
    write_json(PIECES_EXPORT_JSON, pieces)
    write_json(MEDIA_EXPORT_JSON, media)

    return {
        "territories": len(territories),
        "coplas": len(coplas),
        "pieces": len(pieces),
        "media": len(media),
    }
