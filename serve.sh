#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PORT="${1:-8765}"
URL="http://localhost:${PORT}/frontend/index.html"

python3 tools/local_server.py "${PORT}"
