"""Canonical JSON serialization and hashing for research artifacts.

The rules match the TypeScript side of the project: keys sorted, no insignificant
whitespace, ASCII-escaped, and no NaN or Infinity. Two implementations in two
languages agreeing by construction is the point — Sprint 4 has to hash the same bytes.

FLOATS ARE NOT ROUNDED. ``json.dumps`` writes a Python float with ``repr``, which is
the shortest decimal string that round-trips to the identical float64. Rounding to a
display precision would be the obvious way to make artifacts look tidy and would also
silently cap achievable parity at the rounding width, so the artifact keeps full
precision and the human-readable report rounds separately.

``allow_nan=False`` is load-bearing rather than defensive. NaN in a weight matrix
means the fit diverged, and the moment to find that out is while writing the artifact,
not when a consumer parses it and gets a JSON syntax error from a non-standard token.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(value: Any) -> str:
    """Serialize to canonical JSON text."""
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    )


def canonical_bytes(value: Any) -> bytes:
    """Serialize to canonical UTF-8 bytes. These are the bytes that get hashed."""
    return canonical_json(value).encode("utf-8")


def sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_sha256(value: Any) -> str:
    return sha256_hex(canonical_bytes(value))


def to_float(value: Any) -> float:
    """Convert a NumPy scalar to a plain float, rejecting non-finite values.

    Called on every number entering an artifact. ``json`` cannot serialize
    ``numpy.float64`` and would raise on it, so this is also the conversion point.
    """
    result = float(value)
    if result != result or result in (float("inf"), float("-inf")):
        raise ValueError(f"non-finite value cannot enter a canonical artifact: {value!r}")
    return result


def to_float_matrix(matrix: Any) -> list[list[float]]:
    """Convert a 2-D array to nested lists of plain floats."""
    return [[to_float(cell) for cell in row] for row in matrix]


def to_float_vector(vector: Any) -> list[float]:
    """Convert a 1-D array to a list of plain floats."""
    return [to_float(cell) for cell in vector]
