/**
 * FC-008 Sprint 1 — PREDICTED-only `ActionHypothesis`.
 *
 * A hypothesis is an inert, deeply frozen, serializable record. It carries no
 * `Element`, `Node`, `Event`, function, callback, executor, release token, click
 * capability, DOM reference, tool, or mutable authority of any kind. There is no
 * VERIFIED path through this type: `evidenceMode` is the literal string
 * `"predicted"` and is never widened.
 *
 * Contrast with FC-007's `Fc007VerifiedDecision`, which is release-capable
 * precisely because it holds live DOM references. FC-008 output is structurally
 * incapable of the same thing.
 *
 * Confidence exposed here is deliberately minimal. Research diagnostics
 * (uncalibrated model confidence, margin, entropy, raw logits, the full
 * probability vector, unsupported-combination mass, latency) live in
 * `InferenceDiagnostics` and are emitted only in local research mode.
 */

import {
  type ConfidenceScore,
  type ActorKind,
  ACTOR_KINDS,
  isValidConfidenceScore,
} from "@futureclick/action-schema";
import type { Brand, IsoTimestamp } from "@futureclick/shared";
import { FC008_SAFETY_CAPS } from "./bounds.js";
import { FC008_FEATURE_POLICY_VERSION } from "./feature-policy.js";
import { type FreshnessBinding, validateFreshnessBinding } from "./freshness.js";
import { type ActionObservationId, FC008_ID_REGEX } from "./observation.js";
import {
  FC008_SUPPORT_MATRIX_VERSION,
  type SupportedTuple,
  resolveSupportedTuple,
  supportedTupleKey,
} from "./support-matrix.js";
import type { RuntimeSupportDiagnostics } from "./support.js";
import {
  FC008_VALIDATION_CODES,
  type ValidationIssue,
  type ValidationResult,
  captureBoundedArray,
  inspectClosedObject,
  invalid,
  issue,
  readBoundedNumber,
  readEnum,
  readString,
  safeFormatValue,
  valid,
} from "./validation.js";

export type ActionHypothesisId = Brand<string, "ActionHypothesisId">;

export const ACTION_HYPOTHESIS_SCHEMA_VERSION = "1.0" as const;

/** The only evidence mode FC-008 can ever produce. */
export const FC008_EVIDENCE_MODE = "predicted" as const;
export type Fc008EvidenceMode = typeof FC008_EVIDENCE_MODE;

/** The two research model families. Neither is a product winner. */
export const FC008_MODEL_FAMILIES = Object.freeze([
  "factorized-logistic",
  "joint-logistic",
] as const);
export type Fc008ModelFamily = (typeof FC008_MODEL_FAMILIES)[number];

export const CALIBRATION_METHOD = "temperature-scaling" as const;

export const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

/**
 * Product-facing confidence. Calibrated only.
 *
 * Interpretation: among examples assigned probability near p, empirical
 * top-label correctness should be near p under the evaluated distribution,
 * subject to sampling uncertainty. For a set selected at confidence at or above
 * a threshold, empirical accuracy is compared against that selected set's MEAN
 * predicted confidence. FC-008 makes no claim that error approximates one minus
 * the threshold.
 */
export interface HypothesisConfidence {
  readonly calibratedConfidence: ConfidenceScore;
  readonly calibrationMethod: typeof CALIBRATION_METHOD;
  readonly calibrationArtifactVersion: string;
}

export interface ArtifactProvenance {
  /** Canonical `PROVENANCE_SOURCES` member for model-derived evidence. */
  readonly source: "model";
  readonly modelFamily: Fc008ModelFamily;
  readonly modelVersion: string;
  readonly artifactSha256: string;
  readonly supportMatrixVersion: string;
  readonly featurePolicyVersion: string;
  readonly abstentionPolicyVersion: string;
  readonly inferenceTimestamp: IsoTimestamp;
}

export interface HypothesisAlternative {
  readonly tuple: SupportedTuple;
  readonly calibratedConfidence: ConfidenceScore;
}

