/**
 * Closed-object validation for FC-009 inputs.
 */

import type {
  EpistemicAbstentionReason,
  OperationalFailureCode,
} from "@futureclick/action-understanding";
import { FC009_SAFETY_CAPS } from "./caps.js";
import { claimIdentityFromHybridValues, isCanonicalProperty } from "./identity.js";
import { FC009_HYBRID_POLICY_VERSION, FC009_SCHEMA_VERSION } from "./policy.js";
import { HYBRID_VALIDATION_CODES, type HybridIssue, hybridIssue } from "./reasons.js";
import type {
  AdaptedAlternative,
  AdaptedPrediction,
  HybridAssumption,
  HybridEvidenceInput,
  HybridFreshnessIdentity,
  HybridPredictedProvenance,
  HybridPredictedSupport,
  HybridValueState,
  HybridVerifiedProvenance,
  VerifiedClaimInput,
} from "./types.js";
import { HYBRID_ASSUMPTION_STATUSES, HYBRID_VERIFIED_SOURCES } from "./types.js";

const EPISTEMIC_REASONS = new Set([
  "LOW_CONFIDENCE",
  "AMBIGUOUS_ACTION",
  "NOVEL_OR_UNSUPPORTED_INPUT",
  "INSUFFICIENT_CONTEXT",
  "UNSUPPORTED_OBJECT",
  "PRIVACY_REDACTION_TOO_HIGH",
  "OBSERVATION_STALE",
]);

const OPERATIONAL_CODES = new Set([
  "SCHEMA_INVALID",
  "MODEL_UNAVAILABLE",
  "MODEL_TIMEOUT",
  "MODEL_VERSION_MISMATCH",
  "INTERNAL_ERROR",
]);

export type ClosedInspection =
  | { readonly ok: true; readonly fields: ReadonlyMap<string, unknown> }
  | { readonly ok: false; readonly issues: readonly HybridIssue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function inspectClosedObject(
  value: unknown,
  requiredKeys: readonly string[],
  path: string,
): ClosedInspection {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      issues: [
        hybridIssue(HYBRID_VALIDATION_CODES.notPlainObject, path, "Expected a plain object."),
      ],
    };
  }
  const issues: HybridIssue[] = [];
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (typeof key === "symbol") {
      issues.push(
        hybridIssue(HYBRID_VALIDATION_CODES.symbolKey, path, "Symbol keys are forbidden."),
      );
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
      continue;
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      issues.push(
        hybridIssue(
          HYBRID_VALIDATION_CODES.accessorProperty,
          `${path}.${key}`,
          "Accessor properties are forbidden.",
        ),
      );
    }
    if (!requiredKeys.includes(key)) {
      issues.push(
        hybridIssue(
          HYBRID_VALIDATION_CODES.unknownKey,
          `${path}.${key}`,
          `Unknown field "${key}".`,
        ),
      );
    }
  }
  const fields = new Map<string, unknown>();
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      issues.push(
        hybridIssue(
          HYBRID_VALIDATION_CODES.missingKey,
          `${path}.${key}`,
          `Missing field "${key}".`,
        ),
      );
      continue;
    }
    const fieldValue = Reflect.get(value, key);
    if (fieldValue === undefined) {
      issues.push(
        hybridIssue(
          HYBRID_VALIDATION_CODES.undefinedValue,
          `${path}.${key}`,
          `Field "${key}" must not be undefined.`,
        ),
      );
      continue;
    }
    fields.set(key, fieldValue);
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, fields };
}

function inspectDenseArray(
  value: unknown,
  path: string,
): { ok: true; items: readonly unknown[] } | { ok: false; issues: readonly HybridIssue[] } {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      issues: [hybridIssue(HYBRID_VALIDATION_CODES.typeMismatch, path, "Expected an array.")],
    };
  }
  if (Object.keys(value).length !== value.length) {
    return {
      ok: false,
      issues: [
        hybridIssue(HYBRID_VALIDATION_CODES.sparseArray, path, "Sparse arrays are forbidden."),
      ],
    };
  }
  return { ok: true, items: value };
}

