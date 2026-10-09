/**
 * FC-009 Sprint 1 — closed reason vocabulary.
 *
 * FC-008 epistemic and operational codes are preserved by reference on the
 * adapted prediction. This list covers only hybrid-composition failures.
 */

export const HYBRID_REASON_CODES = Object.freeze([
  "HYBRID_INPUT_INVALID",
  "HYBRID_IDENTITY_MISMATCH",
  "HYBRID_VERIFIED_CONFLICT",
  "HYBRID_PREDICTION_STALE",
  "HYBRID_CAP_EXCEEDED",
] as const);

export type HybridReasonCode = (typeof HYBRID_REASON_CODES)[number];

export const HYBRID_VALIDATION_CODES = Object.freeze({
  notPlainObject: "HYBRID_NOT_PLAIN_OBJECT",
  symbolKey: "HYBRID_SYMBOL_KEY",
  accessorProperty: "HYBRID_ACCESSOR_PROPERTY",
  unknownKey: "HYBRID_UNKNOWN_KEY",
  missingKey: "HYBRID_MISSING_KEY",
  undefinedValue: "HYBRID_UNDEFINED_VALUE",
  typeMismatch: "HYBRID_TYPE_MISMATCH",
  enumViolation: "HYBRID_ENUM_VIOLATION",
  boundExceeded: "HYBRID_BOUND_EXCEEDED",
  patternViolation: "HYBRID_PATTERN_VIOLATION",
  sparseArray: "HYBRID_SPARSE_ARRAY",
  invariantViolation: "HYBRID_INVARIANT_VIOLATION",
  confidenceInvalid: "HYBRID_CONFIDENCE_INVALID",
} as const);

export type HybridValidationCode =
  (typeof HYBRID_VALIDATION_CODES)[keyof typeof HYBRID_VALIDATION_CODES];

export interface HybridIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly severity: "error";
}

export function hybridIssue(code: string, path: string, message: string): HybridIssue {
  return { code, path, message, severity: "error" };
}
