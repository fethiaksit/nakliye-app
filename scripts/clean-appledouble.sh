#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

find "$PROJECT_ROOT" \
  -path "$PROJECT_ROOT/.git" -prune -o \
  -name '._*' \
  -type f \
  -exec /bin/rm -f {} +

echo "AppleDouble files cleaned."