export interface ActionHypothesis {
  readonly schemaVersion: typeof ACTION_HYPOTHESIS_SCHEMA_VERSION;
  readonly id: ActionHypothesisId;
  readonly evidenceMode: Fc008EvidenceMode;
  readonly observationId: ActionObservationId;
  readonly inputFingerprint: string;
  /** Echoed so any consumer can re-verify currency without trusting delivery order. */
  readonly freshness: FreshnessBinding;
  /** Inherited from validated acquisition context. Never predicted. */
  readonly actor: { readonly kind: ActorKind };
  readonly tuple: SupportedTuple;
  readonly alternatives: readonly HypothesisAlternative[];
  readonly confidence: HypothesisConfidence;
  readonly support: RuntimeSupportDiagnostics;
  readonly provenance: ArtifactProvenance;
}

/**
 * Research-only diagnostics. Never part of `ActionHypothesis`. Populated only in
 * explicit local research mode and never persisted in a product path.
 */
export interface InferenceDiagnostics {
  /** Maximum UNCALIBRATED softmax probability. Internal research diagnostic. */
  readonly modelConfidence: number;
  /** Difference between the top two CALIBRATED probabilities. */
  readonly margin: number;
  /** Normalised entropy of the CALIBRATED distribution. */
  readonly entropy: number;
  /** Probability mass discarded by factorized supported-set renormalisation. */
  readonly unsupportedCombinationMass: number;
  readonly latencyMs: number;
}

// ============================================================================
// VALIDATION
// ============================================================================

const PROVENANCE_KEYS = [
  "source",
  "modelFamily",
  "modelVersion",
  "artifactSha256",
  "supportMatrixVersion",
  "featurePolicyVersion",
  "abstentionPolicyVersion",
  "inferenceTimestamp",
] as const;

const CONFIDENCE_KEYS = [
  "calibratedConfidence",
  "calibrationMethod",
  "calibrationArtifactVersion",
] as const;

const SUPPORT_KEYS = [
  "requiredFeatureGroupsPresent",
  "requiredFeatureGroupsTotal",
  "featureCoverage",
  "unknownTokenRatio",
  "unknownTokenRatioAvailable",
  "unknownCategoricalCount",
  "supportedObjectEvidence",
  "minimumSemanticEvidence",
  "supportedTupleResolved",
  "schemaVersionsMatched",
] as const;

const HYPOTHESIS_KEYS = [
  "schemaVersion",
  "id",
  "evidenceMode",
  "observationId",
  "inputFingerprint",
  "freshness",
  "actor",
  "tuple",
  "alternatives",
  "confidence",
  "support",
  "provenance",
] as const;

const TUPLE_KEYS = ["verb", "objectKind", "transition"] as const;

function validateTuple(input: unknown, path: string): ValidationResult<SupportedTuple> {
  const inspection = inspectClosedObject(input, TUPLE_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const transitionInspection = inspectClosedObject(
    inspection.fields.get("transition"),
    ["property", "from", "to"],
    [],
    `${path}.transition`,
  );
  if (!transitionInspection.ok) {
    return invalid(transitionInspection.issues);
  }

  const candidate = {
    verb: inspection.fields.get("verb"),
    objectKind: inspection.fields.get("objectKind"),
    transition: {
      property: transitionInspection.fields.get("property"),
      from: transitionInspection.fields.get("from"),
      to: transitionInspection.fields.get("to"),
    },
  };

  const resolved = resolveSupportedTuple(candidate);
  if (resolved === undefined) {
    return invalid([
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        path,
        "Tuple is not a member of the frozen FC-008 support matrix.",
      ),
    ]);
  }
  return valid(resolved);
}

function validateConfidenceRecord(
  input: unknown,
  path: string,
): ValidationResult<HypothesisConfidence> {
  const inspection = inspectClosedObject(input, CONFIDENCE_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const issues: ValidationIssue[] = [];
  const fields = inspection.fields;

  const rawConfidence = fields.get("calibratedConfidence");
  if (!isValidConfidenceScore(rawConfidence)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.boundExceeded,
        `${path}.calibratedConfidence`,
        `calibratedConfidence must be a finite number within [0, 1], received ${safeFormatValue(rawConfidence)}.`,
      ),
    );
  }

  const method = readString(fields, "calibrationMethod", path, issues);
  if (method !== undefined && method !== CALIBRATION_METHOD) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        `${path}.calibrationMethod`,
        `calibrationMethod must be "${CALIBRATION_METHOD}".`,
      ),
    );
  }

  const artifactVersion = readString(fields, "calibrationArtifactVersion", path, issues);
  if (
    artifactVersion !== undefined &&
    (artifactVersion.length === 0 || artifactVersion.length > 64)
  ) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.boundExceeded,
        `${path}.calibrationArtifactVersion`,
        "calibrationArtifactVersion must be a non-empty string of at most 64 characters.",
      ),
    );
  }

  if (issues.length > 0 || artifactVersion === undefined) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({
      calibratedConfidence: rawConfidence as ConfidenceScore,
      calibrationMethod: CALIBRATION_METHOD,
      calibrationArtifactVersion: artifactVersion,
    }),
  );
}

