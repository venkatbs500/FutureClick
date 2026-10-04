/**
 * FC-008 Sprint 1 — freshness ownership boundary.
 *
 * The generic understanding runtime is platform-neutral. It does not import the
 * DOM, MutationObserver, or any browser lifecycle API; the package `lib` is
 * ES2022 only, so those types are not even nameable here.
 *
 * The CALLER owns current observation state. A `FreshnessBinding` is an
 * immutable snapshot of the identity of the observation that produced a result.
 * The runtime re-checks that binding through an injected `FreshnessValidator`
 * twice: once before inference, and once after inference and before the result
 * is recorded, published, or benchmarked as current.
 *
 * This generalises the FC-007 lesson that a decision computed against a surface
 * that has since been replaced must never be published as current.
 */

import type { IsoTimestamp } from "@futureclick/shared";
import {
  FC008_VALIDATION_CODES,
  type ValidationIssue,
  type ValidationResult,
  inspectClosedObject,
  invalid,
  issue,
  readBoundedInteger,
  readString,
  valid,
} from "./validation.js";

/** Maximum epoch / sequence value accepted. Guards against absurd integers. */
export const MAX_FRESHNESS_COUNTER = Number.MAX_SAFE_INTEGER;

/**
 * Immutable identity of the observation and policy generation that produced a
 * result. Every field participates in the staleness decision.
 */
export interface FreshnessBinding {
  /** Caller-owned generation counter. Incremented when the surface is replaced. */
  readonly epoch: number;
  /** Caller-owned monotonically increasing observation counter within an epoch. */
  readonly observationSequence: number;
  /** ISO timestamp of capture. Context only; never a model feature. */
  readonly capturedAt: IsoTimestamp;
  readonly featurePolicyVersion: string;
  readonly supportMatrixVersion: string;
  readonly abstentionPolicyVersion: string;
}

const FRESHNESS_REQUIRED_KEYS = [
  "epoch",
  "observationSequence",
  "capturedAt",
  "featurePolicyVersion",
  "supportMatrixVersion",
  "abstentionPolicyVersion",
] as const;

const ISO_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateFreshnessBinding(
  input: unknown,
  path = "freshness",
): ValidationResult<FreshnessBinding> {
  const inspection = inspectClosedObject(input, FRESHNESS_REQUIRED_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const issues: ValidationIssue[] = [];
  const fields = inspection.fields;

  const epoch = readBoundedInteger(fields, "epoch", MAX_FRESHNESS_COUNTER, path, issues);
  const observationSequence = readBoundedInteger(
    fields,
    "observationSequence",
    MAX_FRESHNESS_COUNTER,
    path,
    issues,
  );
  const capturedAt = readString(fields, "capturedAt", path, issues);
  const featurePolicyVersion = readString(fields, "featurePolicyVersion", path, issues);
  const supportMatrixVersion = readString(fields, "supportMatrixVersion", path, issues);
  const abstentionPolicyVersion = readString(fields, "abstentionPolicyVersion", path, issues);

  if (capturedAt !== undefined) {
    if (!ISO_TIMESTAMP_REGEX.test(capturedAt) || Number.isNaN(Date.parse(capturedAt))) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.patternViolation,
          `${path}.capturedAt`,
          "capturedAt must be an ISO-8601 timestamp with an explicit offset or Z.",
        ),
      );
    }
  }

  for (const [key, value] of [
    ["featurePolicyVersion", featurePolicyVersion],
    ["supportMatrixVersion", supportMatrixVersion],
    ["abstentionPolicyVersion", abstentionPolicyVersion],
  ] as const) {
    if (value !== undefined && (value.length === 0 || value.length > 64)) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.boundExceeded,
          `${path}.${key}`,
          `${key} must be a non-empty string of at most 64 characters.`,
        ),
      );
    }
  }

  if (
    issues.length > 0 ||
    epoch === undefined ||
    observationSequence === undefined ||
    capturedAt === undefined ||
    featurePolicyVersion === undefined ||
    supportMatrixVersion === undefined ||
    abstentionPolicyVersion === undefined
  ) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({
      epoch,
      observationSequence,
      capturedAt: capturedAt as IsoTimestamp,
      featurePolicyVersion,
      supportMatrixVersion,
      abstentionPolicyVersion,
    }),
  );
}

/** True when two bindings describe the same observation generation. */
export function freshnessBindingsEqual(a: FreshnessBinding, b: FreshnessBinding): boolean {
  return (
    a.epoch === b.epoch &&
    a.observationSequence === b.observationSequence &&
    a.capturedAt === b.capturedAt &&
    a.featurePolicyVersion === b.featurePolicyVersion &&
    a.supportMatrixVersion === b.supportMatrixVersion &&
    a.abstentionPolicyVersion === b.abstentionPolicyVersion
  );
}

/**
 * Injected by the caller that owns current state. The runtime holds no opinion
 * about how currency is determined.
 *
 * Implementations must be synchronous and side-effect free so that the
 * post-inference check cannot itself introduce a race.
 */
export interface FreshnessValidator {
  /**
   * @param binding Immutable freshness identity carried by the observation.
   * @param inputFingerprint Fingerprint of the sanitized observation input.
   * @returns true when the binding still describes current state.
   */
  isCurrent(binding: FreshnessBinding, inputFingerprint: string): boolean;
}

/** The two points at which freshness is evaluated. */
export const FRESHNESS_CHECKPOINTS = Object.freeze(["pre-inference", "post-inference"] as const);
export type FreshnessCheckpoint = (typeof FRESHNESS_CHECKPOINTS)[number];
