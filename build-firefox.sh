#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$ROOT_DIR/dist/firefox"
ARTIFACTS_DIR="$ROOT_DIR/web-ext-artifacts"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
mkdir -p "$ARTIFACTS_DIR"

cp "$ROOT_DIR/manifest.firefox.json" "$OUT_DIR/manifest.json"
cp \
  "$ROOT_DIR/content_script.js" \
  "$ROOT_DIR/service_worker.js" \
  "$ROOT_DIR/overlay.html" \
  "$ROOT_DIR/overlay.js" \
  "$ROOT_DIR/overlay.css" \
  "$ROOT_DIR/options.html" \
  "$ROOT_DIR/options.js" \
  "$ROOT_DIR/options.css" \
  "$ROOT_DIR/sidepanel.html" \
  "$OUT_DIR/"

echo "Built Firefox extension in: $OUT_DIR"

if command -v web-ext >/dev/null 2>&1; then
  web-ext build \
    --source-dir "$OUT_DIR" \
    --artifacts-dir "$ARTIFACTS_DIR" \
    --overwrite-dest
  echo "Built Firefox package in: $ARTIFACTS_DIR"
else
  echo "web-ext not found; skipped packaging step" >&2
fi