function requireString(
  value: unknown,
  path: string,
  maxChars: number,
  pattern?: RegExp,
): { ok: true; value: string } | { ok: false; issues: readonly HybridIssue[] } {
  if (typeof value !== "string") {
    return {
      ok: false,
      issues: [hybridIssue(HYBRID_VALIDATION_CODES.typeMismatch, path, "Expected a string.")],
    };
  }
  if (value.length === 0 || value.length > maxChars) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.boundExceeded,
          path,
          `String length must be 1..${maxChars}.`,
        ),
      ],
    };
  }
  if (pattern !== undefined && !pattern.test(value)) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.patternViolation,
          path,
          "String failed the closed pattern.",
        ),
      ],
    };
  }
  return { ok: true, value };
}

function parseOptionalScope(
  value: unknown,
  path: string,
): { ok: true; value: string | null } | { ok: false; issues: readonly HybridIssue[] } {
  if (value === null) {
    return { ok: true, value: null };
  }
  return requireString(value, path, FC009_SAFETY_CAPS.maxScopeChars);
}

function requireConfidence(
  value: unknown,
  path: string,
): { ok: true; value: number } | { ok: false; issues: readonly HybridIssue[] } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.confidenceInvalid,
          path,
          "Confidence must be a finite number.",
        ),
      ],
    };
  }
  if (value < 0 || value > 1) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.confidenceInvalid,
          path,
          "Confidence must be in [0, 1].",
        ),
      ],
    };
  }
  return { ok: true, value };
}

const FINGERPRINT_PATTERN = /^[\x21-\x7E]+$/;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;

function parseValueState(
  value: unknown,
  path: string,
): { ok: true; value: HybridValueState } | { ok: false; issues: readonly HybridIssue[] } {
  const inspected = inspectClosedObject(value, ["status"], path);
  if (!inspected.ok) {
    const candidate = inspectClosedObject(value, ["status", "value"], path);
    if (!candidate.ok) {
      return inspected;
    }
    const status = candidate.fields.get("status");
    if (status !== "known") {
      return {
        ok: false,
        issues: [
          hybridIssue(
            HYBRID_VALIDATION_CODES.enumViolation,
            `${path}.status`,
            'Known values require status "known".',
          ),
        ],
      };
    }
    const raw = candidate.fields.get("value");
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
      return {
        ok: false,
        issues: [
          hybridIssue(
            HYBRID_VALIDATION_CODES.typeMismatch,
            `${path}.value`,
            "Known value must be a string, number, or boolean.",
          ),
        ],
      };
    }
    if (typeof raw === "number" && !Number.isFinite(raw)) {
      return {
        ok: false,
        issues: [
          hybridIssue(
            HYBRID_VALIDATION_CODES.confidenceInvalid,
            `${path}.value`,
            "Numeric value must be finite.",
          ),
        ],
      };
    }
    if (typeof raw === "string") {
      const token = requireString(
        raw,
        `${path}.value`,
        FC009_SAFETY_CAPS.maxValueChars,
        TOKEN_PATTERN,
      );
      if (!token.ok) {
        return token;
      }
      return { ok: true, value: { status: "known", value: token.value } };
    }
    return { ok: true, value: { status: "known", value: raw } };
  }
  const status = inspected.fields.get("status");
  if (status === "absent") {
    return { ok: true, value: { status: "absent" } };
  }
  if (status === "unknown") {
    return { ok: true, value: { status: "unknown" } };
  }
  return {
    ok: false,
    issues: [
      hybridIssue(
        HYBRID_VALIDATION_CODES.enumViolation,
        `${path}.status`,
        "Invalid value-state status.",
      ),
    ],
  };
}

function parseFreshness(
  value: unknown,
  path: string,
): { ok: true; value: HybridFreshnessIdentity } | { ok: false; issues: readonly HybridIssue[] } {
  const inspected = inspectClosedObject(value, ["actionFingerprint"], path);
  if (!inspected.ok) {
    return inspected;
  }
  const fingerprint = requireString(
    inspected.fields.get("actionFingerprint"),
    `${path}.actionFingerprint`,
    FC009_SAFETY_CAPS.maxFingerprintChars,
    FINGERPRINT_PATTERN,
  );
  if (!fingerprint.ok) {
    return fingerprint;
  }
  return { ok: true, value: { actionFingerprint: fingerprint.value } };
}

