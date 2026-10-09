/**
 * Deterministic hybrid composition of VERIFIED and PREDICTED evidence.
 *
 * No randomness, clock, network, or LLM. No fused confidence. No execution.
 */

import type {
  EpistemicAbstentionReason,
  OperationalFailureCode,
} from "@futureclick/action-understanding";
import { FC009_SAFETY_CAPS } from "./caps.js";
import { deepFreeze } from "./freeze.js";
import {
  claimIdentityFromHybridValues,
  claimIdentityKey,
  identitiesEqual,
  identityIsComparable,
} from "./identity.js";
import {
  FC009_EPISTEMIC_PRECEDENCE,
  FC009_EXECUTION_AUTHORITY,
  FC009_HYBRID_POLICY_VERSION,
  FC009_SCHEMA_VERSION,
} from "./policy.js";
import type { HybridReasonCode } from "./reasons.js";
import { HYBRID_VALIDATION_CODES, type HybridIssue, hybridIssue } from "./reasons.js";
import type {
  AdaptedAlternative,
  AdaptedPrediction,
  CanonicalClaimIdentity,
  HybridAuthoritativeBasis,
  HybridClaim,
  HybridClaimEndpoint,
  HybridCompositionOutcome,
  HybridEvidenceInput,
  HybridEvidenceMode,
  HybridPredictedProvenance,
  HybridPredictedSupport,
  HybridPredictionStatus,
  HybridRelationship,
  HybridRelationshipRecord,
  HybridVerifiedProvenance,
  VerifiedClaimInput,
} from "./types.js";
import { parseHybridEvidenceInput } from "./validation.js";

function copyIdentity(identity: CanonicalClaimIdentity): CanonicalClaimIdentity {
  return {
    property: identity.property,
    before: identity.before,
    after: identity.after,
  };
}

