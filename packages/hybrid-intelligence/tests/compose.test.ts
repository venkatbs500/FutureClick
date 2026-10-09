import { FC008_SUPPORT_MATRIX } from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import {
  FC009_HYBRID_POLICY_VERSION,
  FC009_SAFETY_CAPS,
  adaptPredictedEvidence,
  composeHybridEvidence,
} from "../src/index.js";
import {
  ACTION_FP,
  OTHER_FP,
  TEST_SHA256,
  VISIBILITY_SCOPE,
  failedResult,
  hybridInput,
  hypothesisResult,
  known,
  unknownState,
  verifiedExistence,
  verifiedVisibility,
} from "./helpers.js";

function requireSuccess(input: unknown) {
  const outcome = composeHybridEvidence(input);
  if (!outcome.ok) {
    throw new Error(`expected success, got ${outcome.reason}: ${JSON.stringify(outcome.issues)}`);
  }
  return outcome.result;
}

function predictedHypothesis(overrides: Record<string, unknown> = {}) {
  return adaptPredictedEvidence(hypothesisResult(overrides));
}

function predictedWithIdentity(
  identity: { property: string; before: string; after: string },
  calibratedConfidence = 0.91,
) {
  const base = predictedHypothesis();
  if (base.status !== "hypothesis") {
    throw new Error("expected hypothesis fixture");
  }
  return {
    ...base,
    identity,
    calibratedConfidence,
  };
}