function validateSupportRecord(
  input: unknown,
  path: string,
): ValidationResult<RuntimeSupportDiagnostics> {
  const inspection = inspectClosedObject(input, SUPPORT_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const issues: ValidationIssue[] = [];
  const fields = inspection.fields;

  const present = readBoundedNumber(fields, "requiredFeatureGroupsPresent", 0, 6, path, issues);
  const total = readBoundedNumber(fields, "requiredFeatureGroupsTotal", 6, 6, path, issues);
  const coverage = readBoundedNumber(fields, "featureCoverage", 0, 1, path, issues);
  const unknownTokenRatio = readBoundedNumber(fields, "unknownTokenRatio", 0, 1, path, issues);
  const unknownCategoricalCount = readBoundedNumber(
    fields,
    "unknownCategoricalCount",
    0,
    Number.MAX_SAFE_INTEGER,
    path,
    issues,
  );

  const booleans: Record<string, boolean> = {};
  for (const key of [
    "unknownTokenRatioAvailable",
    "supportedObjectEvidence",
    "minimumSemanticEvidence",
    "supportedTupleResolved",
    "schemaVersionsMatched",
  ] as const) {
    const value = fields.get(key);
    if (typeof value !== "boolean") {
      issues.push(
        issue(FC008_VALIDATION_CODES.typeMismatch, `${path}.${key}`, `${key} must be a boolean.`),
      );
      continue;
    }
    booleans[key] = value;
  }

  if (
    present !== undefined &&
    coverage !== undefined &&
    Math.abs(coverage - present / 6) > Number.EPSILON * 8
  ) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.invariantViolation,
        `${path}.featureCoverage`,
        "featureCoverage must equal requiredFeatureGroupsPresent divided by six.",
      ),
    );
  }

  if (
    issues.length > 0 ||
    present === undefined ||
    total === undefined ||
    coverage === undefined ||
    unknownTokenRatio === undefined ||
    unknownCategoricalCount === undefined
  ) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({
      requiredFeatureGroupsPresent: present,
      requiredFeatureGroupsTotal: 6,
      featureCoverage: coverage,
      unknownTokenRatio,
      unknownTokenRatioAvailable: booleans.unknownTokenRatioAvailable as boolean,
      unknownCategoricalCount,
      supportedObjectEvidence: booleans.supportedObjectEvidence as boolean,
      minimumSemanticEvidence: booleans.minimumSemanticEvidence as boolean,
      supportedTupleResolved: booleans.supportedTupleResolved as boolean,
      schemaVersionsMatched: booleans.schemaVersionsMatched as boolean,
    }),
  );
}

