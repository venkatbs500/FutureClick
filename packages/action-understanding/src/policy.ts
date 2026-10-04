/**
 * FC-008 Sprint 1 — versioned runtime abstention policy.
 *
 * ONE validated, deeply frozen policy object owns EVERY threshold. Providers own
 * none: the provider scoring context deliberately carries no threshold field, so
 * a provider cannot read, influence, or self-apply an acceptance criterion.
 * Untrusted page content cannot reach this object at all.
 *
 * Sprint 1 deliberately ships NO default policy. Every threshold is selected on
 * the POLICY-VALIDATION partition during Sprint 3 and is frozen into the
 * preregistration at Sprint 3 exit. Inventing threshold values now would
 * fabricate a calibration decision that no data supports.
 */

import { type ConfidenceScore, isValidConfidenceScore } from "@futureclick/action-schema";
import { FC008_SAFETY_CAPS } from "./bounds.js";
import { FC008_FEATURE_POLICY_VERSION } from "./feature-policy.js";
import { FC008_SUPPORT_MATRIX_VERSION } from "./support-matrix.js";
import {
  FC008_VALIDATION_CODES,
  type ValidationIssue,
  type ValidationResult,
  inspectClosedObject,
  invalid,
  issue,
  readBoundedInteger,
  readBoundedNumber,
  readString,
  safeFormatValue,
  valid,
} from "./validation.js";

export interface AbstentionPolicy {
  readonly policyVersion: string;
  /** Minimum calibrated confidence for acceptance. Below this: LOW_CONFIDENCE. */
  readonly minCalibratedConfidence: ConfidenceScore;
  /** Minimum gap between the top two calibrated probabilities. Below: AMBIGUOUS_ACTION. */
  readonly minMargin: number;
  /** Maximum tolerated unknown-token ratio. Above: NOVEL_OR_UNSUPPORTED_INPUT. */
  readonly maxUnknownTokenRatio: number;
  /** Minimum required-group coverage. Below: INSUFFICIENT_CONTEXT. */
  readonly minFeatureCoverage: number;
  /** Minimum retained sanitization ratio. Below: PRIVACY_REDACTION_TOO_HIGH. */
  readonly minRetainedRedactionRatio: number;
  /** Operational timeout. Must not exceed the absolute ceiling. */
  readonly inferenceTimeoutMs: number;
  readonly requiredSupportMatrixVersion: string;
  readonly requiredFeaturePolicyVersion: string;
}

const POLICY_KEYS = [
  "policyVersion",
  "minCalibratedConfidence",
  "minMargin",
  "maxUnknownTokenRatio",
  "minFeatureCoverage",
  "minRetainedRedactionRatio",
  "inferenceTimeoutMs",
  "requiredSupportMatrixVersion",
  "requiredFeaturePolicyVersion",
] as const;

/**
 * Validates an untrusted value as an `AbstentionPolicy` and returns a frozen
 * instance. Fails closed: a policy that cannot be validated must never be used,
 * because the alternative is accepting hypotheses under unknown criteria.
 */
export function validateAbstentionPolicy(
  input: unknown,
  path = "policy",
): ValidationResult<AbstentionPolicy> {
  try {
    return validateAbstentionPolicyInternal(input, path);
  } catch {
    return invalid([
      issue(
        FC008_VALIDATION_CODES.readError,
        path,
        "AbstentionPolicy validation failed closed on an unhandled runtime exception.",
      ),
    ]);
  }
}

function validateAbstentionPolicyInternal(
  input: unknown,
  path: string,
): ValidationResult<AbstentionPolicy> {
  const inspection = inspectClosedObject(input, POLICY_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const fields = inspection.fields;
  const issues: ValidationIssue[] = [];

  const policyVersion = readString(fields, "policyVersion", path, issues);
  if (policyVersion !== undefined && (policyVersion.length === 0 || policyVersion.length > 64)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.boundExceeded,
        `${path}.policyVersion`,
        "policyVersion must be a non-empty string of at most 64 characters.",
      ),
    );
  }

  const rawMinConfidence = fields.get("minCalibratedConfidence");
  if (!isValidConfidenceScore(rawMinConfidence)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.boundExceeded,
        `${path}.minCalibratedConfidence`,
        `minCalibratedConfidence must be a finite number within [0, 1], received ${safeFormatValue(rawMinConfidence)}.`,
      ),
    );
  }

  const minMargin = readBoundedNumber(fields, "minMargin", 0, 1, path, issues);
  const maxUnknownTokenRatio = readBoundedNumber(
    fields,
    "maxUnknownTokenRatio",
    0,
    1,
    path,
    issues,
  );
  const minFeatureCoverage = readBoundedNumber(fields, "minFeatureCoverage", 0, 1, path, issues);
  const minRetainedRedactionRatio = readBoundedNumber(
    fields,
    "minRetainedRedactionRatio",
    0,
    1,
    path,
    issues,
  );

  const inferenceTimeoutMs = readBoundedInteger(
    fields,
    "inferenceTimeoutMs",
    FC008_SAFETY_CAPS.absoluteInferenceTimeoutCeilingMs,
    path,
    issues,
  );
  if (inferenceTimeoutMs !== undefined && inferenceTimeoutMs < 1) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.boundExceeded,
        `${path}.inferenceTimeoutMs`,
        "inferenceTimeoutMs must be at least 1 millisecond.",
      ),
    );
  }

  const requiredSupportMatrixVersion = readString(
    fields,
    "requiredSupportMatrixVersion",
    path,
    issues,
  );
  if (
    requiredSupportMatrixVersion !== undefined &&
    requiredSupportMatrixVersion !== FC008_SUPPORT_MATRIX_VERSION
  ) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        `${path}.requiredSupportMatrixVersion`,
        `requiredSupportMatrixVersion must be "${FC008_SUPPORT_MATRIX_VERSION}".`,
      ),
    );
  }

  const requiredFeaturePolicyVersion = readString(
    fields,
    "requiredFeaturePolicyVersion",
    path,
    issues,
  );
  if (
    requiredFeaturePolicyVersion !== undefined &&
    requiredFeaturePolicyVersion !== FC008_FEATURE_POLICY_VERSION
  ) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        `${path}.requiredFeaturePolicyVersion`,
        `requiredFeaturePolicyVersion must be "${FC008_FEATURE_POLICY_VERSION}".`,
      ),
    );
  }

  if (
    issues.length > 0 ||
    policyVersion === undefined ||
    minMargin === undefined ||
    maxUnknownTokenRatio === undefined ||
    minFeatureCoverage === undefined ||
    minRetainedRedactionRatio === undefined ||
    inferenceTimeoutMs === undefined ||
    requiredSupportMatrixVersion === undefined ||
    requiredFeaturePolicyVersion === undefined
  ) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({
      policyVersion,
      minCalibratedConfidence: rawMinConfidence as ConfidenceScore,
      minMargin,
      maxUnknownTokenRatio,
      minFeatureCoverage,
      minRetainedRedactionRatio,
      inferenceTimeoutMs,
      requiredSupportMatrixVersion,
      requiredFeaturePolicyVersion,
    }),
  );
}
