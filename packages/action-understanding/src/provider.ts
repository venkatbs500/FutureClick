/**
 * FC-008 Sprint 1 — provider scoring boundary.
 *
 * PROVIDERS SCORE. THE RUNTIME DECIDES.
 *
 * A provider may return raw uncalibrated logits and the artifact identity needed
 * to interpret them. A provider may NOT:
 * - construct or return an `ActionHypothesis`
 * - emit `VERIFIED` or any evidence mode
 * - declare itself accepted, or supply an acceptance or abstention decision
 * - read, carry, or influence any threshold or timeout
 * - report its own input-support evidence (see `support.ts` for why)
 * - click, submit, navigate, mutate the DOM, invoke a tool, or reach FC-007
 *
 * Four structural controls enforce this:
 *
 * 1. `ProviderScoringContext` carries NO threshold and NO timeout field, so a
 *    provider has nothing to apply and nothing to extend.
 * 2. A provider receives `ObservationSemantics` only, never `ActionObservation`,
 *    so the acquisition and benchmark layers are unreachable from a provider
 *    exactly as they are from a projector. Layer D is not a field of
 *    `ActionObservation` at all.
 * 3. The score set carries NO support, coverage, or unknown-count field. Support
 *    assessment is produced runtime-side by `assessSupport`.
 * 4. `validateProviderOutcome` closed-shape validates provider output, so a
 *    hostile provider that returns an extra `hypothesis`, `evidenceMode`,
 *    `accepted`, or `evidence` field is rejected as an operational defect
 *    rather than trusted.
 *
 * MODEL FAMILIES
 *
 * FC-008 has two approved families and the boundary must carry both losslessly,
 * so that Sprint 3 does not need a breaking redesign:
 *
 * - `joint-logistic`      13 supported-tuple logits
 * - `factorized-logistic` 10 verb + 9 object + 10 transition-property logits
 *
 * All three factorized heads are preserved separately rather than composed at
 * the boundary. Composing here would destroy the information RQ1 needs, would
 * make correct temperature calibration impossible to define later, and would
 * make unsupported-combination mass uncomputable.
 *
 * Composition stays runtime-owned. A valid factorized payload is accepted and
 * validated here in full; the runtime composes the 13 supported tuples when the
 * frozen mapping is supplied. Without that mapping the runtime still returns
 * the operational result `MODEL_UNAVAILABLE` with the bounded categorical
 * detail `composition` / `composition-not-implemented`. The refusal is
 * operational rather than epistemic because unimplemented composition is a
 * system limitation, not a statement about input difficulty.
 */

import { FC008_FEATURE_POLICY_VERSION } from "./feature-policy.js";
import { FC008_MODEL_FAMILIES, type Fc008ModelFamily, SHA256_HEX_REGEX } from "./hypothesis.js";
import type { ObservationSemantics } from "./observation.js";
import {
  FC008_MATRIX_OBJECT_KIND_COUNT,
  FC008_MATRIX_TRANSITION_PROPERTY_COUNT,
  FC008_MATRIX_VERB_COUNT,
  FC008_SUPPORT_MATRIX_VERSION,
  FC008_SUPPORTED_TUPLE_COUNT,
} from "./support-matrix.js";
import {
  FC008_VALIDATION_CODES,
  type ValidationIssue,
  type ValidationResult,
  captureBoundedArray,
  inspectClosedObject,
  invalid,
  issue,
  readEnum,
  readString,
  safeFormatValue,
  valid,
} from "./validation.js";

/** Largest absolute logit accepted. Guards against Infinity and overflow. */
export const MAX_ABSOLUTE_LOGIT = 1_000;

/**
 * Everything a provider is told. Deliberately minimal, threshold-free, and
 * timeout-free.
 */
export interface ProviderScoringContext {
  readonly supportMatrixVersion: string;
  readonly featurePolicyVersion: string;
}

export interface ArtifactDescriptor {
  readonly modelFamily: Fc008ModelFamily;
  readonly modelVersion: string;
  readonly artifactSha256: string;
  readonly supportMatrixVersion: string;
  readonly featurePolicyVersion: string;
  readonly calibrationArtifactVersion: string;
}

/**
 * The complete definition of artifact identity, declared once.
 *
 * Every boundary that claims to have produced or been fitted for an artifact
 * must agree on ALL of these. Comparing a subset — model SHA and version alone,
 * for instance — silently accepts scores produced under a different support
 * matrix or a different feature policy, which is a real incompatibility that
 * looks like a match. Enumerating the fields here means a new identity dimension
 * is added in one place and immediately enforced at every boundary.
 */