describe("FC-009 hybrid composition", () => {
  it("1. retains a VERIFIED-only claim without inventing confidence", () => {
    const result = requireSuccess(
      hybridInput({ verifiedClaims: [verifiedVisibility()], prediction: null }),
    );
    expect(result.predictionStatus).toBe("absent");
    expect(result.relationships.map((item) => item.kind)).toEqual(["VERIFIED_ONLY"]);
    expect(result.claims).toHaveLength(1);
    const claim = result.claims[0];
    expect(claim?.evidenceMode).toBe("verified");
    expect(claim?.confidence).toBeNull();
    expect(result.authoritativeBasis).toBe("verified");
    expect(result.executionAuthority).toBe("none");
  });

  it("2. retains a PREDICTED-only claim as predicted", () => {
    const result = requireSuccess(hybridInput({ prediction: predictedHypothesis() }));
    expect(result.relationships.map((item) => item.kind)).toEqual(["PREDICTION_ONLY"]);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.evidenceMode).toBe("predicted");
    expect(result.claims[0]?.confidence).toBe(0.91);
    expect(result.authoritativeBasis).toBe("none");
  });

  it("3. classifies exact VERIFIED/PREDICTED agreement without promotion", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility()],
        prediction: predictedHypothesis(),
      }),
    );
    expect(result.relationships.map((item) => item.kind)).toEqual(["AGREES"]);
    const modes = result.claims.map((claim) => claim.evidenceMode);
    expect(modes).toEqual(["verified", "predicted"]);
    expect(result.claims.find((claim) => claim.evidenceMode === "predicted")?.evidenceMode).toBe(
      "predicted",
    );
    expect(result.authoritativeBasis).toBe("verified");
    expect(JSON.stringify(result)).not.toMatch(/more verified|AI-confirmed|verified with/i);
  });

  it("4. surfaces a direct VERIFIED/PREDICTED conflict without overwriting either claim", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [
          verifiedVisibility({
            before: known("private"),
            after: known("private"),
          }),
        ],
        prediction: predictedHypothesis(),
      }),
    );
    expect(result.relationships.map((item) => item.kind)).toEqual(["CONFLICTS"]);
    expect(result.claims).toHaveLength(2);
    expect(result.claims.some((claim) => claim.evidenceMode === "verified")).toBe(true);
    expect(result.claims.some((claim) => claim.evidenceMode === "predicted")).toBe(true);
    expect(result.authoritativeBasis).toBe("verified");
  });

  it("5. classifies different semantic properties as INCOMPARABLE", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedExistence()],
        prediction: predictedHypothesis(),
      }),
    );
    expect(result.relationships.map((item) => item.kind)).toEqual(["INCOMPARABLE"]);
    expect(result.claims).toHaveLength(2);
  });

  it("6. preserves an abstained prediction without manufacturing a claim", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility()],
        prediction: adaptPredictedEvidence({
          outcome: "abstained",
          reason: "LOW_CONFIDENCE",
          observationId: null,
          inputFingerprint: ACTION_FP,
          support: null,
          provenance: null,
          diagnostics: null,
        }),
      }),
    );
    expect(result.predictionStatus).toBe("abstained");
    expect(result.predictionAbstentionReason).toBe("LOW_CONFIDENCE");
    expect(result.relationships.map((item) => item.kind).sort()).toEqual([
      "ABSTAINED_PREDICTION",
      "VERIFIED_ONLY",
    ]);
    expect(result.claims.every((claim) => claim.evidenceMode === "verified")).toBe(true);
  });

  it("7. preserves MODEL_UNAVAILABLE as operational failure", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility()],
        prediction: adaptPredictedEvidence(failedResult("MODEL_UNAVAILABLE")),
      }),
    );
    expect(result.predictionStatus).toBe("failed");
    expect(result.predictionFailureCode).toBe("MODEL_UNAVAILABLE");
    expect(result.relationships.map((item) => item.kind)).toContain("PREDICTION_FAILED");
    expect(result.claims.every((claim) => claim.evidenceMode === "verified")).toBe(true);
  });

  it("8. preserves MODEL_TIMEOUT as operational failure", () => {
    const result = requireSuccess(
      hybridInput({ prediction: adaptPredictedEvidence(failedResult("MODEL_TIMEOUT")) }),
    );
    expect(result.predictionFailureCode).toBe("MODEL_TIMEOUT");
    expect(result.relationships.map((item) => item.kind)).toEqual(["PREDICTION_FAILED"]);
  });

  it("9. preserves INTERNAL_ERROR as operational failure", () => {
    const result = requireSuccess(
      hybridInput({ prediction: adaptPredictedEvidence(failedResult("INTERNAL_ERROR")) }),
    );
    expect(result.predictionFailureCode).toBe("INTERNAL_ERROR");
    expect(result.predictionStatus).toBe("failed");
  });

  it("10. keeps current VERIFIED evidence and marks a stale prediction unavailable", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility()],
        prediction: predictedHypothesis({ inputFingerprint: OTHER_FP }),
      }),
    );
    expect(result.predictionStatus).toBe("stale");
    expect(result.reason).toBe("HYBRID_PREDICTION_STALE");
    expect(result.relationships.map((item) => item.kind).sort()).toEqual([
      "PREDICTION_STALE",
      "VERIFIED_ONLY",
    ]);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.evidenceMode).toBe("verified");
    expect(result.alternatives).toEqual([]);
  });

  it("11. fails closed on a verified action-fingerprint mismatch", () => {
    const outcome = composeHybridEvidence(
      hybridInput({
        verifiedClaims: [verifiedVisibility({ freshness: { actionFingerprint: OTHER_FP } })],
      }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("HYBRID_IDENTITY_MISMATCH");
  });

  it("12. retains multiple independent VERIFIED claims", () => {
    const result = requireSuccess(
      hybridInput({ verifiedClaims: [verifiedVisibility(), verifiedExistence()] }),
    );
    expect(result.claims).toHaveLength(2);
    expect(result.relationships.map((item) => item.kind)).toEqual([
      "VERIFIED_ONLY",
      "VERIFIED_ONLY",
    ]);
    expect(result.claims.map((claim) => claim.identity.property).sort()).toEqual([
      "file.existence",
      "repository.visibility",
    ]);
  });

  it("13. treats duplicate identical VERIFIED claims as compatible, not conflicting", () => {
    const result = requireSuccess(
      hybridInput({ verifiedClaims: [verifiedVisibility(), verifiedVisibility()] }),
    );
    expect(result.claims).toHaveLength(1);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.kind).toBe("VERIFIED_ONLY");
    expect(result.relationships.some((item) => item.kind === "VERIFIED_CONFLICT")).toBe(false);
    expect(result.authoritativeBasis).toBe("verified");
  });

  it("14. emits VERIFIED_CONFLICT when two VERIFIED claims disagree", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [
          verifiedVisibility(),
          verifiedVisibility({ before: known("private"), after: known("private") }),
        ],
      }),
    );
    const conflict = result.relationships.find((item) => item.kind === "VERIFIED_CONFLICT");
    expect(conflict).toBeDefined();
    expect(conflict?.leftClaim?.evidenceMode).toBe("verified");
    expect(conflict?.rightClaim?.evidenceMode).toBe("verified");
    expect(conflict?.leftClaim?.identity).not.toEqual(conflict?.rightClaim?.identity);
    expect(result.authoritativeBasis).toBe("verified-conflict");
    expect(result.reason).toBe("HYBRID_VERIFIED_CONFLICT");
    expect(result.relationships.some((item) => item.kind === "VERIFIED_ONLY")).toBe(false);
  });

  it("15. does not let a PREDICTED claim resolve a VERIFIED conflict", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [
          verifiedVisibility(),
          verifiedVisibility({ before: known("private"), after: known("private") }),
        ],
        prediction: predictedHypothesis(),
      }),
    );
    expect(result.authoritativeBasis).toBe("verified-conflict");
    expect(result.reason).toBe("HYBRID_VERIFIED_CONFLICT");
    expect(result.claims.some((claim) => claim.evidenceMode === "predicted")).toBe(true);
    expect(result.relationships.some((item) => item.kind === "VERIFIED_CONFLICT")).toBe(true);
  });

  it("16. keeps a high-confidence prediction from overriding VERIFIED", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [
          verifiedVisibility({
            before: known("private"),
            after: known("private"),
          }),
        ],
        prediction: predictedHypothesis({
          confidence: {
            calibratedConfidence: 0.99,
            calibrationMethod: "temperature-scaling",
            calibrationArtifactVersion: "cal-1",
          },
        }),
      }),
    );
    expect(result.relationships.map((item) => item.kind)).toEqual(["CONFLICTS"]);
    expect(result.authoritativeBasis).toBe("verified");
    const predicted = result.claims.find((claim) => claim.evidenceMode === "predicted");
    expect(predicted?.confidence).toBe(0.99);
    expect(predicted?.evidenceMode).toBe("predicted");
  });

  it("17. keeps a low-confidence prediction PREDICTED", () => {
    const result = requireSuccess(
      hybridInput({
        prediction: predictedHypothesis({
          confidence: {
            calibratedConfidence: 0.2,
            calibrationMethod: "temperature-scaling",
            calibrationArtifactVersion: "cal-1",
          },
        }),
      }),
    );
    expect(result.claims[0]?.evidenceMode).toBe("predicted");
    expect(result.claims[0]?.confidence).toBe(0.2);
  });

  it("18. does not compute a combined confidence", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility()],
        prediction: predictedHypothesis(),
      }),
    );
    expect(result).not.toHaveProperty("combinedConfidence");
    expect(result).not.toHaveProperty("fusedConfidence");
    expect(result).not.toHaveProperty("verifiedConfidence");
    const verified = result.claims.find((claim) => claim.evidenceMode === "verified");
    const predicted = result.claims.find((claim) => claim.evidenceMode === "predicted");
    expect(verified?.confidence).toBeNull();
    expect(predicted?.confidence).toBe(0.91);
    expect((verified?.confidence ?? 0) + (predicted?.confidence ?? 0)).not.toBe(
      ((1 + 0.91) / 2) as number,
    );
  });

  it("19. retains alternatives as uncertainty, not asserted claims", () => {
    const altEntry = FC008_SUPPORT_MATRIX[0];
    if (altEntry === undefined) {
      throw new Error("missing support-matrix entry");
    }
    const result = requireSuccess(
      hybridInput({
        prediction: predictedHypothesis({
          alternatives: [{ tuple: structuredClone(altEntry.tuple), calibratedConfidence: 0.12 }],
        }),
      }),
    );
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0]?.role).toBe("uncertainty");
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.identity.property).toBe("repository.visibility");
  });

  it("20. retains VERIFIED scope", () => {
    const result = requireSuccess(hybridInput({ verifiedClaims: [verifiedVisibility()] }));
    expect(result.claims[0]?.scope).toBe(VISIBILITY_SCOPE);
  });

  it("21. retains provenance for both modalities", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility()],
        prediction: predictedHypothesis(),
      }),
    );
    const verified = result.claims.find((claim) => claim.evidenceMode === "verified");
    const predicted = result.claims.find((claim) => claim.evidenceMode === "predicted");
    expect(verified?.provenance).toMatchObject({
      source: "rule",
      ruleId: "vcs.repository.visibility.private-to-public",
    });
    expect(predicted?.provenance).toMatchObject({
      source: "model",
      modelFamily: "joint-logistic",
      artifactSha256: TEST_SHA256,
    });
  });

  it("22. stamps the explicit hybrid policy version", () => {
    const result = requireSuccess(hybridInput({ verifiedClaims: [verifiedVisibility()] }));
    expect(result.policyVersion).toBe(FC009_HYBRID_POLICY_VERSION);
    expect(result.policyVersion).toBe("1.0");
  });

  it("23. rejects malformed VERIFIED input", () => {
    const outcome = composeHybridEvidence(
      hybridInput({
        verifiedClaims: [{ ...verifiedVisibility(), property: "Not A Property" }],
      }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("HYBRID_INPUT_INVALID");
  });

  it("24. rejects malformed PREDICTED adapter input", () => {
    const outcome = composeHybridEvidence(
      hybridInput({
        prediction: {
          status: "hypothesis",
          identity: { property: "??", before: "private", after: "public" },
          calibratedConfidence: 0.9,
          alternatives: [],
          freshness: { actionFingerprint: ACTION_FP },
          provenance: {
            source: "model",
            modelFamily: "joint-logistic",
            modelVersion: "m-1",
            artifactSha256: TEST_SHA256,
            supportMatrixVersion: "1.0",
          },
          support: {
            supportedTupleResolved: true,
            featureCoverage: 1,
            supportedObjectEvidence: true,
          },
        },
      }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("HYBRID_INPUT_INVALID");
  });

  it("25. rejects NaN confidence", () => {
    const prediction = {
      ...(predictedHypothesis() as Record<string, unknown>),
      calibratedConfidence: Number.NaN,
    };
    const outcome = composeHybridEvidence(hybridInput({ prediction: prediction as never }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("HYBRID_INPUT_INVALID");
    expect(outcome.issues.some((issue) => issue.code === "HYBRID_CONFIDENCE_INVALID")).toBe(true);
  });

  it("26. rejects confidence greater than 1", () => {
    const prediction = {
      ...(predictedHypothesis() as Record<string, unknown>),
      calibratedConfidence: 1.2,
    };
    const outcome = composeHybridEvidence(hybridInput({ prediction: prediction as never }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.issues.some((issue) => issue.code === "HYBRID_CONFIDENCE_INVALID")).toBe(true);
  });

  it("27. rejects unknown fields on the closed contract", () => {
    const outcome = composeHybridEvidence({
      ...hybridInput(),
      extra: true,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.issues.some((issue) => issue.code === "HYBRID_UNKNOWN_KEY")).toBe(true);
  });

  it("28. deeply freezes the result", () => {
    const result = requireSuccess(hybridInput({ verifiedClaims: [verifiedVisibility()] }));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.claims)).toBe(true);
    expect(Object.isFrozen(result.claims[0])).toBe(true);
    expect(Object.isFrozen(result.relationships)).toBe(true);
    expect(() => {
      (result as { policyVersion: string }).policyVersion = "2.0";
    }).toThrow();
  });

  it("29. is immune to caller mutation of input arrays after composition", () => {
    const claims = [verifiedVisibility()];
    const alternatives = [
      {
        identity: { property: "file.existence", before: "present", after: "absent" },
        calibratedConfidence: 0.1,
        role: "uncertainty" as const,
      },
    ];
    const prediction = {
      ...predictedHypothesis(),
      alternatives,
    };
    const result = requireSuccess(hybridInput({ verifiedClaims: claims, prediction }));
    claims.push(verifiedExistence());
    alternatives.push({
      identity: { property: "message.delivery", before: "draft", after: "sent" },
      calibratedConfidence: 0.05,
      role: "uncertainty",
    });
    expect(result.claims.filter((claim) => claim.evidenceMode === "verified")).toHaveLength(1);
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0]?.identity.property).toBe("file.existence");
  });

  it("30. is deterministic across repeated composition", () => {
    const input = hybridInput({
      verifiedClaims: [verifiedVisibility(), verifiedExistence()],
      prediction: predictedHypothesis(),
    });
    const first = requireSuccess(structuredClone(input));
    const second = requireSuccess(structuredClone(input));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("31. does not mutate a caller-owned ActionGraph stand-in", () => {
    const graph = { nodes: [{ id: "n1" }], edges: [{ from: "n1", to: "n2" }] };
    const snapshot = structuredClone(graph);
    requireSuccess(hybridInput({ verifiedClaims: [verifiedVisibility()] }));
    expect(graph).toEqual(snapshot);
  });

  it("35. exposes no execution method on the result", () => {
    const result = requireSuccess(hybridInput({ verifiedClaims: [verifiedVisibility()] }));
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== "object") {
        expect(typeof value).not.toBe("function");
        return;
      }
      for (const key of Reflect.ownKeys(value)) {
        const child = Reflect.get(value, key);
        expect(typeof child).not.toBe("function");
        if (typeof child === "object" && child !== null) {
          walk(child);
        }
      }
    };
    walk(result);
    expect(result).not.toHaveProperty("click");
    expect(result).not.toHaveProperty("release");
    expect(result).not.toHaveProperty("execute");
  });

  it("36. fails closed when a cap is exceeded", () => {
    const overflow = Array.from({ length: FC009_SAFETY_CAPS.maxVerifiedClaims + 1 }, () =>
      verifiedVisibility(),
    );
    const outcome = composeHybridEvidence(hybridInput({ verifiedClaims: overflow }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect(outcome.reason).toBe("HYBRID_CAP_EXCEEDED");
  });
});

function pairKey(relationship: {
  readonly kind: string;
  readonly leftClaim: { identity: { property: string; before: string; after: string } } | null;
  readonly rightClaim: { identity: { property: string; before: string; after: string } } | null;
}): string {
  const left = relationship.leftClaim?.identity;
  const right = relationship.rightClaim?.identity;
  return [
    relationship.kind,
    left === undefined ? "" : `${left.property}|${left.before}->${left.after}`,
    right === undefined ? "" : `${right.property}|${right.before}->${right.after}`,
  ].join("::");
}

describe("FC-009 A2 conflict canonicalization and unknown safety", () => {
  const publicClaim = () => verifiedVisibility();
  const privateClaim = () =>
    verifiedVisibility({ before: known("private"), after: known("private") });
  const reversedClaim = () =>
    verifiedVisibility({ before: known("public"), after: known("private") });

  it("1/2. names both verified endpoints with explicit modes", () => {
    const result = requireSuccess(hybridInput({ verifiedClaims: [publicClaim(), privateClaim()] }));
    const conflict = result.relationships.find((item) => item.kind === "VERIFIED_CONFLICT");
    expect(conflict?.leftClaim?.evidenceMode).toBe("verified");
    expect(conflict?.rightClaim?.evidenceMode).toBe("verified");
    expect(conflict?.leftClaim?.identity).toEqual({
      property: "repository.visibility",
      before: "private",
      after: "private",
    });
    expect(conflict?.rightClaim?.identity).toEqual({
      property: "repository.visibility",
      before: "private",
      after: "public",
    });
  });

  it("3/4. emits each unordered verified pair exactly once", () => {
    const result = requireSuccess(hybridInput({ verifiedClaims: [publicClaim(), privateClaim()] }));
    const conflicts = result.relationships.filter((item) => item.kind === "VERIFIED_CONFLICT");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.leftClaim?.identity.after).toBe("private");
    expect(conflicts[0]?.rightClaim?.identity.after).toBe("public");
  });

  it("5. emits every genuine 3-way verified-conflict pair", () => {
    const result = requireSuccess(
      hybridInput({ verifiedClaims: [publicClaim(), privateClaim(), reversedClaim()] }),
    );
    const conflicts = result.relationships.filter((item) => item.kind === "VERIFIED_CONFLICT");
    expect(conflicts).toHaveLength(3);
    expect(conflicts.map(pairKey).sort()).toEqual([
      "VERIFIED_CONFLICT::repository.visibility|private->private::repository.visibility|private->public",
      "VERIFIED_CONFLICT::repository.visibility|private->private::repository.visibility|public->private",
      "VERIFIED_CONFLICT::repository.visibility|private->public::repository.visibility|public->private",
    ]);
  });

  it("6. is invariant under reversed verified input order", () => {
    const abc = requireSuccess(
      hybridInput({ verifiedClaims: [publicClaim(), privateClaim(), reversedClaim()] }),
    );
    const cba = requireSuccess(
      hybridInput({ verifiedClaims: [reversedClaim(), privateClaim(), publicClaim()] }),
    );
    expect(JSON.stringify(abc.claims.map((claim) => claim.identity))).toBe(
      JSON.stringify(cba.claims.map((claim) => claim.identity)),
    );
    expect(JSON.stringify(abc.relationships)).toBe(JSON.stringify(cba.relationships));
    expect(abc.authoritativeBasis).toBe(cba.authoritativeBasis);
    expect(abc.reason).toBe(cba.reason);
    expect(abc.predictionStatus).toBe(cba.predictionStatus);
  });

  it("7/8. prediction cannot resolve or elect a verified-conflict winner", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [publicClaim(), privateClaim()],
        prediction: predictedHypothesis({
          confidence: {
            calibratedConfidence: 0.999999,
            calibrationMethod: "temperature-scaling",
            calibrationArtifactVersion: "cal-1",
          },
        }),
      }),
    );
    expect(result.authoritativeBasis).toBe("verified-conflict");
    expect(result.reason).toBe("HYBRID_VERIFIED_CONFLICT");
    const kinds = result.relationships.map((item) => item.kind).sort();
    expect(kinds).toEqual(["AGREES", "CONFLICTS", "VERIFIED_CONFLICT"]);
    const agrees = result.relationships.find((item) => item.kind === "AGREES");
    expect(agrees?.leftClaim?.evidenceMode).toBe("verified");
    expect(agrees?.rightClaim?.evidenceMode).toBe("predicted");
    expect(agrees?.leftClaim?.identity.after).toBe("public");
    expect(result.relationships.some((item) => item.kind === "VERIFIED_ONLY")).toBe(false);
  });

  it("9. withholds VERIFIED_ONLY from unresolved verified-conflict participants", () => {
    const result = requireSuccess(hybridInput({ verifiedClaims: [publicClaim(), privateClaim()] }));
    expect(result.relationships.map((item) => item.kind)).toEqual(["VERIFIED_CONFLICT"]);
  });

  it("10/11. duplicate identical VERIFIED claims neither conflict nor duplicate relationships", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [publicClaim(), publicClaim(), verifiedExistence(), verifiedExistence()],
      }),
    );
    expect(result.claims).toHaveLength(2);
    expect(result.relationships.filter((item) => item.kind === "VERIFIED_ONLY")).toHaveLength(2);
    expect(result.relationships.some((item) => item.kind === "VERIFIED_CONFLICT")).toBe(false);
  });

  it("12. treats identical unknown→public as INCOMPARABLE", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility({ before: unknownState(), after: known("public") })],
        prediction: predictedWithIdentity({
          property: "repository.visibility",
          before: "unknown",
          after: "public",
        }),
      }),
    );
    expect(result.relationships.map((item) => item.kind)).toEqual(["INCOMPARABLE"]);
  });

  it("13. treats identical private→unknown as INCOMPARABLE", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility({ before: known("private"), after: unknownState() })],
        prediction: predictedWithIdentity({
          property: "repository.visibility",
          before: "private",
          after: "unknown",
        }),
      }),
    );
    expect(result.relationships.map((item) => item.kind)).toEqual(["INCOMPARABLE"]);
  });

  it("14. treats identical unknown→unknown as INCOMPARABLE", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility({ before: unknownState(), after: unknownState() })],
        prediction: predictedWithIdentity({
          property: "repository.visibility",
          before: "unknown",
          after: "unknown",
        }),
      }),
    );
    expect(result.relationships.map((item) => item.kind)).toEqual(["INCOMPARABLE"]);
  });

  it("15. treats unknown vs known as INCOMPARABLE", () => {
    const unknownToPublic = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility({ before: unknownState(), after: known("public") })],
        prediction: predictedHypothesis(),
      }),
    );
    const privateToUnknown = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility({ before: known("private"), after: unknownState() })],
        prediction: predictedHypothesis(),
      }),
    );
    expect(unknownToPublic.relationships.map((item) => item.kind)).toEqual(["INCOMPARABLE"]);
    expect(privateToUnknown.relationships.map((item) => item.kind)).toEqual(["INCOMPARABLE"]);
  });

  it("16. keeps known identical transitions AGREES", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility()],
        prediction: predictedHypothesis(),
      }),
    );
    expect(result.relationships[0]?.kind).toBe("AGREES");
    expect(result.relationships[0]?.leftClaim?.evidenceMode).toBe("verified");
    expect(result.relationships[0]?.rightClaim?.evidenceMode).toBe("predicted");
  });

  it("17. keeps known differing transitions CONFLICTS", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [privateClaim()],
        prediction: predictedHypothesis(),
      }),
    );
    expect(result.relationships[0]?.kind).toBe("CONFLICTS");
  });

  it("18. keeps cross-object properties incomparable", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [
          verifiedVisibility({
            property: "document.visibility",
            before: known("private"),
            after: known("public"),
          }),
        ],
        prediction: predictedHypothesis(),
      }),
    );
    expect(result.relationships[0]?.kind).toBe("INCOMPARABLE");
    expect(result.claims.map((claim) => claim.identity.property).sort()).toEqual([
      "document.visibility",
      "repository.visibility",
    ]);
  });

  it("19. keeps repository.visibility alignment", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility()],
        prediction: predictedHypothesis(),
      }),
    );
    expect(
      result.claims.every((claim) => claim.identity.property === "repository.visibility"),
    ).toBe(true);
    expect(result.relationships[0]?.kind).toBe("AGREES");
  });

  it("23. keeps alternatives outside claims and authority", () => {
    const altEntry = FC008_SUPPORT_MATRIX[0];
    if (altEntry === undefined) {
      throw new Error("missing support-matrix entry");
    }
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [publicClaim(), privateClaim()],
        prediction: predictedHypothesis({
          alternatives: [{ tuple: structuredClone(altEntry.tuple), calibratedConfidence: 0.12 }],
        }),
      }),
    );
    expect(result.alternatives[0]?.role).toBe("uncertainty");
    expect(result.claims.some((claim) => claim.identity.property === "file.existence")).toBe(false);
    expect(result.authoritativeBasis).toBe("verified-conflict");
    expect(result.relationships.some((item) => item.kind === "VERIFIED_CONFLICT")).toBe(true);
  });

  it("24/25/26. keeps modality-specific confidence and no fused field", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility()],
        prediction: predictedHypothesis(),
      }),
    );
    expect(result.claims.find((claim) => claim.evidenceMode === "verified")?.confidence).toBeNull();
    expect(result.claims.find((claim) => claim.evidenceMode === "predicted")?.confidence).toBe(
      0.91,
    );
    expect(result).not.toHaveProperty("combinedConfidence");
    expect(result).not.toHaveProperty("fusedConfidence");
  });

  it("27/28. preserves equal-identity and stale-prediction rules", () => {
    const mismatch = composeHybridEvidence(
      hybridInput({
        verifiedClaims: [verifiedVisibility({ freshness: { actionFingerprint: OTHER_FP } })],
      }),
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.reason).toBe("HYBRID_IDENTITY_MISMATCH");
    }
    const stale = requireSuccess(
      hybridInput({
        verifiedClaims: [verifiedVisibility()],
        prediction: predictedHypothesis({ inputFingerprint: OTHER_FP }),
      }),
    );
    expect(stale.predictionStatus).toBe("stale");
    expect(stale.claims).toHaveLength(1);
    expect(stale.claims[0]?.evidenceMode).toBe("verified");
  });

  it("31/32. freezes relationship endpoints against caller mutation", () => {
    const claims = [publicClaim(), privateClaim()];
    const result = requireSuccess(hybridInput({ verifiedClaims: claims }));
    const conflict = result.relationships[0];
    expect(Object.isFrozen(conflict)).toBe(true);
    expect(Object.isFrozen(conflict?.leftClaim)).toBe(true);
    expect(Object.isFrozen(conflict?.leftClaim?.identity)).toBe(true);
    expect(Object.isFrozen(conflict?.rightClaim)).toBe(true);
    claims[0] = reversedClaim();
    expect(conflict?.rightClaim?.identity.after).toBe("public");
    expect(() => {
      (conflict?.leftClaim?.identity as { after: string }).after = "mutated";
    }).toThrow();
  });

  it("rejects a bare visibility property", () => {
    const outcome = composeHybridEvidence(
      hybridInput({
        verifiedClaims: [{ ...verifiedVisibility(), property: "visibility" }],
      }),
    );
    expect(outcome.ok).toBe(false);
  });

  it("leaves filesystem.exists incomparable to file.existence", () => {
    const result = requireSuccess(
      hybridInput({
        verifiedClaims: [
          verifiedExistence(),
          verifiedVisibility({
            property: "filesystem.exists",
            before: known("present"),
            after: known("absent"),
          }),
        ],
      }),
    );
    expect(result.relationships.every((item) => item.kind === "VERIFIED_ONLY")).toBe(true);
    expect(result.claims.map((claim) => claim.identity.property).sort()).toEqual([
      "file.existence",
      "filesystem.exists",
    ]);
  });
});
