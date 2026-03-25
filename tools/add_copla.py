#!/usr/bin/env python3
import sqlite3
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "db" / "coplas.sqlite"


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


def search_territories(conn, query: str):
    query = query.strip().lower()

    if query.isdigit():
        rows = conn.execute(
            """
            SELECT id, tipo, cod, nome
            FROM territories
            WHERE cod = ?
            ORDER BY tipo, nome
            """,
            (int(query),),
        ).fetchall()
        return rows

    like_query = f"%{query}%"
    rows = conn.execute(
        """
        SELECT id, tipo, cod, nome
        FROM territories
        WHERE lower(nome) LIKE ?
           OR lower(search) LIKE ?
           OR lower(id) LIKE ?
           OR CAST(cod AS TEXT) LIKE ?
        ORDER BY tipo, nome
        """,
        (like_query, like_query, like_query, like_query),
    ).fetchall()
    return rows


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


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    try:
        print("\n=== Engadir copla ===\n")

        print("Texto da copla (remata cunha liña baleira):")
        lines = []
        while True:
            line = input()
            if line == "":
                break
            lines.append(line)

        text = "\n".join(lines).strip()

        if not text:
            print("Non se pode gardar unha copla baleira.")
            return

        normalized_text = normalize_text(text)
        incipit = make_incipit(text)
        notes = input("Notas (opcional): ").strip()

        territory_id = None

        territory_choice = input("Queres engadir territorio? [s/N]: ").strip().lower()
        if territory_choice == "s":
            query = input("Busca territorio por nome, ID ou código: ").strip()
            matches = search_territories(conn, query)

            if not matches:
                print("Non se atoparon territorios. A copla gardarase sen territorio.")
            else:
                print("\nTerritorios atopados:")
                for i, row in enumerate(matches[:20], start=1):
                    print(f"{i}. {row['nome']} [{row['tipo']}] ({row['id']}, cod={row['cod']})")

                choice = input("\nEscolle número (ou Enter para ningún): ").strip()
                if choice:
                    if not choice.isdigit():
                        print("Selección non válida.")
                        return

                    idx = int(choice) - 1
                    if idx < 0 or idx >= min(len(matches), 20):
                        print("Selección fóra de rango.")
                        return

                    territory_id = matches[idx]["id"]

        raw_tags = input("Etiquetas (separadas por comas, opcional): ").strip()
        tags = []
        if raw_tags:
            tags = [t.strip().lower() for t in raw_tags.split(",") if t.strip()]

        print("\nResumo:")
        print(f"- Copla: {text}")
        print(f"- Normalizada: {normalized_text}")
        print(f"- Incipit: {incipit}")
        print(f"- Territorio: {territory_id or 'sen territorio'}")
        print(f"- Etiquetas: {', '.join(tags) if tags else 'sen etiquetas'}")
        print(f"- Notas: {notes or 'sen notas'}")

        confirm = input("\nGardar? [s/N]: ").strip().lower()
        if confirm != "s":
            print("Operación cancelada.")
            return

        cur = conn.execute(
            """
            INSERT INTO coplas (text, normalized_text, incipit, notes)
            VALUES (?, ?, ?, ?)
            """,
            (text, normalized_text, incipit, notes or None),
        )
        copla_id = cur.lastrowid

        if territory_id:
            conn.execute(
                """
                INSERT INTO copla_territories (copla_id, territory_id, relation_type, is_direct)
                VALUES (?, ?, 'direct', 1)
                """,
                (copla_id, territory_id),
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
        print(f"\nCopla gardada con id {copla_id}.")

    finally:
        conn.close()


if __name__ == "__main__":
    main()