function parseAssumption(
  value: unknown,
  path: string,
): { ok: true; value: HybridAssumption } | { ok: false; issues: readonly HybridIssue[] } {
  const inspected = inspectClosedObject(value, ["id", "statement", "status"], path);
  if (!inspected.ok) {
    return inspected;
  }
  const id = requireString(
    inspected.fields.get("id"),
    `${path}.id`,
    FC009_SAFETY_CAPS.maxAssumptionIdChars,
    TOKEN_PATTERN,
  );
  const statement = requireString(
    inspected.fields.get("statement"),
    `${path}.statement`,
    FC009_SAFETY_CAPS.maxAssumptionStatementChars,
  );
  const status = inspected.fields.get("status");
  if (!id.ok) {
    return id;
  }
  if (!statement.ok) {
    return statement;
  }
  if (
    typeof status !== "string" ||
    !HYBRID_ASSUMPTION_STATUSES.includes(status as HybridAssumption["status"])
  ) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.enumViolation,
          `${path}.status`,
          "Invalid assumption status.",
        ),
      ],
    };
  }
  return {
    ok: true,
    value: {
      id: id.value,
      statement: statement.value,
      status: status as HybridAssumption["status"],
    },
  };
}

function parseVerifiedProvenance(
  value: unknown,
  path: string,
): { ok: true; value: HybridVerifiedProvenance } | { ok: false; issues: readonly HybridIssue[] } {
  const inspected = inspectClosedObject(value, ["source", "ruleId", "engineVersion"], path);
  if (!inspected.ok) {
    return inspected;
  }
  const source = inspected.fields.get("source");
  if (
    typeof source !== "string" ||
    !HYBRID_VERIFIED_SOURCES.includes(source as HybridVerifiedProvenance["source"])
  ) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.enumViolation,
          `${path}.source`,
          "Invalid verified provenance source.",
        ),
      ],
    };
  }
  const ruleId = inspected.fields.get("ruleId");
  const engineVersion = inspected.fields.get("engineVersion");
  if (ruleId !== null && typeof ruleId !== "string") {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.typeMismatch,
          `${path}.ruleId`,
          "ruleId must be a string or null.",
        ),
      ],
    };
  }
  if (engineVersion !== null && typeof engineVersion !== "string") {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.typeMismatch,
          `${path}.engineVersion`,
          "engineVersion must be a string or null.",
        ),
      ],
    };
  }
  if (typeof ruleId === "string") {
    const checked = requireString(
      ruleId,
      `${path}.ruleId`,
      FC009_SAFETY_CAPS.maxProvenanceTokenChars,
    );
    if (!checked.ok) {
      return checked;
    }
  }
  if (typeof engineVersion === "string") {
    const checked = requireString(
      engineVersion,
      `${path}.engineVersion`,
      FC009_SAFETY_CAPS.maxProvenanceTokenChars,
    );
    if (!checked.ok) {
      return checked;
    }
  }
  return {
    ok: true,
    value: {
      source: source as HybridVerifiedProvenance["source"],
      ruleId: typeof ruleId === "string" ? ruleId : null,
      engineVersion: typeof engineVersion === "string" ? engineVersion : null,
    },
  };
}

