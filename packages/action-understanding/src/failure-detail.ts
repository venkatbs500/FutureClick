/**
 * FC-008 Sprint 1 — bounded categorical operational failure detail.
 *
 * An operational failure must say enough for an engineer to find the defect and
 * nothing more. The earlier shape, `Readonly<Record<string, string>>`, allowed
 * arbitrary strings, which is a leak channel in both directions: page-derived
 * or provider-derived text could be copied into a failure record, and a raw
 * model output or private label could reach a log through an error path that
 * nobody audits as a data path.
 *
 * So the detail is CLOSED and CATEGORICAL:
 *
 * - `stage` is one of a frozen vocabulary of pipeline stages.
 * - `reason` is one of a frozen vocabulary of machine reasons.
 * - `measurement` is a single bounded finite non-negative number or null.
 *
 * There is no free-text field. A value that is not in the vocabulary cannot be
 * recorded, so no attacker-controlled or model-controlled string can ride out
 * through a failure.
 */

/** Pipeline stage at which an operational failure was detected. */
export const FAILURE_STAGES = Object.freeze([
  "observation-validation",
  "version-check",
  "artifact-load",
  "calibration-identity",
  "support-assessment",
  "provider",
  "provider-outcome-validation",
  "calibration",
  "calibration-validation",
  "composition",
  "ranking",
  "accept",
  "hypothesis-construction",
  "runtime",
] as const);
export type FailureStage = (typeof FAILURE_STAGES)[number];

/** Machine reason for an operational failure. Closed vocabulary. */
export const FAILURE_REASONS = Object.freeze([
  "schema-invalid",
  "unsupported-schema-version",
  "version-mismatch",
  "no-validated-artifact",
  "artifact-identity-divergence",
  "calibration-identity-divergence",
  "provider-unavailable",
  "provider-timeout",
  "provider-error",
  "provider-threw",
  "provider-outcome-invalid",
  "provider-family-divergence",
  "deadline-exceeded",
  "clock-invalid",
  "calibrator-threw",
  "calibration-failed",
  "invalid-distribution",
  "composition-not-implemented",
  "insufficient-classes",
  "missing-top-class",
  "class-index-out-of-range",
  "hypothesis-construction-invalid",
  "unhandled-exception",
] as const);
export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * Upper bound on `measurement`.
 *
 * Generous enough for an elapsed-millisecond reading or an issue count, small
 * enough that no payload can be smuggled through a number.
 */
export const MAX_FAILURE_MEASUREMENT = 1_000_000;

export interface FailureDetail {
  readonly stage: FailureStage;
  readonly reason: FailureReason;
  /** A count or an elapsed millisecond reading. Null when not applicable. */
  readonly measurement: number | null;
}

const STAGE_SET = new Set<string>(FAILURE_STAGES);
const REASON_SET = new Set<string>(FAILURE_REASONS);

export function isFailureStage(value: unknown): value is FailureStage {
  return typeof value === "string" && STAGE_SET.has(value);
}

export function isFailureReason(value: unknown): value is FailureReason {
  return typeof value === "string" && REASON_SET.has(value);
}

/**
 * Builds a frozen failure detail.
 *
 * Fails closed on an out-of-vocabulary stage or reason and on a measurement
 * that is not a finite non-negative number within the cap, substituting a
 * conservative `runtime`/`unhandled-exception`/null record rather than
 * recording an unvalidated value.
 */
export function createFailureDetail(
  stage: FailureStage,
  reason: FailureReason,
  measurement: number | null = null,
): FailureDetail {
  if (!isFailureStage(stage) || !isFailureReason(reason)) {
    return Object.freeze({
      stage: "runtime" as const,
      reason: "unhandled-exception" as const,
      measurement: null,
    });
  }

  let bounded: number | null = null;
  if (measurement !== null) {
    if (
      typeof measurement === "number" &&
      Number.isFinite(measurement) &&
      measurement >= 0 &&
      measurement <= MAX_FAILURE_MEASUREMENT
    ) {
      bounded = measurement;
    }
  }

  return Object.freeze({ stage, reason, measurement: bounded });
}
