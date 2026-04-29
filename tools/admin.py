#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.checks import run_checks
from backend.services.db import connect, ensure_parent_dir, migrate
from backend.services.db_paths import DB_PATH, TERRITORIOS_JSON
from backend.services.exporters import export_coplas, export_web
from backend.services.importers import (
    import_coplas,
    import_media,
    import_pieces,
    import_territories,
    load_json,
)


def command_init_db(_args) -> int:
    ensure_parent_dir(DB_PATH)
    applied = migrate(DB_PATH)
    if applied:
        print("Migracións aplicadas:", ", ".join(applied))
    else:
        print("A base xa estaba inicializada.")
    print(f"Base lista en {DB_PATH}")
    return 0


def command_migrate(_args) -> int:
    applied = migrate(DB_PATH)
    if applied:
        print("Migracións aplicadas:", ", ".join(applied))
    else:
        print("Non había migracións pendentes.")
    return 0


def command_import_territories(args) -> int:
    migrate(DB_PATH)
    payload = load_json(Path(args.path).resolve())

    conn = connect(DB_PATH)
    try:
        total = import_territories(conn, payload)
        conn.commit()
    finally:
        conn.close()

    print(f"Importados {total} territorios.")
    return 0


def command_import_coplas(args) -> int:
    migrate(DB_PATH)
    payload = load_json(Path(args.path).resolve())

    conn = connect(DB_PATH)
    try:
        imported_ids = import_coplas(conn, payload)
        conn.commit()
    finally:
        conn.close()

    print(f"Coplas importadas: {len(imported_ids)}")
    if imported_ids:
        print("IDs creados:", ", ".join(str(value) for value in imported_ids))
    return 0


def command_import_pieces(args) -> int:
    migrate(DB_PATH)
    payload = load_json(Path(args.path).resolve())

    conn = connect(DB_PATH)
    try:
        imported_ids = import_pieces(conn, payload)
        conn.commit()
    finally:
        conn.close()

    print(f"Pezas importadas: {len(imported_ids)}")
    if imported_ids:
        print("IDs creados:", ", ".join(str(value) for value in imported_ids))
    return 0


def command_import_media(args) -> int:
    migrate(DB_PATH)
    payload = load_json(Path(args.path).resolve())

    conn = connect(DB_PATH)
    try:
        imported_ids = import_media(conn, payload)
        conn.commit()
    finally:
        conn.close()

    print(f"Media importada: {len(imported_ids)}")
    if imported_ids:
        print("IDs creados:", ", ".join(str(value) for value in imported_ids))
    return 0


def command_export_web(_args) -> int:
    migrate(DB_PATH)
    conn = connect(DB_PATH)
    try:
        counts = export_web(conn)
    finally:
        conn.close()

    print(
        "Export web actualizado: "
        + ", ".join(f"{name}={total}" for name, total in counts.items())
    )
    return 0


def command_export_coplas(_args) -> int:
    migrate(DB_PATH)
    conn = connect(DB_PATH)
    try:
        payload = export_coplas(conn)
    finally:
        conn.close()
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def command_check(_args) -> int:
    migrate(DB_PATH)
    conn = connect(DB_PATH)
    try:
        issues = run_checks(conn)
    finally:
        conn.close()

    if issues:
        print("Problemas detectados:")
        for issue in issues:
            print(f"- {issue}")
        return 1

    print("Comprobación correcta: sen problemas.")
    return 0


def command_pdf_piece(_args) -> int:
    print("A xeración de PDF de pezas aínda non está implementada.")
    return 2


def command_pdf_territory(_args) -> int:
    print("A xeración de PDF territorial aínda non está implementada.")
    return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Administración do arquivo de coplas.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_db = subparsers.add_parser("init-db", help="Inicializar a base de datos.")
    init_db.set_defaults(handler=command_init_db)

    migrate_parser = subparsers.add_parser("migrate", help="Aplicar migracións.")
    migrate_parser.set_defaults(handler=command_migrate)

    import_territories_parser = subparsers.add_parser(
        "import-territories",
        help="Importar territorios desde JSON.",
    )
    import_territories_parser.add_argument("path", nargs="?", default=str(TERRITORIOS_JSON))
    import_territories_parser.set_defaults(handler=command_import_territories)

    import_coplas_parser = subparsers.add_parser(
        "import-coplas",
        help="Importar coplas desde JSON.",
    )
    import_coplas_parser.add_argument("path")
    import_coplas_parser.set_defaults(handler=command_import_coplas)

    import_pieces_parser = subparsers.add_parser(
        "import-pieces",
        help="Importar pezas desde JSON.",
    )
    import_pieces_parser.add_argument("path")
    import_pieces_parser.set_defaults(handler=command_import_pieces)

    import_media_parser = subparsers.add_parser(
        "import-media",
        help="Importar media desde JSON.",
    )
    import_media_parser.add_argument("path")
    import_media_parser.set_defaults(handler=command_import_media)

    export_web_parser = subparsers.add_parser(
        "export-web",
        help="Exportar todos os JSON da web.",
    )
    export_web_parser.set_defaults(handler=command_export_web)

    export_coplas_parser = subparsers.add_parser(
        "dump-coplas",
        help="Amosar as coplas exportadas por stdout.",
    )
    export_coplas_parser.set_defaults(handler=command_export_coplas)

    check_parser = subparsers.add_parser("check", help="Executar validacións.")
    check_parser.set_defaults(handler=command_check)

    pdf_piece_parser = subparsers.add_parser("pdf-piece", help="Xerar PDF dunha peza.")
    pdf_piece_parser.add_argument("piece_id")
    pdf_piece_parser.set_defaults(handler=command_pdf_piece)

    pdf_territory_parser = subparsers.add_parser(
        "pdf-territory",
        help="Xerar PDF das coplas dun territorio.",
    )
    pdf_territory_parser.add_argument("territory_id")
    pdf_territory_parser.set_defaults(handler=command_pdf_territory)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        return args.handler(args)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
