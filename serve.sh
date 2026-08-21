#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PORT="${1:-8765}"
URL="http://localhost:${PORT}/frontend/index.html"

echo "Coplas Galegas"
echo "Servidor local: ${URL}"
echo
echo "Para parar: Ctrl+C"
echo

python3 -m http.server "${PORT}"
