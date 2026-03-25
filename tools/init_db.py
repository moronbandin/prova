#!/usr/bin/env python3
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
db_path = ROOT / "data" / "db" / "coplas.sqlite"
schema_path = ROOT / "backend" / "schema" / "001_init.sql"

db_path.parent.mkdir(parents=True, exist_ok=True)

conn = sqlite3.connect(db_path)
try:
    sql = schema_path.read_text(encoding="utf-8")
    conn.executescript(sql)
    conn.commit()
    print(f"Base creada: {db_path}")
finally:
    conn.close()
