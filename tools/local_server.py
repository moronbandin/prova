#!/usr/bin/env python3
import json
import sys
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.db import connect, migrate
from backend.services.db_paths import DB_PATH
from backend.services.exporters import export_web
from backend.services.importers import import_coplas, import_media


class PreviewParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.meta: dict[str, str] = {}
        self._in_title = False

    def handle_starttag(self, tag: str, attrs) -> None:
        data = dict(attrs)
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            key = data.get("property") or data.get("name")
            value = data.get("content")
            if key and value:
                self.meta[key] = value

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title and not self.title:
            self.title = data.strip()


class LocalHandler(SimpleHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path not in {"/api/coplas", "/api/media"}:
            self._send_json(404, {"error": "Endpoint non atopado."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            migrate(DB_PATH)
            conn = connect(DB_PATH)
            try:
                if self.path == "/api/coplas":
                    ids = import_coplas(conn, payload)
                else:
                    ids = import_media(conn, payload)
                conn.commit()
                counts = export_web(conn)
            finally:
                conn.close()
            self._send_json(200, {"ok": True, "ids": ids, "counts": counts})
        except Exception as exc:
            self._send_json(400, {"ok": False, "error": str(exc)})

    def do_GET(self) -> None:
        if not self.path.startswith("/api/link-preview?"):
            return super().do_GET()

        try:
            from urllib.parse import parse_qs, urlparse

            query = parse_qs(urlparse(self.path).query)
            url = query.get("url", [""])[0]
            if not url.startswith(("http://", "https://")):
                self._send_json(400, {"ok": False, "error": "URL non válida."})
                return
            req = Request(url, headers={"User-Agent": "Fol-e-ar-local-preview/1.0"})
            with urlopen(req, timeout=6) as response:
                html = response.read(512_000).decode("utf-8", errors="ignore")
            parser = PreviewParser()
            parser.feed(html)
            self._send_json(200, {
                "ok": True,
                "title": parser.meta.get("og:title") or parser.meta.get("twitter:title") or parser.title,
                "description": parser.meta.get("og:description") or parser.meta.get("description") or parser.meta.get("twitter:description"),
                "thumbnail_url": parser.meta.get("og:image") or parser.meta.get("twitter:image"),
                "provider": parser.meta.get("og:site_name"),
            })
        except Exception as exc:
            self._send_json(400, {"ok": False, "error": str(exc)})


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(("", port), LocalHandler)
    print("Fol e ar")
    print(f"Servidor local: http://localhost:{port}/frontend/index.html")
    print("API local: POST /api/coplas")
    print("API local: POST /api/media")
    print()
    print("Para parar: Ctrl+C")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
