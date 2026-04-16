#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$ROOT_DIR/src"
OUT_DIR="$ROOT_DIR/dist/firefox"
ARTIFACTS_DIR="$ROOT_DIR/web-ext-artifacts"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
mkdir -p "$ARTIFACTS_DIR"

cp "$SRC_DIR/manifest.firefox.json" "$OUT_DIR/manifest.json"
cp \
  "$SRC_DIR/content_script.js" \
  "$SRC_DIR/service_worker.js" \
  "$SRC_DIR/overlay.html" \
  "$SRC_DIR/overlay.js" \
  "$SRC_DIR/overlay.css" \
  "$SRC_DIR/options.html" \
  "$SRC_DIR/options.js" \
  "$SRC_DIR/options.css" \
  "$SRC_DIR/sidepanel.html" \
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
