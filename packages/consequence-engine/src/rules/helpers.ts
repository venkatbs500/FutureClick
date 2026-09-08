/**
 * Deterministic Rule Evaluation Helpers (Sprint FC-004A)
 *
 * Epistemological Boundary:
 * Deterministic rules must never resolve ambiguity by taking the first match,
 * guessing missing parameters, or silently reconciling multiple facts.
 * Ambiguous facts, multiple same-role targets, and malformed semantic states
 * must deterministically fail closed / abstain as INSUFFICIENT_EVIDENCE.
 */

import {
  type ActionEvaluationContext,
  type ActionTarget,
  type ActionTargetRole,
  type EntityId,
  type ProposedAction,
  type StateFact,
  normalizeThrownError,
  validateId,
} from "@futureclick/action-schema";

// ============================================================================
// 1. UNIQUE FACT RESOLUTION (Finding H1)
// ============================================================================

export interface ResolveUniqueFactOptions {
  readonly context: ActionEvaluationContext;
  readonly subjectEntityId: EntityId;
  readonly property: string | readonly string[];
}

export type FactResolutionResult =
  | { readonly status: "found"; readonly fact: StateFact }
  | { readonly status: "missing" }
  | { readonly status: "ambiguous"; readonly count: number };

/**
 * Resolves a unique fact for a given entity and property key.
 *
 * Strict policy:
 * - 0 matches => "missing"
 * - 1 match => "found"
 * - 2+ matches => "ambiguous" (even if values are identical)
 *
 * Inspects all facts regardless of source array ordering.
 */
export function resolveUniqueFact(options: ResolveUniqueFactOptions): FactResolutionResult {
  const { context, subjectEntityId, property } = options;
  const facts = context.state.facts;

  const matches: StateFact[] = [];
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    if (!f) continue;
    if (f.subjectEntityId !== subjectEntityId) continue;

    const keyMatches = Array.isArray(property) ? property.includes(f.key) : f.key === property;

    if (keyMatches) {
      matches.push(f);
    }
  }

  if (matches.length === 0) {
    return { status: "missing" };
  }
  const firstFact = matches[0];
  if (matches.length === 1 && firstFact !== undefined) {
    return { status: "found", fact: firstFact };
  }
  return { status: "ambiguous", count: matches.length };
}

// ============================================================================
// 2. TARGET CARDINALITY RESOLUTION (Finding H2)
// ============================================================================

export type TargetResolutionResult =
  | { readonly status: "found"; readonly target: ActionTarget }
  | { readonly status: "missing" }
  | { readonly status: "ambiguous"; readonly count: number };

/**
 * Resolves a unique action target for a given target role.
 *
 * Strict policy:
 * - 0 matches => "missing"
 * - 1 match => "found"
 * - 2+ matches => "ambiguous" (multiple targets with the same role)
 *
 * Prevents first-match order-dependent consequence generation.
 */
export function resolveUniqueTargetByRole(
  action: ProposedAction,
  role: ActionTargetRole,
): TargetResolutionResult {
  const targets = action.targets;
  const matches: ActionTarget[] = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t && t.role === role) {
      matches.push(t);
    }
  }

  if (matches.length === 0) {
    return { status: "missing" };
  }
  const firstTarget = matches[0];
  if (matches.length === 1 && firstTarget !== undefined) {
    return { status: "found", target: firstTarget };
  }
  return { status: "ambiguous", count: matches.length };
}

// ============================================================================
// 3. EXPLICIT BOOLEAN PARAMETER READER (Finding H4)
// ============================================================================

export type BooleanParameterResult =
  | { readonly status: "present"; readonly value: boolean }
  | { readonly status: "absent" }
  | { readonly status: "invalid_type"; readonly actual: unknown };

/**
 * Reads an action parameter strictly as a boolean without type coercion.
 * Truthiness or loose equality is forbidden.
 */
export function readExplicitBooleanParameter(
  parameters: Record<string, unknown>,
  key: string,
): BooleanParameterResult {
  if (!Object.prototype.hasOwnProperty.call(parameters, key)) {
    return { status: "absent" };
  }

  const val = parameters[key];
  if (val === undefined) {
    return { status: "absent" };
  }
  if (typeof val === "boolean") {
    return { status: "present", value: val };
  }
  return { status: "invalid_type", actual: val };
}

// ============================================================================
// 4. SHARED_WITH ARRAY VALIDATOR (Finding H5)
// ============================================================================

export type SharedWithValidationResult =
  | { readonly valid: true; readonly recipients: readonly EntityId[] }
  | { readonly valid: false; readonly reason: string };

