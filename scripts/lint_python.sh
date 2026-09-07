#!/usr/bin/env bash
set -euo pipefail

echo "==> Running Python linting (ruff check --locked)..."
uv run --locked ruff check .
echo "==> Python linting passed."
