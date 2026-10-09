import {
  type Consequence,
  type StateChange,
  createConfidenceScore,
} from "@futureclick/action-schema";
import {
  type ActionHypothesis,
  FC008_FEATURE_POLICY_VERSION,
  FC008_SUPPORT_MATRIX,
  FC008_SUPPORT_MATRIX_VERSION,
  type UnderstandingResult,
  createAbstainedResult,
  createFailedResult,
  createFailureDetail,
  createHypothesisResult,
  validateActionHypothesis,
} from "@futureclick/action-understanding";
import {
  FC009_HYBRID_POLICY_VERSION,
  FC009_SCHEMA_VERSION,
  type HybridEvidenceInput,
  type VerifiedClaimInput,
} from "../src/index.js";

export const ACTION_FP = "FP1|L2:fixture";
export const OTHER_FP = "FP2|L2:other";
export const TEST_SHA256 = "a".repeat(64);

export const VISIBILITY_SCOPE =
  "Derives the represented post-state from known canonical pre-state and explicit requested action parameters. Assumes the declared repository visibility change action executes successfully according to the modeled platform semantics without platform rejection.";

export function known(value: string): { readonly status: "known"; readonly value: string } {
  return { status: "known", value };
}

export function unknownState(): { readonly status: "unknown" } {
  return { status: "unknown" };
}

export function verifiedVisibility(
  overrides: Partial<VerifiedClaimInput> = {},
): VerifiedClaimInput {
  return {
    property: "repository.visibility",
    before: known("private"),
    after: known("public"),
    scope: VISIBILITY_SCOPE,
    assumptions: [
      {
        id: "asm.vcs.visibility.1",
        statement:
          "The remote version control platform processes the visibility change successfully under modeled semantics.",
        status: "assumed",
      },
    ],
    provenance: {
      source: "rule",
      ruleId: "vcs.repository.visibility.private-to-public",
      engineVersion: "consequence-engine-1.0",
    },
    freshness: { actionFingerprint: ACTION_FP },
    ...overrides,
  };
}

export function verifiedExistence(): VerifiedClaimInput {
  return {
    property: "file.existence",
    before: known("present"),
    after: known("absent"),
    scope: "Deterministic delete under the modeled filesystem contract.",
    assumptions: [
      {
        id: "asm.fs.delete.1",
        statement: "The modeled delete succeeds without platform rejection.",
        status: "assumed",
      },
    ],
    provenance: {
      source: "rule",
      ruleId: "fs.file.delete.present-to-absent",
      engineVersion: "consequence-engine-1.0",
    },
    freshness: { actionFingerprint: ACTION_FP },
  };
}

export function hybridInput(overrides: Partial<HybridEvidenceInput> = {}): Record<string, unknown> {
  return {
    schemaVersion: FC009_SCHEMA_VERSION,
    policyVersion: FC009_HYBRID_POLICY_VERSION,
    identity: { actionFingerprint: ACTION_FP },
    verifiedClaims: [],
    prediction: null,
    ...overrides,
  };
}

function matrixEntry(index: number) {
  const entry = FC008_SUPPORT_MATRIX[index];
  if (entry === undefined) {
    throw new Error(`support matrix index ${index} is out of range`);
  }
  return entry;
}