function parseVerifiedClaim(
  value: unknown,
  path: string,
): { ok: true; value: VerifiedClaimInput } | { ok: false; issues: readonly HybridIssue[] } {
  const inspected = inspectClosedObject(
    value,
    ["property", "before", "after", "scope", "assumptions", "provenance", "freshness"],
    path,
  );
  if (!inspected.ok) {
    return inspected;
  }
  const property = requireString(
    inspected.fields.get("property"),
    `${path}.property`,
    FC009_SAFETY_CAPS.maxPropertyChars,
  );
  if (!property.ok) {
    return property;
  }
  if (!isCanonicalProperty(property.value)) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.patternViolation,
          `${path}.property`,
          "Property is not a canonical semantic token.",
        ),
      ],
    };
  }
  const before = parseValueState(inspected.fields.get("before"), `${path}.before`);
  const after = parseValueState(inspected.fields.get("after"), `${path}.after`);
  const scope = parseOptionalScope(inspected.fields.get("scope"), `${path}.scope`);
  const assumptionsRaw = inspectDenseArray(
    inspected.fields.get("assumptions"),
    `${path}.assumptions`,
  );
  const provenance = parseVerifiedProvenance(
    inspected.fields.get("provenance"),
    `${path}.provenance`,
  );
  const freshness = parseFreshness(inspected.fields.get("freshness"), `${path}.freshness`);
  const issues: HybridIssue[] = [];
  if (!before.ok) {
    issues.push(...before.issues);
  }
  if (!after.ok) {
    issues.push(...after.issues);
  }
  if (!scope.ok) {
    issues.push(...scope.issues);
  }
  if (!assumptionsRaw.ok) {
    issues.push(...assumptionsRaw.issues);
  }
  if (!provenance.ok) {
    issues.push(...provenance.issues);
  }
  if (!freshness.ok) {
    issues.push(...freshness.issues);
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  if (
    !before.ok ||
    !after.ok ||
    !scope.ok ||
    !assumptionsRaw.ok ||
    !provenance.ok ||
    !freshness.ok
  ) {
    return { ok: false, issues };
  }
  if (assumptionsRaw.items.length > FC009_SAFETY_CAPS.maxAssumptionsPerClaim) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.boundExceeded,
          `${path}.assumptions`,
          `Assumptions exceed cap ${FC009_SAFETY_CAPS.maxAssumptionsPerClaim}.`,
        ),
      ],
    };
  }
  const assumptions: HybridAssumption[] = [];
  for (const [index, item] of assumptionsRaw.items.entries()) {
    const parsed = parseAssumption(item, `${path}.assumptions[${index}]`);
    if (!parsed.ok) {
      return parsed;
    }
    assumptions.push(parsed.value);
  }
  if (claimIdentityFromHybridValues(property.value, before.value, after.value) === null) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.invariantViolation,
          path,
          "State transition is not a canonical claim identity.",
        ),
      ],
    };
  }
  return {
    ok: true,
    value: {
      property: property.value,
      before: before.value,
      after: after.value,
      scope: scope.value,
      assumptions,
      provenance: provenance.value,
      freshness: freshness.value,
    },
  };
}

function parseClaimIdentity(
  value: unknown,
  path: string,
):
  | { ok: true; value: { property: string; before: string; after: string } }
  | { ok: false; issues: readonly HybridIssue[] } {
  const inspected = inspectClosedObject(value, ["property", "before", "after"], path);
  if (!inspected.ok) {
    return inspected;
  }
  const property = requireString(
    inspected.fields.get("property"),
    `${path}.property`,
    FC009_SAFETY_CAPS.maxPropertyChars,
  );
  const before = requireString(
    inspected.fields.get("before"),
    `${path}.before`,
    FC009_SAFETY_CAPS.maxValueChars,
    TOKEN_PATTERN,
  );
  const after = requireString(
    inspected.fields.get("after"),
    `${path}.after`,
    FC009_SAFETY_CAPS.maxValueChars,
    TOKEN_PATTERN,
  );
  if (!property.ok) {
    return property;
  }
  if (!before.ok) {
    return before;
  }
  if (!after.ok) {
    return after;
  }
  if (!isCanonicalProperty(property.value)) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.patternViolation,
          `${path}.property`,
          "Property is not a canonical semantic token.",
        ),
      ],
    };
  }
  return {
    ok: true,
    value: { property: property.value, before: before.value, after: after.value },
  };
}

