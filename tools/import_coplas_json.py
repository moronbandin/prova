#!/usr/bin/env python3
import json
import sqlite3
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db" / "coplas.sqlite"
TERRITORIES_JSON = ROOT / "data" / "canonical" / "territorios.json"


def normalize_text(text: str) -> str:
    text = text.strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = " ".join(text.split())
    return text


def slugify(text: str) -> str:
    text = normalize_text(text)
    return text.replace(" ", "-")


def make_incipit(text: str, max_words: int = 6) -> str:
    words = text.strip().split()
    return " ".join(words[:max_words])


def load_known_territories():
    with TERRITORIES_JSON.open(encoding="utf-8") as f:
        data = json.load(f)
    return {item["id"]: item for item in data}


def get_or_create_tag(conn, tag_name: str) -> int:
    existing = conn.execute(
        "SELECT id FROM tags WHERE name = ?",
        (tag_name,),
    ).fetchone()

    if existing:
        return existing["id"]

    cur = conn.execute(
        """
        INSERT INTO tags (name, slug)
        VALUES (?, ?)
        """,
        (tag_name, slugify(tag_name)),
    )
    return cur.lastrowid


def validate_copla(copla: dict, known_territories: dict, index: int):
    errors = []

    if not isinstance(copla, dict):
        return [f"Copla #{index}: non é un obxecto JSON."]

    text = copla.get("text")
    if not isinstance(text, str) or not text.strip():
        errors.append(f"Copla #{index}: falta 'text' ou está baleiro.")

    notes = copla.get("notes", "")
    if notes is not None and not isinstance(notes, str):
        errors.append(f"Copla #{index}: 'notes' debe ser string ou omitirse.")

    tags = copla.get("tags", [])
    if not isinstance(tags, list):
        errors.append(f"Copla #{index}: 'tags' debe ser unha lista.")
    else:
        for tag in tags:
            if not isinstance(tag, str) or not tag.strip():
                errors.append(f"Copla #{index}: hai unha etiqueta non válida.")

    territories = copla.get("territories", [])
    if not isinstance(territories, list):
        errors.append(f"Copla #{index}: 'territories' debe ser unha lista.")
    else:
        for t in territories:
            if not isinstance(t, dict):
                errors.append(f"Copla #{index}: cada territorio debe ser un obxecto.")
                continue
            tid = t.get("id")
            if not isinstance(tid, str) or not tid.strip():
                errors.append(f"Copla #{index}: hai un territorio sen 'id'.")
                continue
            if tid not in known_territories:
                errors.append(f"Copla #{index}: territorio descoñecido: {tid}")

    return errors


def import_coplas(json_path: Path):
    if not json_path.exists():
        print(f"Non existe o ficheiro: {json_path}")
        sys.exit(1)

    with json_path.open(encoding="utf-8") as f:
        payload = json.load(f)

    if not isinstance(payload, dict) or "coplas" not in payload:
        print("O JSON debe ser un obxecto con clave 'coplas'.")
        sys.exit(1)

    coplas = payload["coplas"]
    if not isinstance(coplas, list):
        print("'coplas' debe ser unha lista.")
        sys.exit(1)

    known_territories = load_known_territories()

    all_errors = []
    for idx, copla in enumerate(coplas, start=1):
        errors = validate_copla(copla, known_territories, idx)
        all_errors.extend(errors)

    if all_errors:
        print("\n=== ERROS DE VALIDACIÓN ===\n")
        for err in all_errors:
            print(f"- {err}")
        print("\nImportación cancelada.")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    imported_ids = []

    try:
        for copla in coplas:
            text = copla["text"].strip()
            normalized_text = normalize_text(text)
            incipit = make_incipit(text)
            notes = copla.get("notes", "") or None
            tags = [t.strip().lower() for t in copla.get("tags", []) if t.strip()]
            territories = copla.get("territories", [])

            cur = conn.execute(
                """
                INSERT INTO coplas (text, normalized_text, incipit, notes)
                VALUES (?, ?, ?, ?)
                """,
                (text, normalized_text, incipit, notes),
            )
            copla_id = cur.lastrowid
            imported_ids.append(copla_id)

            for terr in territories:
                conn.execute(
                    """
                    INSERT INTO copla_territories (copla_id, territory_id, relation_type, is_direct)
                    VALUES (?, ?, 'direct', 1)
                    """,
                    (copla_id, terr["id"]),
                )

            for tag_name in tags:
                tag_id = get_or_create_tag(conn, tag_name)
                conn.execute(
                    """
                    INSERT OR IGNORE INTO copla_tags (copla_id, tag_id)
                    VALUES (?, ?)
                    """,
                    (copla_id, tag_id),
                )

        conn.commit()

        print("\n=== IMPORTACIÓN COMPLETADA ===\n")
        print(f"Coplas importadas: {len(imported_ids)}")
        if imported_ids:
            print("IDs creados:", ", ".join(str(i) for i in imported_ids))

    finally:
        conn.close()


def main():
    if len(sys.argv) != 2:
        print("Uso:")
        print("  python3 tools/import_coplas_json.py ruta/ao/ficheiro.json")
        sys.exit(1)

    json_path = Path(sys.argv[1]).resolve()
    import_coplas(json_path)


if __name__ == "__main__":
    main()