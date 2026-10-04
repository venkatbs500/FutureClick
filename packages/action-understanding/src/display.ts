/**
 * FC-008 Sprint 1 — Layer D: ephemeral display context.
 *
 * Layer D exists ONLY so that a future preview surface can show a human the
 * object it is talking about. It is:
 *
 * - ephemeral memory only
 * - never projected
 * - never fingerprinted
 * - never serialized
 * - never persisted
 * - never recorded in a benchmark record
 *
 * It is therefore defined in its own module and is deliberately NOT a field of
 * `ActionObservation`. `ActionObservation` is the serializable inference
 * contract; if Layer D were a field of it, then `JSON.stringify(observation)`
 * would serialize private object names, and every consumer of the inference
 * contract would be one property access away from a private label.
 *
 * Structural consequences, all asserted by test:
 * - `ActionObservation` has no `display`, `objectLabel`, or `surfaceTitle` key,
 *   so serializing an observation cannot emit Layer D.
 * - `computeObservationInputFingerprint` accepts Layers A and B only, so Layer
 *   D is not nameable at the fingerprint boundary.
 * - `PrimaryFeatureProjector.project` and `ScoringProvider.score` accept Layer
 *   B only, so Layer D is not nameable at either model boundary.
 * - `BenchmarkMetadata` has no label field, so a benchmark record cannot carry
 *   one.
 *
 * `markDisplayContextNonSerializable` makes the prohibition active rather than
 * documentary: a value produced by `createEphemeralDisplayContext` throws if
 * anything attempts to JSON-serialize it.
 */

import { isWithinStringCaps } from "./bounds.js";
import {
  FC008_VALIDATION_CODES,
  type ValidationIssue,
  type ValidationResult,
  inspectClosedObject,
  invalid,
  issue,
  readString,
  safeFormatValue,
  valid,
} from "./validation.js";

export const DISPLAY_RETENTION_POLICY = "ephemeral-memory-only" as const;

/**
 * Human-readable labels for a preview surface. Memory-only.
 *
 * This type is intentionally NOT reachable from `ActionObservation`.
 */
export interface EphemeralDisplayContext {
  readonly objectLabel: string | null;
  readonly surfaceTitle: string | null;
  readonly retentionPolicy: typeof DISPLAY_RETENTION_POLICY;
}

const DISPLAY_KEYS = ["objectLabel", "surfaceTitle", "retentionPolicy"] as const;

/**
 * Installs a non-enumerable `toJSON` that throws.
 *
 * `JSON.stringify` consults `toJSON` before serializing, so this converts
 * "must never be serialized" from a comment into a runtime failure. The
 * property is non-enumerable so it does not alter the object's own-key shape.
 */
function markDisplayContextNonSerializable<T extends object>(value: T): T {
  Object.defineProperty(value, "toJSON", {
    enumerable: false,
    configurable: false,
    writable: false,
    value: () => {
      throw new TypeError("EphemeralDisplayContext is memory-only and must never be serialized.");
    },
  });
  return value;
}

/**
 * Validates and constructs an ephemeral display context.
 *
 * Returns a frozen, non-serializable value. Callers hold it in memory for the
 * lifetime of a preview and discard it; nothing in FC-008 accepts it as input.
 */
export function createEphemeralDisplayContext(
  input: unknown,
  path = "display",
): ValidationResult<EphemeralDisplayContext> {
  const inspection = inspectClosedObject(input, DISPLAY_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const issues: ValidationIssue[] = [];
  const fields = inspection.fields;

  const retentionPolicy = readString(fields, "retentionPolicy", path, issues);
  if (retentionPolicy !== undefined && retentionPolicy !== DISPLAY_RETENTION_POLICY) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        `${path}.retentionPolicy`,
        `retentionPolicy must be "${DISPLAY_RETENTION_POLICY}".`,
      ),
    );
  }

  const labels: Record<string, string | null> = {};
  for (const key of ["objectLabel", "surfaceTitle"] as const) {
    const value = fields.get(key);
    if (value === null) {
      labels[key] = null;
      continue;
    }
    if (typeof value !== "string") {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.typeMismatch,
          `${path}.${key}`,
          `${key} must be a string or null, received ${safeFormatValue(value)}.`,
        ),
      );
      continue;
    }
    if (!isWithinStringCaps(value)) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.boundExceeded,
          `${path}.${key}`,
          `${key} exceeds the frozen string caps.`,
        ),
      );
      continue;
    }
    labels[key] = value;
  }

  if (issues.length > 0) {
    return invalid(issues);
  }

  return valid(
    Object.freeze(
      markDisplayContextNonSerializable({
        objectLabel: labels.objectLabel ?? null,
        surfaceTitle: labels.surfaceTitle ?? null,
        retentionPolicy: DISPLAY_RETENTION_POLICY,
      }),
    ),
  );
}