function parsePredictedProvenance(
  value: unknown,
  path: string,
): { ok: true; value: HybridPredictedProvenance } | { ok: false; issues: readonly HybridIssue[] } {
  const inspected = inspectClosedObject(
    value,
    ["source", "modelFamily", "modelVersion", "artifactSha256", "supportMatrixVersion"],
    path,
  );
  if (!inspected.ok) {
    return inspected;
  }
  if (inspected.fields.get("source") !== "model") {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.enumViolation,
          `${path}.source`,
          'Predicted provenance source must be "model".',
        ),
      ],
    };
  }
  const modelFamily = requireString(
    inspected.fields.get("modelFamily"),
    `${path}.modelFamily`,
    FC009_SAFETY_CAPS.maxProvenanceTokenChars,
  );
  const modelVersion = requireString(
    inspected.fields.get("modelVersion"),
    `${path}.modelVersion`,
    FC009_SAFETY_CAPS.maxProvenanceTokenChars,
  );
  const artifactSha256 = requireString(
    inspected.fields.get("artifactSha256"),
    `${path}.artifactSha256`,
    64,
    SHA_PATTERN,
  );
  const supportMatrixVersion = requireString(
    inspected.fields.get("supportMatrixVersion"),
    `${path}.supportMatrixVersion`,
    FC009_SAFETY_CAPS.maxProvenanceTokenChars,
  );
  if (!modelFamily.ok) {
    return modelFamily;
  }
  if (!modelVersion.ok) {
    return modelVersion;
  }
  if (!artifactSha256.ok) {
    return artifactSha256;
  }
  if (!supportMatrixVersion.ok) {
    return supportMatrixVersion;
  }
  return {
    ok: true,
    value: {
      source: "model",
      modelFamily: modelFamily.value,
      modelVersion: modelVersion.value,
      artifactSha256: artifactSha256.value,
      supportMatrixVersion: supportMatrixVersion.value,
    },
  };
}

function parsePredictedSupport(
  value: unknown,
  path: string,
): { ok: true; value: HybridPredictedSupport } | { ok: false; issues: readonly HybridIssue[] } {
  const inspected = inspectClosedObject(
    value,
    ["supportedTupleResolved", "featureCoverage", "supportedObjectEvidence"],
    path,
  );
  if (!inspected.ok) {
    return inspected;
  }
  const supportedTupleResolved = inspected.fields.get("supportedTupleResolved");
  const supportedObjectEvidence = inspected.fields.get("supportedObjectEvidence");
  const featureCoverage = inspected.fields.get("featureCoverage");
  if (typeof supportedTupleResolved !== "boolean") {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.typeMismatch,
          `${path}.supportedTupleResolved`,
          "Expected a boolean.",
        ),
      ],
    };
  }
  if (typeof supportedObjectEvidence !== "boolean") {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.typeMismatch,
          `${path}.supportedObjectEvidence`,
          "Expected a boolean.",
        ),
      ],
    };
  }
  const coverage = requireConfidence(featureCoverage, `${path}.featureCoverage`);
  if (!coverage.ok) {
    return coverage;
  }
  return {
    ok: true,
    value: {
      supportedTupleResolved,
      featureCoverage: coverage.value,
      supportedObjectEvidence,
    },
  };
}

function parseAlternative(
  value: unknown,
  path: string,
): { ok: true; value: AdaptedAlternative } | { ok: false; issues: readonly HybridIssue[] } {
  const inspected = inspectClosedObject(value, ["identity", "calibratedConfidence", "role"], path);
  if (!inspected.ok) {
    return inspected;
  }
  if (inspected.fields.get("role") !== "uncertainty") {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.enumViolation,
          `${path}.role`,
          "Alternatives are uncertainty context, not asserted claims.",
        ),
      ],
    };
  }
  const identity = parseClaimIdentity(inspected.fields.get("identity"), `${path}.identity`);
  const confidence = requireConfidence(
    inspected.fields.get("calibratedConfidence"),
    `${path}.calibratedConfidence`,
  );
  if (!identity.ok) {
    return identity;
  }
  if (!confidence.ok) {
    return confidence;
  }
  return {
    ok: true,
    value: {
      identity: identity.value,
      calibratedConfidence: confidence.value,
      role: "uncertainty",
    },
  };
}

function parseNullableFreshness(
  value: unknown,
  path: string,
):
  | { ok: true; value: HybridFreshnessIdentity | null }
  | { ok: false; issues: readonly HybridIssue[] } {
  if (value === null) {
    return { ok: true, value: null };
  }
  return parseFreshness(value, path);
}

function parseNullableProvenance(
  value: unknown,
  path: string,
):
  | { ok: true; value: HybridPredictedProvenance | null }
  | { ok: false; issues: readonly HybridIssue[] } {
  if (value === null) {
    return { ok: true, value: null };
  }
  return parsePredictedProvenance(value, path);
}

function parseNullableSupport(
  value: unknown,
  path: string,
):
  | { ok: true; value: HybridPredictedSupport | null }
  | { ok: false; issues: readonly HybridIssue[] } {
  if (value === null) {
    return { ok: true, value: null };
  }
  return parsePredictedSupport(value, path);
}

