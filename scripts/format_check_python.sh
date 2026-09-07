#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking Python formatting (ruff format --check --locked)..."
uv run --locked ruff format --check .
echo "==> Python formatting check passed."