export function buildHypothesisInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const entry = matrixEntry(7);
  return {
    schemaVersion: "1.0",
    id: "hyp-0001",
    evidenceMode: "predicted",
    observationId: "obs-0001",
    inputFingerprint: ACTION_FP,
    freshness: {
      epoch: 1,
      observationSequence: 1,
      capturedAt: "2026-10-04T05:00:00.000Z",
      featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
      supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
      abstentionPolicyVersion: "fc008-test-policy-1",
    },
    actor: { kind: "human" },
    tuple: structuredClone(entry.tuple),
    alternatives: [],
    confidence: {
      calibratedConfidence: 0.91,
      calibrationMethod: "temperature-scaling",
      calibrationArtifactVersion: "cal-1",
    },
    support: {
      requiredFeatureGroupsPresent: 6,
      requiredFeatureGroupsTotal: 6,
      featureCoverage: 1,
      unknownTokenRatio: 0,
      unknownTokenRatioAvailable: false,
      unknownCategoricalCount: 0,
      supportedObjectEvidence: true,
      minimumSemanticEvidence: true,
      supportedTupleResolved: true,
      schemaVersionsMatched: true,
    },
    provenance: {
      source: "model",
      modelFamily: "joint-logistic",
      modelVersion: "m-1",
      artifactSha256: TEST_SHA256,
      supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
      featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
      abstentionPolicyVersion: "fc008-test-policy-1",
      inferenceTimestamp: "2026-10-04T05:00:00.000Z",
    },
    ...overrides,
  };
}

export function validHypothesis(overrides: Record<string, unknown> = {}): ActionHypothesis {
  const result = validateActionHypothesis(buildHypothesisInput(overrides));
  if (!result.valid) {
    throw new Error(`fixture hypothesis invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

export function hypothesisResult(overrides: Record<string, unknown> = {}): UnderstandingResult {
  return createHypothesisResult(validHypothesis(overrides));
}

export function abstainedResult(reason: "LOW_CONFIDENCE" = "LOW_CONFIDENCE"): UnderstandingResult {
  return createAbstainedResult({
    reason,
    observationId: "obs-0001" as never,
    inputFingerprint: ACTION_FP,
  });
}

export function failedResult(
  code: "MODEL_UNAVAILABLE" | "MODEL_TIMEOUT" | "INTERNAL_ERROR" | "MODEL_VERSION_MISMATCH",
): UnderstandingResult {
  return createFailedResult(
    code,
    "obs-0001" as never,
    createFailureDetail("provider", "provider-unavailable"),
  );
}

/**
 * Exact StateChange emitted by the committed FC-004 visibility rule.
 * Adapted as data only — the release path is not executed.
 */
export function visibilityRuleStateChange(): StateChange {
  return {
    entityId: "ent.repo.1" as never,
    property: "repository.visibility",
    operation: "replace",
    before: { status: "known", value: "private" },
    after: { status: "known", value: "public" },
  };
}

export function visibilityRuleConsequence(): Consequence {
  return {
    schemaVersion: "1.0",
    id: "conseq.visibility.1" as never,
    actionId: "act.visibility.1" as never,
    kind: "security",
    summary: 'Repository "demo" visibility will change from private to public.',
    affectedEntities: ["ent.repo.1" as never],
    stateChanges: [visibilityRuleStateChange()],
    evidence: [
      {
        id: "ev.visibility.1" as never,
        mode: "verified",
        source: "rule",
        observedAt: "2026-10-04T05:00:00.000Z" as never,
        scope: VISIBILITY_SCOPE,
        assumptions: [
          {
            id: "asm.vcs.visibility.1",
            statement:
              "The remote version control platform processes the visibility change successfully under modeled semantics.",
            status: "assumed",
          },
        ],
        summary:
          "Deterministic derivation of repository private-to-public visibility transition and associated data exposure risk.",
      },
    ],
    confidence: createConfidenceScore(1),
    reversibility: {
      level: "partially_reversible",
      method: "Change repository visibility back to private",
    },
    risk: {
      severity: "high",
      categories: ["security", "privacy"],
    },
    provenance: {
      source: "rule",
      ruleId: "vcs.repository.visibility.private-to-public",
      engineVersion: "consequence-engine-1.0",
      timestamp: "2026-10-04T05:00:00.000Z" as never,
    },
  };
}

export const PRIVATE_OBJECT_SUMMARY =
  'Repository "acme-secret-ledger" visibility will change from private to public.';

export function visibilityConsequenceWithoutEvidenceScope(): Consequence {
  const base = visibilityRuleConsequence();
  return {
    ...base,
    summary: PRIVATE_OBJECT_SUMMARY,
    evidence: [],
  };
}
