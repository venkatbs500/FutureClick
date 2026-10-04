/**
 * Canonical JSON serialization and SHA-256 hashing.
 *
 * Manifests must reproduce byte-identically from identical inputs, which
 * `JSON.stringify` alone does not guarantee: its output depends on property
 * insertion order, so two structurally identical records can serialize differently
 * and hash differently. This module sorts keys at every depth and refuses the value
 * kinds that have no stable textual form.
 *
 * WHAT IS REFUSED AND WHY
 *
 * `undefined`, functions, and symbols are dropped silently by `JSON.stringify`,
 * which would let a field vanish from a hashed manifest without anyone noticing.
 * `NaN` and the infinities become `null`, collapsing distinct values together.
 * Non-integer-safe numbers lose precision. All of these are refused rather than
 * normalized, because a manifest that hashes successfully while having quietly
 * discarded a field is worse than one that fails loudly.
 *
 * TIMESTAMPS
 *
 * No function here inserts a timestamp. A manifest containing the time it was built
 * could never reproduce, so build time is excluded from canonical content entirely
 * rather than hashed and then explained away.
 */

import { createHash } from "node:crypto";

/** Why a value could not be canonicalized. */
export const CANONICAL_REFUSALS = Object.freeze([
  "undefined-value",
  "function-value",
  "symbol-value",
  "non-finite-number",
  "unsafe-integer-precision",
  "bigint-value",
  "cyclic-reference",
  "unsupported-object-type",
] as const);
export type CanonicalRefusal = (typeof CANONICAL_REFUSALS)[number];

export class CanonicalizationError extends Error {
  readonly refusal: CanonicalRefusal;
  readonly path: string;

  constructor(refusal: CanonicalRefusal, path: string) {
    // The message names the refusal and the path, never the value: a canonical
    // error on a record containing a secret must not quote it.
    super(`canonicalization refused ${refusal} at ${path}`);
    this.name = "CanonicalizationError";
    this.refusal = refusal;
    this.path = path;
  }
}

function canonicalize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "undefined":
      throw new CanonicalizationError("undefined-value", path);
    case "function":
      throw new CanonicalizationError("function-value", path);
    case "symbol":
      throw new CanonicalizationError("symbol-value", path);
    case "bigint":
      throw new CanonicalizationError("bigint-value", path);
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError("non-finite-number", path);
      }
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new CanonicalizationError("unsafe-integer-precision", path);
      }
      // `JSON.stringify` of a finite number is already the shortest round-trip
      // representation, which is what makes it reproducible across engines.
      return JSON.stringify(value);
    }
    default:
      break;
  }

  const object = value as object;
  if (seen.has(object)) {
    throw new CanonicalizationError("cyclic-reference", path);
  }
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      const parts = object.map((item, index) => canonicalize(item, `${path}[${index}]`, seen));
      return `[${parts.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      // Maps, Sets, Dates, class instances and regexes all have textual forms that
      // are either lossy or engine-dependent. Callers convert them explicitly.
      throw new CanonicalizationError("unsupported-object-type", path);
    }
    const keys = Object.keys(object as Record<string, unknown>).sort();
    const parts = keys.map((key) => {
      const child = (object as Record<string, unknown>)[key];
      return `${JSON.stringify(key)}:${canonicalize(child, `${path}.${key}`, seen)}`;
    });
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(object);
  }
}

/**
 * Canonical JSON: keys sorted at every depth, no insignificant whitespace.
 *
 * Deterministic for any value it accepts, and it throws rather than guessing for
 * any value it does not.
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, "$", new Set<object>());
}

/** UTF-8 byte length of a canonical serialization. */
export function canonicalByteLength(value: unknown): number {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

/** Lowercase hex SHA-256 of a canonical serialization. */
export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** Lowercase hex SHA-256 of a string, for hashing already-canonical content. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Hash of an ordered list of hashes.
 *
 * Used to roll record hashes into one dataset hash. The separator prevents the
 * concatenation ambiguity where ["ab","c"] and ["a","bc"] would otherwise produce
 * the same digest.
 */
export function hashChain(hashes: readonly string[]): string {
  return sha256Hex(hashes.join("\n"));
}