export const ARTIFACT_IDENTITY_FIELDS = Object.freeze([
  "modelFamily",
  "modelVersion",
  "artifactSha256",
  "supportMatrixVersion",
  "featurePolicyVersion",
  "calibrationArtifactVersion",
] as const);

export type ArtifactIdentityField = (typeof ARTIFACT_IDENTITY_FIELDS)[number];

/**
 * The first identity field on which two descriptors disagree, or null when all
 * agree. Returning the field rather than a boolean keeps a mismatch diagnosable
 * without widening the bounded failure detail.
 */
export function artifactIdentityDivergence(
  claimed: ArtifactDescriptor,
  authoritative: ArtifactDescriptor,
): ArtifactIdentityField | null {
  for (const field of ARTIFACT_IDENTITY_FIELDS) {
    if (claimed[field] !== authoritative[field]) {
      return field;
    }
  }
  return null;
}

/** Whether two descriptors agree on every identity field. */
export function artifactIdentityMatches(
  claimed: ArtifactDescriptor,
  authoritative: ArtifactDescriptor,
): boolean {
  return artifactIdentityDivergence(claimed, authoritative) === null;
}

/**
 * Raw uncalibrated scores, discriminated by model family.
 *
 * Head ordering is the canonical ordering declared by the support matrix, so a
 * logit index always means the same class.
 */
export type ProviderModelScores =
  | {
      readonly family: "joint-logistic";
      /** One logit per supported tuple, in frozen class order. Exactly 13. */
      readonly tupleLogits: readonly number[];
    }
  | {
      readonly family: "factorized-logistic";
      /** One logit per matrix verb, in canonical order. Exactly 10. */
      readonly verbLogits: readonly number[];
      /** One logit per matrix object kind, in canonical order. Exactly 9. */
      readonly objectLogits: readonly number[];
      /** One logit per matrix transition property, in canonical order. Exactly 10. */
      readonly transitionLogits: readonly number[];
    };

export interface ProviderScoreSet {
  readonly scores: ProviderModelScores;
  readonly artifact: ArtifactDescriptor;
}

export type ProviderOutcome =
  | { readonly status: "scored"; readonly scores: ProviderScoreSet }
  | { readonly status: "unavailable"; readonly detail: ProviderDiagnostic }
  | { readonly status: "timeout"; readonly detail: ProviderDiagnostic }
  | { readonly status: "version-mismatch"; readonly detail: ProviderDiagnostic }
  | { readonly status: "error"; readonly detail: ProviderDiagnostic };

export const PROVIDER_OUTCOME_STATUSES = Object.freeze([
  "scored",
  "unavailable",
  "timeout",
  "version-mismatch",
  "error",
] as const);

/**
 * Closed diagnostic vocabulary for a non-scored provider outcome.
 *
 * Categorical rather than free text for the same reason as `FailureDetail`: a
 * provider must not be able to push an arbitrary string into a failure record.
 */
export const PROVIDER_DIAGNOSTICS = Object.freeze([
  "not-implemented",
  "no-artifact-loaded",
  "artifact-load-failed",
  "deadline-exceeded",
  "version-unsupported",
  "internal-error",
] as const);
export type ProviderDiagnostic = (typeof PROVIDER_DIAGNOSTICS)[number];

export interface ScoringProvider {
  readonly providerId: string;
  /**
   * @param semantics Layer B only. The provider cannot reach any other layer.
   * @param context Versions only. No thresholds, no timeout, no capabilities.
   */
  score(semantics: ObservationSemantics, context: ProviderScoringContext): ProviderOutcome;
}

const ARTIFACT_KEYS = [
  "modelFamily",
  "modelVersion",
  "artifactSha256",
  "supportMatrixVersion",
  "featurePolicyVersion",
  "calibrationArtifactVersion",
] as const;

const SCORE_SET_KEYS = ["scores", "artifact"] as const;
const JOINT_SCORE_KEYS = ["family", "tupleLogits"] as const;
const FACTORIZED_SCORE_KEYS = ["family", "verbLogits", "objectLogits", "transitionLogits"] as const;