function validateArtifactProvenance(
  input: unknown,
  path: string,
): ValidationResult<ArtifactProvenance> {
  const inspection = inspectClosedObject(input, PROVENANCE_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const issues: ValidationIssue[] = [];
  const fields = inspection.fields;

  const source = readEnum(fields, "source", ["model"] as const, path, issues);
  const modelFamily = readEnum(fields, "modelFamily", FC008_MODEL_FAMILIES, path, issues);
  const modelVersion = readString(fields, "modelVersion", path, issues);
  const artifactSha256 = readString(fields, "artifactSha256", path, issues);
  const supportMatrixVersion = readString(fields, "supportMatrixVersion", path, issues);
  const featurePolicyVersion = readString(fields, "featurePolicyVersion", path, issues);
  const abstentionPolicyVersion = readString(fields, "abstentionPolicyVersion", path, issues);
  const inferenceTimestamp = readString(fields, "inferenceTimestamp", path, issues);

  if (artifactSha256 !== undefined && !SHA256_HEX_REGEX.test(artifactSha256)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.patternViolation,
        `${path}.artifactSha256`,
        "artifactSha256 must be 64 lowercase hexadecimal characters.",
      ),
    );
  }
  if (supportMatrixVersion !== undefined && supportMatrixVersion !== FC008_SUPPORT_MATRIX_VERSION) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        `${path}.supportMatrixVersion`,
        `supportMatrixVersion must be "${FC008_SUPPORT_MATRIX_VERSION}".`,
      ),
    );
  }
  if (featurePolicyVersion !== undefined && featurePolicyVersion !== FC008_FEATURE_POLICY_VERSION) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        `${path}.featurePolicyVersion`,
        `featurePolicyVersion must be "${FC008_FEATURE_POLICY_VERSION}".`,
      ),
    );
  }
  for (const [key, value] of [
    ["modelVersion", modelVersion],
    ["abstentionPolicyVersion", abstentionPolicyVersion],
    ["inferenceTimestamp", inferenceTimestamp],
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
    source === undefined ||
    modelFamily === undefined ||
    modelVersion === undefined ||
    artifactSha256 === undefined ||
    supportMatrixVersion === undefined ||
    featurePolicyVersion === undefined ||
    abstentionPolicyVersion === undefined ||
    inferenceTimestamp === undefined
  ) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({
      source,
      modelFamily,
      modelVersion,
      artifactSha256,
      supportMatrixVersion,
      featurePolicyVersion,
      abstentionPolicyVersion,
      inferenceTimestamp: inferenceTimestamp as IsoTimestamp,
    }),
  );
}

/**
 * Validates an untrusted value as an `ActionHypothesis`.
 *
 * Used by the runtime to reject a fabricated hypothesis supplied from any source
 * other than its own construction path, and by tests to prove that a hostile
 * provider cannot self-certify a result.
 */
export function validateActionHypothesis(
  input: unknown,
  path = "hypothesis",
): ValidationResult<ActionHypothesis> {
  try {
    return validateActionHypothesisInternal(input, path);
  } catch {
    return invalid([
      issue(
        FC008_VALIDATION_CODES.readError,
        path,
        "ActionHypothesis validation failed closed on an unhandled runtime exception.",
      ),
    ]);
  }
}