function compareIdentity(a: CanonicalClaimIdentity, b: CanonicalClaimIdentity): number {
  const left = claimIdentityKey(a);
  const right = claimIdentityKey(b);
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function endpointKey(endpoint: HybridClaimEndpoint | null): string {
  if (endpoint === null) {
    return "";
  }
  return `${endpoint.evidenceMode}|${claimIdentityKey(endpoint.identity)}`;
}

function compareRelationships(a: HybridRelationshipRecord, b: HybridRelationshipRecord): number {
  if (a.kind < b.kind) {
    return -1;
  }
  if (a.kind > b.kind) {
    return 1;
  }
  const aLeft = endpointKey(a.leftClaim);
  const bLeft = endpointKey(b.leftClaim);
  if (aLeft < bLeft) {
    return -1;
  }
  if (aLeft > bLeft) {
    return 1;
  }
  const aRight = endpointKey(a.rightClaim);
  const bRight = endpointKey(b.rightClaim);
  if (aRight < bRight) {
    return -1;
  }
  if (aRight > bRight) {
    return 1;
  }
  return 0;
}

function classifyIdentities(
  left: CanonicalClaimIdentity,
  right: CanonicalClaimIdentity,
): HybridRelationship {
  if (left.property !== right.property) {
    return "INCOMPARABLE";
  }
  if (!identityIsComparable(left) || !identityIsComparable(right)) {
    return "INCOMPARABLE";
  }
  if (identitiesEqual(left, right)) {
    return "AGREES";
  }
  return "CONFLICTS";
}

function makeEndpoint(
  evidenceMode: HybridEvidenceMode,
  identity: CanonicalClaimIdentity,
): HybridClaimEndpoint {
  return {
    evidenceMode,
    identity: copyIdentity(identity),
  };
}

function orderEndpoints(
  left: HybridClaimEndpoint,
  right: HybridClaimEndpoint,
): readonly [HybridClaimEndpoint, HybridClaimEndpoint] {
  if (left.evidenceMode !== right.evidenceMode) {
    return left.evidenceMode === "verified" ? [left, right] : [right, left];
  }
  return compareIdentity(left.identity, right.identity) <= 0 ? [left, right] : [right, left];
}

function pairRelationship(
  kind: HybridRelationship,
  left: HybridClaimEndpoint,
  right: HybridClaimEndpoint,
): HybridRelationshipRecord {
  const [first, second] = orderEndpoints(left, right);
  return { kind, leftClaim: first, rightClaim: second };
}

function unaryRelationship(
  kind: HybridRelationship,
  claim: HybridClaimEndpoint,
): HybridRelationshipRecord {
  return { kind, leftClaim: claim, rightClaim: null };
}

function statusRelationship(kind: HybridRelationship): HybridRelationshipRecord {
  return { kind, leftClaim: null, rightClaim: null };
}

function provenanceSortKey(provenance: HybridVerifiedProvenance): string {
  return `${provenance.source}|${provenance.ruleId ?? ""}|${provenance.engineVersion ?? ""}`;
}

function fail(reason: HybridReasonCode, issues: readonly HybridIssue[]): HybridCompositionOutcome {
  return { ok: false, reason, issues };
}

function verifiedClaim(input: VerifiedClaimInput, identity: CanonicalClaimIdentity): HybridClaim {
  return {
    evidenceMode: "verified",
    identity: copyIdentity(identity),
    confidence: null,
    scope: input.scope,
    assumptions: input.assumptions.map((item) => ({
      id: item.id,
      statement: item.statement,
      status: item.status,
    })),
    provenance: {
      source: input.provenance.source,
      ruleId: input.provenance.ruleId,
      engineVersion: input.provenance.engineVersion,
    },
    freshness: { actionFingerprint: input.freshness.actionFingerprint },
    current: true,
  };
}

function predictedClaim(
  prediction: Extract<AdaptedPrediction, { status: "hypothesis" }>,
): HybridClaim {
  return {
    evidenceMode: "predicted",
    identity: copyIdentity(prediction.identity),
    confidence: prediction.calibratedConfidence,
    scope: null,
    assumptions: [],
    provenance: {
      source: "model",
      modelFamily: prediction.provenance.modelFamily,
      modelVersion: prediction.provenance.modelVersion,
      artifactSha256: prediction.provenance.artifactSha256,
      supportMatrixVersion: prediction.provenance.supportMatrixVersion,
    },
    freshness: { actionFingerprint: prediction.freshness.actionFingerprint },
    current: true,
  };
}

function copyPredictedProvenance(source: HybridPredictedProvenance): HybridPredictedProvenance {
  return {
    source: "model",
    modelFamily: source.modelFamily,
    modelVersion: source.modelVersion,
    artifactSha256: source.artifactSha256,
    supportMatrixVersion: source.supportMatrixVersion,
  };
}

function copyPredictedSupport(source: HybridPredictedSupport): HybridPredictedSupport {
  return {
    supportedTupleResolved: source.supportedTupleResolved,
    featureCoverage: source.featureCoverage,
    supportedObjectEvidence: source.supportedObjectEvidence,
  };
}

function composeValidated(input: HybridEvidenceInput): HybridCompositionOutcome {
  const verified: { input: VerifiedClaimInput; identity: CanonicalClaimIdentity }[] = [];
  for (const [index, claim] of input.verifiedClaims.entries()) {
    if (claim.freshness.actionFingerprint !== input.identity.actionFingerprint) {
      return fail("HYBRID_IDENTITY_MISMATCH", [
        hybridIssue(
          HYBRID_VALIDATION_CODES.invariantViolation,
          `verifiedClaims[${index}].freshness.actionFingerprint`,
          "Verified claim fingerprint does not match the current action identity.",
        ),
      ]);
    }
    const identity = claimIdentityFromHybridValues(claim.property, claim.before, claim.after);
    if (identity === null) {
      return fail("HYBRID_INPUT_INVALID", [
        hybridIssue(
          HYBRID_VALIDATION_CODES.invariantViolation,
          `verifiedClaims[${index}]`,
          "Malformed verified state transition.",
        ),
      ]);
    }
    verified.push({ input: claim, identity });
  }

  verified.sort((left, right) => {
    const identityOrder = compareIdentity(left.identity, right.identity);
    if (identityOrder !== 0) {
      return identityOrder;
    }
    const provenanceOrder = provenanceSortKey(left.input.provenance).localeCompare(
      provenanceSortKey(right.input.provenance),
    );
    if (provenanceOrder !== 0) {
      return provenanceOrder;
    }
    return (left.input.scope ?? "").localeCompare(right.input.scope ?? "");
  });

  const uniqueVerified: { input: VerifiedClaimInput; identity: CanonicalClaimIdentity }[] = [];
  const seenIdentities = new Set<string>();
  for (const item of verified) {
    const key = claimIdentityKey(item.identity);
    if (seenIdentities.has(key)) {
      continue;
    }
    seenIdentities.add(key);
    uniqueVerified.push(item);
  }

  const claims: HybridClaim[] = uniqueVerified.map((item) =>
    verifiedClaim(item.input, item.identity),
  );
  const relationships: HybridRelationshipRecord[] = [];

  let predictionStatus: HybridPredictionStatus = "absent";
  let abstentionReason: EpistemicAbstentionReason | null = null;
  let failureCode: OperationalFailureCode | null = null;
  let failureStage: string | null = null;
  let failureReason: string | null = null;
  let copiedAlternatives: AdaptedAlternative[] = [];
  let resultReason: HybridReasonCode | null = null;
  let usablePrediction: Extract<AdaptedPrediction, { status: "hypothesis" }> | null = null;
  let predictionProvenance: HybridPredictedProvenance | null = null;
  let predictionSupport: HybridPredictedSupport | null = null;

  const prediction = input.prediction;
  if (prediction === null) {
    predictionStatus = "absent";
  } else if (prediction.status === "failed") {
    predictionStatus = "failed";
    failureCode = prediction.code;
    failureStage = prediction.stage;
    failureReason = prediction.failureReason;
    relationships.push(statusRelationship("PREDICTION_FAILED"));
  } else if (prediction.status === "abstained") {
    abstentionReason = prediction.reason;
    predictionProvenance =
      prediction.provenance === null ? null : copyPredictedProvenance(prediction.provenance);
    predictionSupport =
      prediction.support === null ? null : copyPredictedSupport(prediction.support);
    if (
      prediction.freshness !== null &&
      prediction.freshness.actionFingerprint !== input.identity.actionFingerprint
    ) {
      predictionStatus = "stale";
      resultReason = "HYBRID_PREDICTION_STALE";
      relationships.push(statusRelationship("PREDICTION_STALE"));
    } else {
      predictionStatus = "abstained";
      relationships.push(statusRelationship("ABSTAINED_PREDICTION"));
    }
  } else if (prediction.freshness.actionFingerprint !== input.identity.actionFingerprint) {
    predictionStatus = "stale";
    resultReason = "HYBRID_PREDICTION_STALE";
    predictionProvenance = copyPredictedProvenance(prediction.provenance);
    predictionSupport = copyPredictedSupport(prediction.support);
    relationships.push(statusRelationship("PREDICTION_STALE"));
  } else if (prediction.alternatives.length > FC009_SAFETY_CAPS.maxPredictedAlternatives) {
    return fail("HYBRID_CAP_EXCEEDED", [
      hybridIssue(
        HYBRID_VALIDATION_CODES.boundExceeded,
        "prediction.alternatives",
        `Alternatives exceed cap ${FC009_SAFETY_CAPS.maxPredictedAlternatives}.`,
      ),
    ]);
  } else {
    usablePrediction = prediction;
    predictionStatus = "hypothesis";
    predictionProvenance = copyPredictedProvenance(prediction.provenance);
    predictionSupport = copyPredictedSupport(prediction.support);
    copiedAlternatives = prediction.alternatives.map((item) => ({
      identity: copyIdentity(item.identity),
      calibratedConfidence: item.calibratedConfidence,
      role: "uncertainty" as const,
    }));
    claims.push(predictedClaim(prediction));
  }

  const conflictingVerified = new Set<string>();
  for (let i = 0; i < uniqueVerified.length; i += 1) {
    const left = uniqueVerified[i];
    if (left === undefined) {
      continue;
    }
    for (let j = i + 1; j < uniqueVerified.length; j += 1) {
      const right = uniqueVerified[j];
      if (right === undefined) {
        continue;
      }
      if (left.identity.property !== right.identity.property) {
        continue;
      }
      const classified = classifyIdentities(left.identity, right.identity);
      if (classified === "CONFLICTS") {
        conflictingVerified.add(claimIdentityKey(left.identity));
        conflictingVerified.add(claimIdentityKey(right.identity));
        relationships.push(
          pairRelationship(
            "VERIFIED_CONFLICT",
            makeEndpoint("verified", left.identity),
            makeEndpoint("verified", right.identity),
          ),
        );
      } else if (classified === "INCOMPARABLE") {
        relationships.push(
          pairRelationship(
            "INCOMPARABLE",
            makeEndpoint("verified", left.identity),
            makeEndpoint("verified", right.identity),
          ),
        );
      }
    }
  }

  if (usablePrediction === null) {
    for (const item of uniqueVerified) {
      if (conflictingVerified.has(claimIdentityKey(item.identity))) {
        continue;
      }
      relationships.push(
        unaryRelationship("VERIFIED_ONLY", makeEndpoint("verified", item.identity)),
      );
    }
  } else if (uniqueVerified.length === 0) {
    relationships.push(
      unaryRelationship("PREDICTION_ONLY", makeEndpoint("predicted", usablePrediction.identity)),
    );
  } else {
    for (const item of uniqueVerified) {
      const kind = classifyIdentities(item.identity, usablePrediction.identity);
      relationships.push(
        pairRelationship(
          kind,
          makeEndpoint("verified", item.identity),
          makeEndpoint("predicted", usablePrediction.identity),
        ),
      );
    }
  }

  let authoritativeBasis: HybridAuthoritativeBasis = "none";
  if (conflictingVerified.size > 0) {
    authoritativeBasis = "verified-conflict";
    resultReason = "HYBRID_VERIFIED_CONFLICT";
  } else if (uniqueVerified.length > 0) {
    authoritativeBasis = "verified";
  }

  relationships.sort(compareRelationships);
  claims.sort((left, right) => {
    if (left.evidenceMode !== right.evidenceMode) {
      return left.evidenceMode === "verified" ? -1 : 1;
    }
    return compareIdentity(left.identity, right.identity);
  });

  return {
    ok: true,
    result: deepFreeze({
      schemaVersion: FC009_SCHEMA_VERSION,
      policyVersion: FC009_HYBRID_POLICY_VERSION,
      identity: { actionFingerprint: input.identity.actionFingerprint },
      claims,
      relationships,
      alternatives: copiedAlternatives,
      predictionStatus,
      predictionAbstentionReason: abstentionReason,
      predictionFailureCode: failureCode,
      predictionFailureStage: failureStage,
      predictionFailureReason: failureReason,
      predictionProvenance,
      predictionSupport,
      authoritativeBasis,
      epistemicPrecedence: FC009_EPISTEMIC_PRECEDENCE,
      executionAuthority: FC009_EXECUTION_AUTHORITY,
      reason: resultReason,
    }),
  };
}

/**
 * Compose VERIFIED and PREDICTED evidence into one immutable hybrid view.
 *
 * The result is evidence only. It never authorizes execution.
 */
export function composeHybridEvidence(input: unknown): HybridCompositionOutcome {
  const parsed = parseHybridEvidenceInput(input);
  if (!parsed.ok) {
    const cap = parsed.issues.some((issue) => issue.code === HYBRID_VALIDATION_CODES.boundExceeded);
    return fail(cap ? "HYBRID_CAP_EXCEEDED" : "HYBRID_INPUT_INVALID", parsed.issues);
  }
  return composeValidated(parsed.value);
}