function validateArtifactDescriptor(
  input: unknown,
  path: string,
): ValidationResult<ArtifactDescriptor> {
  const inspection = inspectClosedObject(input, ARTIFACT_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const issues: ValidationIssue[] = [];
  const fields = inspection.fields;

  const modelFamily = readEnum(fields, "modelFamily", FC008_MODEL_FAMILIES, path, issues);
  const modelVersion = readString(fields, "modelVersion", path, issues);
  const artifactSha256 = readString(fields, "artifactSha256", path, issues);
  const supportMatrixVersion = readString(fields, "supportMatrixVersion", path, issues);
  const featurePolicyVersion = readString(fields, "featurePolicyVersion", path, issues);
  const calibrationArtifactVersion = readString(fields, "calibrationArtifactVersion", path, issues);

  if (artifactSha256 !== undefined && !SHA256_HEX_REGEX.test(artifactSha256)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.patternViolation,
        `${path}.artifactSha256`,
        "artifactSha256 must be 64 lowercase hexadecimal characters.",
      ),
    );
  }
  for (const [key, value] of [
    ["modelVersion", modelVersion],
    ["supportMatrixVersion", supportMatrixVersion],
    ["featurePolicyVersion", featurePolicyVersion],
    ["calibrationArtifactVersion", calibrationArtifactVersion],
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
    modelFamily === undefined ||
    modelVersion === undefined ||
    artifactSha256 === undefined ||
    supportMatrixVersion === undefined ||
    featurePolicyVersion === undefined ||
    calibrationArtifactVersion === undefined
  ) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({
      modelFamily,
      modelVersion,
      artifactSha256,
      supportMatrixVersion,
      featurePolicyVersion,
      calibrationArtifactVersion,
    }),
  );
}

/** Captures exactly `expected` finite bounded logits, or reports why not. */
function captureLogitHead(
  input: unknown,
  expected: number,
  path: string,
  issues: ValidationIssue[],
): readonly number[] | undefined {
  const capture = captureBoundedArray(input, expected, path);
  if (!capture.ok) {
    issues.push(...capture.issues);
    return undefined;
  }
  if (capture.values.length !== expected) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.invariantViolation,
        path,
        `Expected exactly ${expected} logits, received ${capture.values.length}.`,
      ),
    );
    return undefined;
  }

  const logits: number[] = [];
  for (let i = 0; i < capture.values.length; i++) {
    const value = capture.values[i];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.typeMismatch,
          `${path}[${i}]`,
          `Logit must be a finite number, received ${safeFormatValue(value)}.`,
        ),
      );
      continue;
    }
    if (Math.abs(value) > MAX_ABSOLUTE_LOGIT) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.boundExceeded,
          `${path}[${i}]`,
          `Logit magnitude must not exceed ${MAX_ABSOLUTE_LOGIT}.`,
        ),
      );
      continue;
    }
    logits.push(value);
  }
  return logits.length === expected ? Object.freeze(logits) : undefined;
}

/**
 * Validates the raw score payload.
 *
 * Each family is closed-shape validated against its OWN key set, so a mixed
 * payload — a joint family carrying `verbLogits`, or a factorized family
 * carrying `tupleLogits` — is rejected rather than silently half-read.
 */
function validateModelScores(input: unknown, path: string): ValidationResult<ProviderModelScores> {
  const probe = inspectClosedObject(
    input,
    ["family"],
    ["tupleLogits", "verbLogits", "objectLogits", "transitionLogits"],
    path,
  );
  if (!probe.ok) {
    return invalid(probe.issues);
  }
  const issues: ValidationIssue[] = [];
  const family = readEnum(probe.fields, "family", FC008_MODEL_FAMILIES, path, issues);
  if (family === undefined) {
    return invalid(issues);
  }

  if (family === "joint-logistic") {
    const closed = inspectClosedObject(input, JOINT_SCORE_KEYS, [], path);
    if (!closed.ok) {
      return invalid(closed.issues);
    }
    const tupleLogits = captureLogitHead(
      closed.fields.get("tupleLogits"),
      FC008_SUPPORTED_TUPLE_COUNT,
      `${path}.tupleLogits`,
      issues,
    );
    if (issues.length > 0 || tupleLogits === undefined) {
      return invalid(issues);
    }
    return valid(Object.freeze({ family: "joint-logistic" as const, tupleLogits }));
  }

  const closed = inspectClosedObject(input, FACTORIZED_SCORE_KEYS, [], path);
  if (!closed.ok) {
    return invalid(closed.issues);
  }
  const verbLogits = captureLogitHead(
    closed.fields.get("verbLogits"),
    FC008_MATRIX_VERB_COUNT,
    `${path}.verbLogits`,
    issues,
  );
  const objectLogits = captureLogitHead(
    closed.fields.get("objectLogits"),
    FC008_MATRIX_OBJECT_KIND_COUNT,
    `${path}.objectLogits`,
    issues,
  );
  const transitionLogits = captureLogitHead(
    closed.fields.get("transitionLogits"),
    FC008_MATRIX_TRANSITION_PROPERTY_COUNT,
    `${path}.transitionLogits`,
    issues,
  );
  if (
    issues.length > 0 ||
    verbLogits === undefined ||
    objectLogits === undefined ||
    transitionLogits === undefined
  ) {
    return invalid(issues);
  }
  return valid(
    Object.freeze({
      family: "factorized-logistic" as const,
      verbLogits,
      objectLogits,
      transitionLogits,
    }),
  );
}