function validateActionHypothesisInternal(
  input: unknown,
  path: string,
): ValidationResult<ActionHypothesis> {
  const inspection = inspectClosedObject(input, HYPOTHESIS_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const fields = inspection.fields;
  const issues: ValidationIssue[] = [];

  const schemaVersion = readString(fields, "schemaVersion", path, issues);
  if (schemaVersion !== undefined && schemaVersion !== ACTION_HYPOTHESIS_SCHEMA_VERSION) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        `${path}.schemaVersion`,
        `Unsupported ActionHypothesis schemaVersion "${safeFormatValue(schemaVersion)}".`,
      ),
    );
  }

  // The single most important check in this module: there is no VERIFIED path.
  const evidenceMode = fields.get("evidenceMode");
  if (evidenceMode !== FC008_EVIDENCE_MODE) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        `${path}.evidenceMode`,
        `evidenceMode must be the literal "${FC008_EVIDENCE_MODE}". FC-008 can never emit "verified" or "simulated".`,
      ),
    );
  }

  const id = readString(fields, "id", path, issues);
  if (id !== undefined && !FC008_ID_REGEX.test(id)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.patternViolation,
        `${path}.id`,
        "id must be an opaque bounded identifier.",
      ),
    );
  }
  const observationId = readString(fields, "observationId", path, issues);
  if (observationId !== undefined && !FC008_ID_REGEX.test(observationId)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.patternViolation,
        `${path}.observationId`,
        "observationId must be an opaque bounded identifier.",
      ),
    );
  }
  const inputFingerprint = readString(fields, "inputFingerprint", path, issues);
  if (inputFingerprint !== undefined && inputFingerprint.length === 0) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.boundExceeded,
        `${path}.inputFingerprint`,
        "inputFingerprint must be non-empty.",
      ),
    );
  }

  let actorKind: ActorKind | undefined;
  const actorInspection = inspectClosedObject(fields.get("actor"), ["kind"], [], `${path}.actor`);
  if (!actorInspection.ok) {
    issues.push(...actorInspection.issues);
  } else {
    actorKind = readEnum(actorInspection.fields, "kind", ACTOR_KINDS, `${path}.actor`, issues);
  }

  const freshnessResult = validateFreshnessBinding(fields.get("freshness"), `${path}.freshness`);
  if (!freshnessResult.valid) {
    issues.push(...freshnessResult.issues);
  }
  const tupleResult = validateTuple(fields.get("tuple"), `${path}.tuple`);
  if (!tupleResult.valid) {
    issues.push(...tupleResult.issues);
  }
  const confidenceResult = validateConfidenceRecord(fields.get("confidence"), `${path}.confidence`);
  if (!confidenceResult.valid) {
    issues.push(...confidenceResult.issues);
  }
  const supportResult = validateSupportRecord(fields.get("support"), `${path}.support`);
  if (!supportResult.valid) {
    issues.push(...supportResult.issues);
  }
  const provenanceResult = validateArtifactProvenance(
    fields.get("provenance"),
    `${path}.provenance`,
  );
  if (!provenanceResult.valid) {
    issues.push(...provenanceResult.issues);
  }

  // --- alternatives -------------------------------------------------------
  const alternatives: HypothesisAlternative[] = [];
  const altCapture = captureBoundedArray(
    fields.get("alternatives"),
    FC008_SAFETY_CAPS.maxAlternatives,
    `${path}.alternatives`,
  );
  if (!altCapture.ok) {
    issues.push(...altCapture.issues);
  } else {
    const seen = new Set<string>();
    const primaryKey = tupleResult.valid ? supportedTupleKey(tupleResult.value) : null;
    let previousConfidence = Number.POSITIVE_INFINITY;

    for (let i = 0; i < altCapture.values.length; i++) {
      const altPath = `${path}.alternatives[${i}]`;
      const altInspection = inspectClosedObject(
        altCapture.values[i],
        ["tuple", "calibratedConfidence"],
        [],
        altPath,
      );
      if (!altInspection.ok) {
        issues.push(...altInspection.issues);
        continue;
      }
      const altTuple = validateTuple(altInspection.fields.get("tuple"), `${altPath}.tuple`);
      if (!altTuple.valid) {
        issues.push(...altTuple.issues);
        continue;
      }
      const altConfidence = altInspection.fields.get("calibratedConfidence");
      if (!isValidConfidenceScore(altConfidence)) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.boundExceeded,
            `${altPath}.calibratedConfidence`,
            "Alternative calibratedConfidence must be a finite number within [0, 1].",
          ),
        );
        continue;
      }

      const key = supportedTupleKey(altTuple.value);
      if (key === primaryKey) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.invariantViolation,
            altPath,
            "An alternative must differ from the primary tuple.",
          ),
        );
        continue;
      }
      if (seen.has(key)) {
        issues.push(
          issue(FC008_VALIDATION_CODES.duplicateValue, altPath, "Duplicate alternative tuple."),
        );
        continue;
      }
      seen.add(key);

      if (altConfidence > previousConfidence) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.invariantViolation,
            altPath,
            "Alternatives must be ordered by non-increasing calibrated confidence.",
          ),
        );
        continue;
      }
      previousConfidence = altConfidence;

      if (confidenceResult.valid && altConfidence > confidenceResult.value.calibratedConfidence) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.invariantViolation,
            altPath,
            "An alternative must not exceed the primary calibrated confidence.",
          ),
        );
        continue;
      }

      alternatives.push(
        Object.freeze({ tuple: altTuple.value, calibratedConfidence: altConfidence }),
      );
    }
  }

  if (
    issues.length > 0 ||
    id === undefined ||
    observationId === undefined ||
    inputFingerprint === undefined ||
    actorKind === undefined ||
    !freshnessResult.valid ||
    !tupleResult.valid ||
    !confidenceResult.valid ||
    !supportResult.valid ||
    !provenanceResult.valid
  ) {
    return invalid(issues);
  }

  const hypothesis: ActionHypothesis = {
    schemaVersion: ACTION_HYPOTHESIS_SCHEMA_VERSION,
    id: id as ActionHypothesisId,
    evidenceMode: FC008_EVIDENCE_MODE,
    observationId: observationId as ActionObservationId,
    inputFingerprint,
    freshness: freshnessResult.value,
    actor: Object.freeze({ kind: actorKind }),
    tuple: tupleResult.value,
    alternatives: Object.freeze(alternatives),
    confidence: confidenceResult.value,
    support: supportResult.value,
    provenance: provenanceResult.value,
  };

  return valid(Object.freeze(hypothesis));
}
