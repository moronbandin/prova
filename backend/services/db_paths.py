from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "data" / "db" / "coplas.sqlite"
TERRITORIOS_JSON = ROOT / "data" / "canonical" / "territorios.json"
