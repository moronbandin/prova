#!/usr/bin/env python3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.admin import main


def cli():
    if len(sys.argv) != 2:
        print("Uso:")
        print("  python3 tools/import_coplas_json.py ruta/ao/ficheiro.json")
        sys.exit(1)

    json_path = Path(sys.argv[1]).resolve()
    raise SystemExit(main(["import-coplas", str(json_path)]))


if __name__ == "__main__":
    cli()