/**
 * Semantically validates a document.shared_with fact value.
 * Must be a dense array of unique, canonically valid EntityIds.
 *
 * Normalization & Duplicate Detection Policy (Finding H5 / FC-004B):
 * - Each entry is validated and normalized through authoritative validateId<EntityId>.
 * - Duplicate detection occurs AFTER canonical normalization.
 * - Normalized EntityIds are returned, eliminating raw whitespace or alias leakage.
 * - An empty array [] is canonically valid (representing no currently shared recipients).
 */
export function validateSharedWithArray(value: unknown): SharedWithValidationResult {
  if (!Array.isArray(value)) {
    return { valid: false, reason: "NOT_AN_ARRAY" };
  }

  const seen = new Set<string>();
  const recipients: EntityId[] = [];

  for (let i = 0; i < value.length; i++) {
    // Check dense array (no holes)
    if (!(i in value)) {
      return { valid: false, reason: "SPARSE_ARRAY" };
    }

    const item = value[i];
    // Authoritative canonical EntityId validation/normalization
    const idRes = validateId<EntityId>(item, "EntityId", `shared_with[${i}]`);
    if (!idRes.valid) {
      return { valid: false, reason: "MALFORMED_SHARED_WITH" };
    }

    const normalizedId = idRes.value;

    // Duplicate detection happens AFTER canonical normalization
    if (seen.has(normalizedId)) {
      return { valid: false, reason: "MALFORMED_SHARED_WITH" };
    }

    seen.add(normalizedId);
    recipients.push(normalizedId);
  }

  return { valid: true, recipients: Object.freeze(recipients) };
}

// ============================================================================
// 5. BILLING INTERVAL VALIDATION (Finding H3)
// ============================================================================

export const SUPPORTED_BILLING_INTERVALS = ["monthly", "annual"] as const;
export type SupportedBillingInterval = (typeof SUPPORTED_BILLING_INTERVALS)[number];

export function isSupportedBillingInterval(value: unknown): value is SupportedBillingInterval {
  return (
    typeof value === "string" && (SUPPORTED_BILLING_INTERVALS as readonly string[]).includes(value)
  );
}

// ============================================================================
// 6. DENSE ARRAY SNAPSHOT HELPER (Finding M2 / FC-004B)
// ============================================================================

export type DenseArrayCaptureResult<T> =
  | { readonly ok: true; readonly value: readonly T[] }
  | { readonly ok: false; readonly error: Error };

/**
 * Captures a dense snapshot of an array-like structure exactly once.
 *
 * Guarantees (FC-004B M2):
 * - Captures length exactly once.
 * - Reads each index [0..length-1] exactly once.
 * - Rejects sparse arrays (missing keys/holes).
 * - Catches hostile getters with normalizeThrownError.
 * - Produces a detached, frozen ordinary array snapshot.
 */
export function captureDenseArrayOnce<T = unknown>(
  input: unknown,
  contextName = "array",
): DenseArrayCaptureResult<T> {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      error: new Error(`[INVALID_ARRAY] Expected ${contextName} to be an array.`),
    };
  }

  let rawLength: unknown;
  try {
    rawLength = (input as { readonly length: unknown }).length;
  } catch (thrown) {
    return {
      ok: false,
      error: normalizeThrownError(thrown, `Failed reading length of ${contextName}.`),
    };
  }

  if (typeof rawLength !== "number" || !Number.isSafeInteger(rawLength) || rawLength < 0) {
    return {
      ok: false,
      error: new Error(
        `[INVALID_ARRAY] ${contextName}.length must be a non-negative safe integer.`,
      ),
    };
  }

  const length = rawLength;
  const snapshot: T[] = new Array(length);

  for (let i = 0; i < length; i++) {
    let hasIndex = false;
    try {
      hasIndex = Object.prototype.hasOwnProperty.call(input, i) || i in (input as object);
    } catch (thrown) {
      return {
        ok: false,
        error: normalizeThrownError(thrown, `Failed checking index ${i} in ${contextName}.`),
      };
    }

    if (!hasIndex) {
      return {
        ok: false,
        error: new Error(
          `[SPARSE_ARRAY] ${contextName} contains missing index at [${i}]. Sparse arrays are rejected.`,
        ),
      };
    }

    let element: unknown;
    try {
      element = (input as Record<number, unknown>)[i];
    } catch (thrown) {
      return {
        ok: false,
        error: normalizeThrownError(
          thrown,
          `Failed reading element at index [${i}] in ${contextName}.`,
        ),
      };
    }

    snapshot[i] = element as T;
  }

  return {
    ok: true,
    value: Object.freeze(snapshot),
  };
}
