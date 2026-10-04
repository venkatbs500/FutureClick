/**
 * FC-007 Sprint 3A — collision-safe typed structural fingerprint encoding.
 *
 * Schema-specific only. No arbitrary JSON.stringify of objects.
 * Primitive types are preserved in the encoding (number 1 ≠ string "1").
 */

export const FP_MAX_STRING_UNITS = 2_048;

export type TypedFpError = { readonly error: string };

export function encodeString(value: string): string | TypedFpError {
  if (typeof value !== "string") return { error: "FP_STRING_TYPE" };
  if (value.length > FP_MAX_STRING_UNITS) return { error: "FP_STRING_OVERFLOW" };
  return `S${value.length}:${value}`;
}

export function encodeNumber(value: number): string | TypedFpError {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: "FP_NUMBER_TYPE" };
  }
  // Canonical finite decimal via JSON (preserves type tag separately).
  return `N:${JSON.stringify(value)}`;
}

export function encodeBool(value: boolean): string | TypedFpError {
  if (typeof value !== "boolean") return { error: "FP_BOOL_TYPE" };
  return value ? "B1" : "B0";
}

export function encodeNull(): string {
  return "Z";
}

/** Explicit absence of an optional field (distinct from empty string / null). */
export function encodeAbsent(): string {
  return "A";
}

/**
 * Length-prefixed sequence of already-encoded atoms.
 * Concatenation is unambiguous because each atom is self-delimiting.
 */
export function encodeSeq(parts: readonly string[]): string | TypedFpError {
  if (!Array.isArray(parts)) return { error: "FP_SEQ_TYPE" };
  if (parts.length > 256) return { error: "FP_SEQ_OVERFLOW" };
  for (const p of parts) {
    if (typeof p !== "string") return { error: "FP_SEQ_ITEM_TYPE" };
  }
  return `L${parts.length}:${parts.join("")}`;
}

export function encodeOptionalString(value: string | undefined): string | TypedFpError {
  if (value === undefined) return encodeAbsent();
  return encodeString(value);
}

export function encodeOptionalNumber(value: number | undefined): string | TypedFpError {
  if (value === undefined) return encodeAbsent();
  return encodeNumber(value);
}

/**
 * Encode a supported known JsonValue primitive for state values.
 * Objects/arrays rejected (unsupported for FC-007 visibility state values).
 */
export function encodePrimitiveValue(value: unknown): string | TypedFpError {
  if (value === null) return encodeNull();
  if (typeof value === "string") return encodeString(value);
  if (typeof value === "number") return encodeNumber(value);
  if (typeof value === "boolean") return encodeBool(value);
  return { error: "FP_VALUE_UNSUPPORTED" };
}
