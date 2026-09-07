#!/usr/bin/env bash
set -euo pipefail

echo "==> Formatting Python files (ruff format --locked)..."
uv run --locked ruff format .
echo "==> Python formatting complete."
