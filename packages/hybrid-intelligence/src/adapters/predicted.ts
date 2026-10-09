/**
 * Narrow FC-008 → FC-009 predicted-evidence adapter.
 *
 * Preserves PREDICTED mode, tuple semantics, confidence, alternatives,
 * freshness, and model provenance. Manufactures no claim from abstention
 * or operational failure. Exposes no execution method.
 */

import type { UnderstandingResult } from "@futureclick/action-understanding";
import { deepFreeze } from "../freeze.js";
import { claimIdentityFromTuple } from "../identity.js";
import type { AdaptedAlternative, AdaptedPrediction, HybridPredictedProvenance } from "../types.js";

function copyProvenance(source: {
  readonly source: "model";
  readonly modelFamily: string;
  readonly modelVersion: string;
  readonly artifactSha256: string;
  readonly supportMatrixVersion: string;
}): HybridPredictedProvenance {
  return {
    source: "model",
    modelFamily: source.modelFamily,
    modelVersion: source.modelVersion,
    artifactSha256: source.artifactSha256,
    supportMatrixVersion: source.supportMatrixVersion,
  };
}

function operationalInternalError(): AdaptedPrediction {
  return deepFreeze({
    status: "failed" as const,
    code: "INTERNAL_ERROR" as const,
    stage: "hypothesis-construction",
    failureReason: "unhandled-exception",
  });
}

export function adaptPredictedEvidence(result: UnderstandingResult): AdaptedPrediction {
  if (result.outcome === "failed") {
    return deepFreeze({
      status: "failed" as const,
      code: result.code,
      stage: result.detail.stage,
      failureReason: result.detail.reason,
    });
  }

  if (result.outcome === "abstained") {
    return deepFreeze({
      status: "abstained" as const,
      reason: result.reason,
      freshness:
        result.inputFingerprint === null ? null : { actionFingerprint: result.inputFingerprint },
      provenance: result.provenance === null ? null : copyProvenance(result.provenance),
      support:
        result.support === null
          ? null
          : {
              supportedTupleResolved: result.support.supportedTupleResolved,
              featureCoverage: result.support.featureCoverage,
              supportedObjectEvidence: result.support.supportedObjectEvidence,
            },
    });
  }

  const identity = claimIdentityFromTuple(result.hypothesis.tuple);
  if (identity === null) {
    return operationalInternalError();
  }

  const alternatives: AdaptedAlternative[] = [];
  for (const alternative of result.hypothesis.alternatives) {
    const altIdentity = claimIdentityFromTuple(alternative.tuple);
    if (altIdentity === null) {
      return operationalInternalError();
    }
    alternatives.push({
      identity: altIdentity,
      calibratedConfidence: alternative.calibratedConfidence,
      role: "uncertainty",
    });
  }

  return deepFreeze({
    status: "hypothesis" as const,
    identity,
    calibratedConfidence: result.hypothesis.confidence.calibratedConfidence,
    alternatives,
    freshness: { actionFingerprint: result.hypothesis.inputFingerprint },
    provenance: copyProvenance(result.hypothesis.provenance),
    support: {
      supportedTupleResolved: result.hypothesis.support.supportedTupleResolved,
      featureCoverage: result.hypothesis.support.featureCoverage,
      supportedObjectEvidence: result.hypothesis.support.supportedObjectEvidence,
    },
  });
}
