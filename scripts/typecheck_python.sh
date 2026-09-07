#!/usr/bin/env bash
set -euo pipefail

echo "==> Type checking Python code (mypy --locked)..."
uv run --locked mypy services/prediction-engine/src research/futurebench/src
echo "==> Python type checking passed."
