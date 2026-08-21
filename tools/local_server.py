#!/usr/bin/env python3
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.db import connect, migrate
from backend.services.db_paths import DB_PATH
from backend.services.exporters import export_web
from backend.services.importers import import_coplas


class LocalHandler(SimpleHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/api/coplas":
            self._send_json(404, {"error": "Endpoint non atopado."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            migrate(DB_PATH)
            conn = connect(DB_PATH)
            try:
                ids = import_coplas(conn, payload)
                conn.commit()
                counts = export_web(conn)
            finally:
                conn.close()
            self._send_json(200, {"ok": True, "ids": ids, "counts": counts})
        except Exception as exc:
            self._send_json(400, {"ok": False, "error": str(exc)})


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(("", port), LocalHandler)
    print(f"Coplas Galegas")
    print(f"Servidor local: http://localhost:{port}/frontend/index.html")
    print("API local: POST /api/coplas")
    print()
    print("Para parar: Ctrl+C")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
