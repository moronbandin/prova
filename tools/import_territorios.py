#!/usr/bin/env python3
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
db_path = ROOT / "data" / "db" / "coplas.sqlite"
json_path = ROOT / "data" / "canonical" / "territorios.json"

with json_path.open(encoding="utf-8") as f:
    data = json.load(f)

conn = sqlite3.connect(db_path)
try:
    conn.execute("DELETE FROM territories")
    for item in data:
        tipo = item["tipo"]
        prov_cod = item.get("prov")
        com_cod = item.get("com")
        con_cod = item.get("con")
        parent_id = None
        if tipo == "com" and prov_cod:
            parent_id = f"prov:{prov_cod}"
        elif tipo == "con" and com_cod:
            parent_id = f"com:{com_cod}"
        elif tipo == "par" and con_cod:
            parent_id = f"con:{con_cod}"

        conn.execute(
            '''
            INSERT INTO territories
            (id, tipo, cod, nome, slug, search, prov_cod, com_cod, con_cod, parent_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                item["id"], item["tipo"], item["cod"], item["nome"], item["slug"],
                item["search"], prov_cod, com_cod, con_cod, parent_id
            )
        )
    conn.commit()
    print(f"Importados {len(data)} territorios en {db_path}")
finally:
    conn.close()
