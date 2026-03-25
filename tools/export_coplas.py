#!/usr/bin/env python3
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db" / "coplas.sqlite"
EXPORT_DIR = ROOT / "data" / "exports" / "coplas"
EXPORT_FILE = EXPORT_DIR / "coplas.json"

EXPORT_DIR.mkdir(parents=True, exist_ok=True)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

try:
    coplas = conn.execute(
        """
        SELECT
          c.id,
          c.text,
          c.normalized_text,
          c.incipit,
          c.notes,
          c.created_at
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

        result.append({
            "id": copla["id"],
            "text": copla["text"],
            "normalized_text": copla["normalized_text"],
            "incipit": copla["incipit"],
            "notes": copla["notes"],
            "created_at": copla["created_at"],
            "territories": [dict(t) for t in territories],
            "tags": [t["name"] for t in tags],
        })

    with EXPORT_FILE.open("w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"Exportadas {len(result)} coplas a {EXPORT_FILE}")
finally:
    conn.close()