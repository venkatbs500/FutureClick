#!/usr/bin/env bash
set -euo pipefail

echo "==> Verifying Python package distribution builds..."

BUILD_TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'futureclick-pybuild')
cleanup() {
  rm -rf "${BUILD_TMP_DIR}"
}
trap cleanup EXIT INT TERM

echo "--> Building prediction-engine package into ${BUILD_TMP_DIR}..."
uv build --package prediction-engine --out-dir "${BUILD_TMP_DIR}"

echo "--> Building futurebench package into ${BUILD_TMP_DIR}..."
uv build --package futurebench --out-dir "${BUILD_TMP_DIR}"

# Verify expected wheel and sdist artifacts exist
if [[ ! -f "${BUILD_TMP_DIR}/prediction_engine-0.1.0-py3-none-any.whl" ]]; then
  echo "Error: prediction_engine wheel not generated" >&2
  exit 1
fi
if [[ ! -f "${BUILD_TMP_DIR}/prediction_engine-0.1.0.tar.gz" ]]; then
  echo "Error: prediction_engine sdist not generated" >&2
  exit 1
fi
if [[ ! -f "${BUILD_TMP_DIR}/futurebench-0.1.0-py3-none-any.whl" ]]; then
  echo "Error: futurebench wheel not generated" >&2
  exit 1
fi
if [[ ! -f "${BUILD_TMP_DIR}/futurebench-0.1.0.tar.gz" ]]; then
  echo "Error: futurebench sdist not generated" >&2
  exit 1
fi

echo "==> Python package distribution builds verified successfully (artifacts cleaned)."
