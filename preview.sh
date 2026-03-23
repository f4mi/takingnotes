#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed or not on PATH." >&2
  exit 1
fi

exec node scripts/run.mjs preview "$@"