/**
 * Closed-shape validates a provider outcome.
 *
 * Any additional key — `hypothesis`, `evidenceMode`, `accepted`, `policy`,
 * `calibratedConfidence`, `evidence`, `support`, `featureCoverage`,
 * `unknownTokenCount`, or anything else a provider might use to assert
 * authority it does not have — causes rejection.
 */
export function validateProviderOutcome(
  input: unknown,
  path = "providerOutcome",
): ValidationResult<ProviderOutcome> {
  try {
    return validateProviderOutcomeInternal(input, path);
  } catch {
    return invalid([
      issue(
        FC008_VALIDATION_CODES.readError,
        path,
        "Provider outcome validation failed closed on an unhandled runtime exception.",
      ),
    ]);
  }
}

function validateProviderOutcomeInternal(
  input: unknown,
  path: string,
): ValidationResult<ProviderOutcome> {
  const statusProbe = inspectClosedObject(input, ["status"], ["scores", "detail"], path);
  if (!statusProbe.ok) {
    return invalid(statusProbe.issues);
  }
  const issues: ValidationIssue[] = [];
  const status = readEnum(statusProbe.fields, "status", PROVIDER_OUTCOME_STATUSES, path, issues);
  if (status === undefined) {
    return invalid(issues);
  }

  if (status !== "scored") {
    const nonScored = inspectClosedObject(input, ["status", "detail"], [], path);
    if (!nonScored.ok) {
      return invalid(nonScored.issues);
    }
    const detail = readEnum(nonScored.fields, "detail", PROVIDER_DIAGNOSTICS, path, issues);
    if (detail === undefined) {
      return invalid(issues);
    }
    return valid(Object.freeze({ status, detail }) as ProviderOutcome);
  }

  const scored = inspectClosedObject(input, ["status", "scores"], [], path);
  if (!scored.ok) {
    return invalid(scored.issues);
  }
  const scoreSetInspection = inspectClosedObject(
    scored.fields.get("scores"),
    SCORE_SET_KEYS,
    [],
    `${path}.scores`,
  );
  if (!scoreSetInspection.ok) {
    return invalid(scoreSetInspection.issues);
  }

  const scoresResult = validateModelScores(
    scoreSetInspection.fields.get("scores"),
    `${path}.scores.scores`,
  );
  if (!scoresResult.valid) {
    issues.push(...scoresResult.issues);
  }
  const artifactResult = validateArtifactDescriptor(
    scoreSetInspection.fields.get("artifact"),
    `${path}.scores.artifact`,
  );
  if (!artifactResult.valid) {
    issues.push(...artifactResult.issues);
  }

  // Identity consistency: the payload family must be the family the artifact
  // claims, so scores from one family cannot be read under another's ordering.
  if (
    scoresResult.valid &&
    artifactResult.valid &&
    scoresResult.value.family !== artifactResult.value.modelFamily
  ) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.invariantViolation,
        `${path}.scores`,
        "Score payload family must equal the artifact modelFamily.",
      ),
    );
  }

  if (issues.length > 0 || !scoresResult.valid || !artifactResult.valid) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({
      status: "scored" as const,
      scores: Object.freeze({
        scores: scoresResult.value,
        artifact: artifactResult.value,
      }),
    }),
  );
}

/** The scoring context the runtime constructs. Versions only. */
export function createProviderScoringContext(): ProviderScoringContext {
  return Object.freeze({
    supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
    featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
  });
}
