#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

find "$PROJECT_ROOT" \
  -name '._*' \
  -type f \
  -delete

dot_clean -m "$PROJECT_ROOT" || true

echo "AppleDouble files cleaned."
