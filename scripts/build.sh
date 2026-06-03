#!/usr/bin/env bash
# Build a distributable zip of the extension (for GitHub Releases / unpacked load).
# Usage: ./scripts/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version" 2>/dev/null || grep -m1 '"version"' manifest.json | sed -E 's/.*"version": *"([^"]+)".*/\1/')
OUT="claude-korean-translator-v${VERSION}.zip"

rm -f "$OUT"
# Only the files the extension actually ships — exclude tests, assets, docs, dev cruft.
zip -r "$OUT" \
  manifest.json \
  background \
  content \
  options \
  popup \
  lib \
  icons \
  -x '*/.DS_Store' '*.map' >/dev/null

echo "✓ built $OUT ($(du -h "$OUT" | cut -f1))"
echo "  Load: chrome://extensions → 개발자 모드 → '압축해제된 확장 프로그램 로드' → 이 폴더"
echo "  Or attach $OUT to a GitHub Release."
