#!/usr/bin/env bash
set -euo pipefail

echo "========================================================"
echo "          FutureClick Quality Gate (FC-001)             "
echo "========================================================"

echo ""
echo "[Step 1/5] Checking code formatting across repository..."
pnpm run format:check

echo ""
echo "[Step 2/5] Running linters (TypeScript + Python)..."
pnpm run lint

echo ""
echo "[Step 3/5] Static type checking (tsc + mypy)..."
pnpm run typecheck

echo ""
echo "[Step 4/5] Running test suites (vitest + pytest)..."
pnpm run test

echo ""
echo "[Step 5/5] Building all packages..."
pnpm run build

echo ""
echo "========================================================"
echo "  [SUCCESS] All FutureClick FC-001 quality gates passed!"
echo "========================================================"