export function parseAdaptedPrediction(
  value: unknown,
  path: string,
): { ok: true; value: AdaptedPrediction } | { ok: false; issues: readonly HybridIssue[] } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      issues: [
        hybridIssue(HYBRID_VALIDATION_CODES.notPlainObject, path, "Expected a plain object."),
      ],
    };
  }
  const status = Reflect.get(value, "status");
  if (status === "hypothesis") {
    const inspected = inspectClosedObject(
      value,
      [
        "status",
        "identity",
        "calibratedConfidence",
        "alternatives",
        "freshness",
        "provenance",
        "support",
      ],
      path,
    );
    if (!inspected.ok) {
      return inspected;
    }
    const identity = parseClaimIdentity(inspected.fields.get("identity"), `${path}.identity`);
    const confidence = requireConfidence(
      inspected.fields.get("calibratedConfidence"),
      `${path}.calibratedConfidence`,
    );
    const alternativesRaw = inspectDenseArray(
      inspected.fields.get("alternatives"),
      `${path}.alternatives`,
    );
    const freshness = parseFreshness(inspected.fields.get("freshness"), `${path}.freshness`);
    const provenance = parsePredictedProvenance(
      inspected.fields.get("provenance"),
      `${path}.provenance`,
    );
    const support = parsePredictedSupport(inspected.fields.get("support"), `${path}.support`);
    const issues: HybridIssue[] = [];
    if (!identity.ok) {
      issues.push(...identity.issues);
    }
    if (!confidence.ok) {
      issues.push(...confidence.issues);
    }
    if (!alternativesRaw.ok) {
      issues.push(...alternativesRaw.issues);
    }
    if (!freshness.ok) {
      issues.push(...freshness.issues);
    }
    if (!provenance.ok) {
      issues.push(...provenance.issues);
    }
    if (!support.ok) {
      issues.push(...support.issues);
    }
    if (issues.length > 0) {
      return { ok: false, issues };
    }
    if (
      !identity.ok ||
      !confidence.ok ||
      !alternativesRaw.ok ||
      !freshness.ok ||
      !provenance.ok ||
      !support.ok
    ) {
      return { ok: false, issues };
    }
    if (alternativesRaw.items.length > FC009_SAFETY_CAPS.maxPredictedAlternatives) {
      return {
        ok: false,
        issues: [
          hybridIssue(
            HYBRID_VALIDATION_CODES.boundExceeded,
            `${path}.alternatives`,
            `Alternatives exceed cap ${FC009_SAFETY_CAPS.maxPredictedAlternatives}.`,
          ),
        ],
      };
    }
    const alternatives: AdaptedAlternative[] = [];
    for (const [index, item] of alternativesRaw.items.entries()) {
      const parsed = parseAlternative(item, `${path}.alternatives[${index}]`);
      if (!parsed.ok) {
        return parsed;
      }
      alternatives.push(parsed.value);
    }
    return {
      ok: true,
      value: {
        status: "hypothesis",
        identity: identity.value,
        calibratedConfidence: confidence.value,
        alternatives,
        freshness: freshness.value,
        provenance: provenance.value,
        support: support.value,
      },
    };
  }
  if (status === "abstained") {
    const inspected = inspectClosedObject(
      value,
      ["status", "reason", "freshness", "provenance", "support"],
      path,
    );
    if (!inspected.ok) {
      return inspected;
    }
    const reason = inspected.fields.get("reason");
    if (typeof reason !== "string" || !EPISTEMIC_REASONS.has(reason)) {
      return {
        ok: false,
        issues: [
          hybridIssue(
            HYBRID_VALIDATION_CODES.enumViolation,
            `${path}.reason`,
            "Unknown epistemic abstention reason.",
          ),
        ],
      };
    }
    const freshness = parseNullableFreshness(
      inspected.fields.get("freshness"),
      `${path}.freshness`,
    );
    const provenance = parseNullableProvenance(
      inspected.fields.get("provenance"),
      `${path}.provenance`,
    );
    const support = parseNullableSupport(inspected.fields.get("support"), `${path}.support`);
    if (!freshness.ok) {
      return freshness;
    }
    if (!provenance.ok) {
      return provenance;
    }
    if (!support.ok) {
      return support;
    }
    return {
      ok: true,
      value: {
        status: "abstained",
        reason: reason as EpistemicAbstentionReason,
        freshness: freshness.value,
        provenance: provenance.value,
        support: support.value,
      },
    };
  }
  if (status === "failed") {
    const inspected = inspectClosedObject(
      value,
      ["status", "code", "stage", "failureReason"],
      path,
    );
    if (!inspected.ok) {
      return inspected;
    }
    const code = inspected.fields.get("code");
    if (typeof code !== "string" || !OPERATIONAL_CODES.has(code)) {
      return {
        ok: false,
        issues: [
          hybridIssue(
            HYBRID_VALIDATION_CODES.enumViolation,
            `${path}.code`,
            "Unknown operational failure code.",
          ),
        ],
      };
    }
    const stage = requireString(
      inspected.fields.get("stage"),
      `${path}.stage`,
      FC009_SAFETY_CAPS.maxProvenanceTokenChars,
    );
    const failureReason = requireString(
      inspected.fields.get("failureReason"),
      `${path}.failureReason`,
      FC009_SAFETY_CAPS.maxProvenanceTokenChars,
    );
    if (!stage.ok) {
      return stage;
    }
    if (!failureReason.ok) {
      return failureReason;
    }
    return {
      ok: true,
      value: {
        status: "failed",
        code: code as OperationalFailureCode,
        stage: stage.value,
        failureReason: failureReason.value,
      },
    };
  }
  return {
    ok: false,
    issues: [
      hybridIssue(
        HYBRID_VALIDATION_CODES.enumViolation,
        `${path}.status`,
        "Unknown prediction status.",
      ),
    ],
  };
}

