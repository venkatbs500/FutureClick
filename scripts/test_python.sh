#!/usr/bin/env bash
set -euo pipefail

echo "==> Running Python tests (pytest --locked)..."
uv run --locked pytest
echo "==> Python tests passed."
