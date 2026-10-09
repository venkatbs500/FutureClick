import {
  createAbstainedResult,
  createFailedResult,
  createFailureDetail,
  createHypothesisResult,
} from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import {
  adaptPredictedEvidence,
  adaptVerifiedConsequence,
  adaptVerifiedStateChange,
  composeHybridEvidence,
} from "../src/index.js";
import {
  ACTION_FP,
  PRIVATE_OBJECT_SUMMARY,
  hypothesisResult,
  validHypothesis,
  verifiedVisibility,
  visibilityConsequenceWithoutEvidenceScope,
  visibilityRuleConsequence,
  visibilityRuleStateChange,
} from "./helpers.js";

describe("FC-008 predicted adapter", () => {
  it("adapts a committed UnderstandingResult hypothesis without execution methods", () => {
    const understanding = createHypothesisResult(validHypothesis());
    const adapted = adaptPredictedEvidence(understanding);
    expect(adapted.status).toBe("hypothesis");
    if (adapted.status !== "hypothesis") {
      return;
    }
    expect(adapted.identity).toEqual({
      property: "repository.visibility",
      before: "private",
      after: "public",
    });
    expect(adapted.calibratedConfidence).toBe(0.91);
    expect(adapted.provenance.source).toBe("model");
    expect(adapted.freshness.actionFingerprint).toBe(ACTION_FP);
    expect(typeof adapted).not.toBe("function");
    expect(adapted).not.toHaveProperty("click");
    expect(adapted).not.toHaveProperty("release");
  });

  it("adapts abstention without manufacturing a claim", () => {
    const adapted = adaptPredictedEvidence(
      createAbstainedResult({
        reason: "NOVEL_OR_UNSUPPORTED_INPUT",
        inputFingerprint: ACTION_FP,
      }),
    );
    expect(adapted.status).toBe("abstained");
    if (adapted.status !== "abstained") {
      return;
    }
    expect(adapted.reason).toBe("NOVEL_OR_UNSUPPORTED_INPUT");
    expect(adapted).not.toHaveProperty("identity");
    expect(adapted).not.toHaveProperty("calibratedConfidence");
    expect(adapted.provenance).toBeNull();
    expect(adapted.support).toBeNull();
  });

  it("republishes privacy-safe FC-008 abstention provenance and support", () => {
    const hypothesis = validHypothesis();
    const adapted = adaptPredictedEvidence(
      createAbstainedResult({
        reason: "LOW_CONFIDENCE",
        inputFingerprint: ACTION_FP,
        provenance: hypothesis.provenance,
        support: hypothesis.support,
      }),
    );
    expect(adapted.status).toBe("abstained");
    if (adapted.status !== "abstained") {
      return;
    }
    expect(adapted.provenance).toEqual({
      source: "model",
      modelFamily: hypothesis.provenance.modelFamily,
      modelVersion: hypothesis.provenance.modelVersion,
      artifactSha256: hypothesis.provenance.artifactSha256,
      supportMatrixVersion: hypothesis.provenance.supportMatrixVersion,
    });
    expect(adapted.support).toEqual({
      supportedTupleResolved: hypothesis.support.supportedTupleResolved,
      featureCoverage: hypothesis.support.featureCoverage,
      supportedObjectEvidence: hypothesis.support.supportedObjectEvidence,
    });
    const outcome = composeHybridEvidence({
      schemaVersion: "1.0",
      policyVersion: "1.0",
      identity: { actionFingerprint: ACTION_FP },
      verifiedClaims: [verifiedVisibility()],
      prediction: adapted,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.predictionProvenance).toEqual(adapted.provenance);
    expect(outcome.result.predictionSupport).toEqual(adapted.support);
    expect(outcome.result.predictionAbstentionReason).toBe("LOW_CONFIDENCE");
  });

  it("adapts operational failure separately from abstention", () => {
    const adapted = adaptPredictedEvidence(
      createFailedResult(
        "MODEL_VERSION_MISMATCH",
        null,
        createFailureDetail("version-check", "version-mismatch"),
      ),
    );
    expect(adapted.status).toBe("failed");
    if (adapted.status !== "failed") {
      return;
    }
    expect(adapted.code).toBe("MODEL_VERSION_MISMATCH");
    expect(adapted).not.toHaveProperty("reason");
  });

  it("composes a real FC-008 hypothesis contract with hybrid input", () => {
    const outcome = composeHybridEvidence({
      schemaVersion: "1.0",
      policyVersion: "1.0",
      identity: { actionFingerprint: ACTION_FP },
      verifiedClaims: [verifiedVisibility()],
      prediction: adaptPredictedEvidence(hypothesisResult()),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.relationships[0]?.kind).toBe("AGREES");
  });
});

describe("VERIFIED consequence adapter", () => {
  it("adapts the committed visibility-rule StateChange as data only", () => {
    const adapted = adaptVerifiedStateChange(visibilityRuleStateChange(), {
      freshness: { actionFingerprint: ACTION_FP },
      provenance: {
        source: "rule",
        ruleId: "vcs.repository.visibility.private-to-public",
        engineVersion: "consequence-engine-1.0",
      },
      scope: "GitHub final confirmation page under the FC-007 supported visibility contract.",
      assumptions: [
        {
          id: "asm.vcs.visibility.1",
          statement:
            "The remote version control platform processes the visibility change successfully under modeled semantics.",
          status: "assumed",
        },
      ],
    });
    expect(adapted).not.toBeNull();
    expect(adapted?.property).toBe("repository.visibility");
    expect(adapted?.before).toEqual({ status: "known", value: "private" });
    expect(adapted?.after).toEqual({ status: "known", value: "public" });
    expect(adapted?.scope).toContain("FC-007 supported visibility contract");
  });

  it("adapts a consequence record into verified claims for composition", () => {
    const claims = adaptVerifiedConsequence(visibilityRuleConsequence(), {
      actionFingerprint: ACTION_FP,
    });
    expect(claims).not.toBeNull();
    const outcome = composeHybridEvidence({
      schemaVersion: "1.0",
      policyVersion: "1.0",
      identity: { actionFingerprint: ACTION_FP },
      verifiedClaims: claims ?? [],
      prediction: null,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.claims[0]?.identity).toEqual({
      property: "repository.visibility",
      before: "private",
      after: "public",
    });
    expect(outcome.result.claims[0]?.scope).toBe(visibilityRuleConsequence().evidence[0]?.scope);
  });

  it("retains explicit safe evidence scope and never copies consequence.summary", () => {
    const claims = adaptVerifiedConsequence(visibilityRuleConsequence(), {
      actionFingerprint: ACTION_FP,
    });
    expect(claims?.[0]?.scope).toBe(visibilityRuleConsequence().evidence[0]?.scope);
    expect(JSON.stringify(claims)).not.toContain(visibilityRuleConsequence().summary);
  });

  it("does not copy a private consequence summary into hybrid scope", () => {
    const claims = adaptVerifiedConsequence(visibilityConsequenceWithoutEvidenceScope(), {
      actionFingerprint: ACTION_FP,
    });
    expect(claims).not.toBeNull();
    expect(claims?.[0]?.scope).toBeNull();
    const outcome = composeHybridEvidence({
      schemaVersion: "1.0",
      policyVersion: "1.0",
      identity: { actionFingerprint: ACTION_FP },
      verifiedClaims: claims ?? [],
      prediction: null,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(JSON.stringify(outcome.result)).not.toContain("acme-secret-ledger");
    expect(JSON.stringify(outcome.result)).not.toContain(PRIVATE_OBJECT_SUMMARY);
    expect(outcome.result.claims[0]?.scope).toBeNull();
  });

  it("fails closed on document.shared_with because it is not a canonical property", () => {
    const adapted = adaptVerifiedStateChange(
      {
        entityId: "ent.doc.1" as never,
        property: "document.shared_with",
        operation: "replace",
        before: { status: "known", value: "private" },
        after: { status: "known", value: "shared" },
      },
      {
        freshness: { actionFingerprint: ACTION_FP },
        provenance: { source: "rule", ruleId: "share.1", engineVersion: "1.0" },
        scope: null,
      },
    );
    expect(adapted).toBeNull();
  });
});