export function parseHybridEvidenceInput(
  value: unknown,
): { ok: true; value: HybridEvidenceInput } | { ok: false; issues: readonly HybridIssue[] } {
  const inspected = inspectClosedObject(
    value,
    ["schemaVersion", "policyVersion", "identity", "verifiedClaims", "prediction"],
    "",
  );
  if (!inspected.ok) {
    return inspected;
  }
  if (inspected.fields.get("schemaVersion") !== FC009_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.enumViolation,
          "schemaVersion",
          "Unsupported schema version.",
        ),
      ],
    };
  }
  if (inspected.fields.get("policyVersion") !== FC009_HYBRID_POLICY_VERSION) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.enumViolation,
          "policyVersion",
          "Unsupported hybrid policy version.",
        ),
      ],
    };
  }
  const identity = parseFreshness(inspected.fields.get("identity"), "identity");
  if (!identity.ok) {
    return identity;
  }
  const claimsRaw = inspectDenseArray(inspected.fields.get("verifiedClaims"), "verifiedClaims");
  if (!claimsRaw.ok) {
    return claimsRaw;
  }
  if (claimsRaw.items.length > FC009_SAFETY_CAPS.maxVerifiedClaims) {
    return {
      ok: false,
      issues: [
        hybridIssue(
          HYBRID_VALIDATION_CODES.boundExceeded,
          "verifiedClaims",
          `Verified claims exceed cap ${FC009_SAFETY_CAPS.maxVerifiedClaims}.`,
        ),
      ],
    };
  }
  const verifiedClaims: VerifiedClaimInput[] = [];
  for (const [index, item] of claimsRaw.items.entries()) {
    const parsed = parseVerifiedClaim(item, `verifiedClaims[${index}]`);
    if (!parsed.ok) {
      return parsed;
    }
    verifiedClaims.push(parsed.value);
  }
  const predictionRaw = inspected.fields.get("prediction");
  if (predictionRaw === null) {
    return {
      ok: true,
      value: {
        schemaVersion: FC009_SCHEMA_VERSION,
        policyVersion: FC009_HYBRID_POLICY_VERSION,
        identity: identity.value,
        verifiedClaims,
        prediction: null,
      },
    };
  }
  const prediction = parseAdaptedPrediction(predictionRaw, "prediction");
  if (!prediction.ok) {
    return prediction;
  }
  return {
    ok: true,
    value: {
      schemaVersion: FC009_SCHEMA_VERSION,
      policyVersion: FC009_HYBRID_POLICY_VERSION,
      identity: identity.value,
      verifiedClaims,
      prediction: prediction.value,
    },
  };
}
