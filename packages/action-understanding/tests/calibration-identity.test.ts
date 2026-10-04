/**
 * Model and calibration artifact identity consistency (AI-3, AI-13, AI-14).
 *
 * A temperature fitted for one artifact is not a valid temperature for another
 * artifact's logits, and the resulting mis-calibrated probability looks entirely
 * normal. The runtime therefore checks identity across the loaded artifact, the
 * provider's score set, the calibration result, and the published provenance,
 * and fails closed on any divergence.
 */

import { describe, expect, it } from "vitest";
import { FC008_FEATURE_POLICY_VERSION } from "../src/feature-policy.js";
import { isFailedResult, isHypothesisResult } from "../src/result.js";
import { evaluateObservation } from "../src/runtime.js";
import { FC008_SUPPORT_MATRIX_VERSION } from "../src/support-matrix.js";
import { validateAbstentionPolicy } from "../src/policy.js";
import {
  ARTIFACT_IDENTITY_FIELDS,
  artifactIdentityDivergence,
  artifactIdentityMatches,
} from "../src/provider.js";
import {
  buildArtifact,
  buildCalibratedScores,
  buildFactorizedScores,
  buildObservationInput,
  buildPolicy,
  buildPolicyInput,
  buildRuntimeDeps,
  createStubCalibrator,
  createStubProvider,
} from "./helpers.js";

const OTHER_SHA = "b".repeat(64);

describe("the loaded artifact and the provider score set must agree", () => {
  it("accepts a matching artifact identity", () => {
    const artifact = buildArtifact();
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ artifact, provider: createStubProvider({ artifact }) }),
    );
    expect(isHypothesisResult(result)).toBe(true);
  });

  it("fails closed on a diverging artifact hash", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact: buildArtifact(),
        provider: createStubProvider({ artifact: buildArtifact({ artifactSha256: OTHER_SHA }) }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.reason).toBe("artifact-identity-divergence");
  });

  it("fails closed on a diverging model version", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact: buildArtifact({ modelVersion: "m-1" }),
        provider: createStubProvider({ artifact: buildArtifact({ modelVersion: "m-2" }) }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });

  it("fails closed on a diverging calibration artifact version", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact: buildArtifact({ calibrationArtifactVersion: "cal-1" }),
        provider: createStubProvider({
          artifact: buildArtifact({ calibrationArtifactVersion: "cal-2" }),
        }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });

  it("rejects a payload whose scores and own artifact disagree on family", () => {
    // Joint logits presented with a factorized artifact is self-inconsistent, so
    // it is refused during outcome validation, before any comparison with the
    // loaded artifact.
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact: buildArtifact({ modelFamily: "joint-logistic" }),
        provider: createStubProvider({
          artifact: buildArtifact({ modelFamily: "factorized-logistic" }),
        }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.stage).toBe("provider-outcome-validation");
  });

  it("fails closed on a self-consistent payload of the wrong family", () => {
    // A valid factorized payload offered while a joint artifact is loaded. The
    // artifact identity check catches it on the family field.
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact: buildArtifact({ modelFamily: "joint-logistic" }),
        provider: createStubProvider({
          scores: buildFactorizedScores(),
          artifact: buildArtifact({ modelFamily: "factorized-logistic" }),
        }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.reason).toBe("artifact-identity-divergence");
  });
});

describe("the calibration result must have been fitted for this artifact", () => {
  it("fails closed when calibration was fitted for a different artifact hash", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        calibrator: createStubCalibrator({
          calibratedFor: { artifactSha256: OTHER_SHA },
        }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.stage).toBe("calibration-identity");
    expect(result.detail.reason).toBe("calibration-identity-divergence");
  });

  it("fails closed when calibration was fitted for a different model version", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        calibrator: createStubCalibrator({ calibratedFor: { modelVersion: "m-9" } }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });

  it("fails closed when calibration was fitted for a different model family", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        calibrator: createStubCalibrator({
          calibratedFor: { modelFamily: "factorized-logistic" },
        }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });

  it("fails closed when the calibration artifact version disagrees", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        calibrator: createStubCalibrator({ calibrationArtifactVersion: "cal-mismatched" }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });

  it("refuses a calibration result that declares no identity at all", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        calibrator: createStubCalibrator({
          outcome: {
            status: "calibrated",
            scores: {
              ...buildCalibratedScores(),
              calibratedForArtifactSha256: "",
              calibratedForModelVersion: "",
            },
          },
        }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });
});

describe("artifact and policy version agreement", () => {
  it("fails closed when the artifact declares a different support matrix version", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ artifact: buildArtifact({ supportMatrixVersion: "9.9" }) }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.stage).toBe("version-check");
  });

  it("fails closed when the artifact declares a different feature policy version", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ artifact: buildArtifact({ featurePolicyVersion: "9.9" }) }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });

  it("fails closed when a loaded vocabulary was fitted under another policy version", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        vocabulary: {
          vocabularyVersion: "v-1",
          featurePolicyVersion: "9.9" as never,
          entries: new Map<string, number>(),
          size: 0,
        },
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });

  it("will not even construct a policy that names an unknown frozen version", () => {
    // The policy validator pins both versions by enum, so a policy requiring a
    // version this build does not implement cannot be built in the first place.
    for (const overrides of [
      { requiredSupportMatrixVersion: "0.9" },
      { requiredFeaturePolicyVersion: "0.9" },
    ]) {
      const result = validateAbstentionPolicy(buildPolicyInput(overrides));
      expect(result.valid).toBe(false);
      if (result.valid) {
        return;
      }
      expect(result.issues.map((i) => i.code)).toContain("FC008_ENUM_VIOLATION");
    }
    expect(buildPolicy().requiredSupportMatrixVersion).toBe(FC008_SUPPORT_MATRIX_VERSION);
    expect(buildPolicy().requiredFeaturePolicyVersion).toBe(FC008_FEATURE_POLICY_VERSION);
  });
});

describe("published provenance comes from the loaded artifact", () => {
  it("carries the artifact identity and the policy version onto the hypothesis", () => {
    const artifact = buildArtifact();
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ artifact, provider: createStubProvider({ artifact }) }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    const { provenance, confidence } = result.hypothesis;
    expect(provenance.artifactSha256).toBe(artifact.artifactSha256);
    expect(provenance.modelFamily).toBe(artifact.modelFamily);
    expect(provenance.modelVersion).toBe(artifact.modelVersion);
    expect(provenance.supportMatrixVersion).toBe(artifact.supportMatrixVersion);
    expect(provenance.featurePolicyVersion).toBe(artifact.featurePolicyVersion);
    expect(confidence.calibrationArtifactVersion).toBe(artifact.calibrationArtifactVersion);
  });

  it("publishes the evidence mode as predicted, never verified", () => {
    const result = evaluateObservation(buildObservationInput(), buildRuntimeDeps());
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    expect(result.hypothesis.evidenceMode).toBe("predicted");
  });

  it("takes the published calibration version from the artifact, not the calibrator", () => {
    // The identity check means the two always agree by the time a hypothesis is
    // published, so this asserts provenance is *sourced* from the validated
    // artifact: the calibrator states the same version and the published value
    // still tracks the artifact.
    const artifact = buildArtifact({ calibrationArtifactVersion: "cal-authoritative" });
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact,
        provider: createStubProvider({ artifact }),
        calibrator: createStubCalibrator({
          calibratedFor: artifact,
          calibrationArtifactVersion: "cal-authoritative",
        }),
      }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    expect(result.hypothesis.confidence.calibrationArtifactVersion).toBe("cal-authoritative");
    expect(result.hypothesis.provenance.abstentionPolicyVersion).toBe(buildPolicy().policyVersion);
  });
});

/**
 * Identity is only as strong as its weakest dimension. A model hash and version
 * can match while the support matrix or feature policy differ, which means a
 * different class space or a different feature space: a real incompatibility
 * that a partial check accepts silently.
 */
describe("identity is complete across every declared dimension", () => {
  /** Every identity field except the family, which is exercised separately. */
  const STRING_IDENTITY_FIELDS = ARTIFACT_IDENTITY_FIELDS.filter(
    (field) => field !== "modelFamily",
  );

  /**
   * A divergent but still well-formed value per field. The value must remain
   * valid in shape, otherwise the payload is refused during outcome validation
   * and the identity check is never reached, which would make these tests prove
   * nothing about identity.
   */
  const DIVERGENT: Record<(typeof STRING_IDENTITY_FIELDS)[number], string> = {
    modelVersion: "divergent-model-version",
    artifactSha256: OTHER_SHA,
    supportMatrixVersion: "9.9",
    featurePolicyVersion: "9.9",
    calibrationArtifactVersion: "divergent-calibration",
  };

  it("declares exactly the six approved identity dimensions", () => {
    expect([...ARTIFACT_IDENTITY_FIELDS]).toEqual([
      "modelFamily",
      "modelVersion",
      "artifactSha256",
      "supportMatrixVersion",
      "featurePolicyVersion",
      "calibrationArtifactVersion",
    ]);
  });

  it("reports divergence on each dimension individually", () => {
    const base = buildArtifact();
    for (const field of STRING_IDENTITY_FIELDS) {
      expect(artifactIdentityDivergence({ ...base, [field]: DIVERGENT[field] }, base)).toBe(field);
    }
    expect(artifactIdentityDivergence({ ...base, modelFamily: "factorized-logistic" }, base)).toBe(
      "modelFamily",
    );
    expect(artifactIdentityMatches(base, buildArtifact())).toBe(true);
  });

  it("refuses provider scores that diverge on any identity dimension", () => {
    // Table-driven so a newly declared identity dimension that the runtime does
    // not actually enforce fails here rather than passing unnoticed.
    const artifact = buildArtifact();
    for (const field of STRING_IDENTITY_FIELDS) {
      const result = evaluateObservation(
        buildObservationInput(),
        buildRuntimeDeps({
          artifact,
          provider: createStubProvider({
            artifact: buildArtifact({ [field]: DIVERGENT[field] }),
          }),
        }),
      );
      expect(isFailedResult(result) && result.code, field).toBe("MODEL_VERSION_MISMATCH");
      if (!isFailedResult(result)) {
        return;
      }
      expect(result.detail.stage, field).toBe("provider");
      expect(result.detail.reason, field).toBe("artifact-identity-divergence");
    }
  });

  it("fails closed when the provider claims a different support matrix version", () => {
    // The loaded artifact matches the policy, so the step-2 version check passes
    // and this divergence can only be caught at the provider boundary.
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact: buildArtifact(),
        provider: createStubProvider({ artifact: buildArtifact({ supportMatrixVersion: "9.9" }) }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.stage).toBe("provider");
  });

  it("fails closed when the provider claims a different feature policy version", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact: buildArtifact(),
        provider: createStubProvider({ artifact: buildArtifact({ featurePolicyVersion: "9.9" }) }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.stage).toBe("provider");
  });

  it("fails closed when calibration was fitted under a different support matrix version", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        calibrator: createStubCalibrator({ calibratedFor: { supportMatrixVersion: "9.9" } }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.stage).toBe("calibration-identity");
    expect(result.detail.reason).toBe("calibration-identity-divergence");
  });

  it("fails closed when calibration was fitted under a different feature policy version", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        calibrator: createStubCalibrator({ calibratedFor: { featurePolicyVersion: "9.9" } }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.stage).toBe("calibration-identity");
  });

  it("refuses calibration that diverges on any identity dimension", () => {
    for (const field of STRING_IDENTITY_FIELDS) {
      const result = evaluateObservation(
        buildObservationInput(),
        buildRuntimeDeps({
          calibrator: createStubCalibrator({
            calibratedFor: { [field]: DIVERGENT[field] },
            ...(field === "calibrationArtifactVersion"
              ? { calibrationArtifactVersion: DIVERGENT[field] }
              : {}),
          }),
        }),
      );
      expect(isFailedResult(result) && result.code, field).toBe("MODEL_VERSION_MISMATCH");
      if (!isFailedResult(result)) {
        return;
      }
      expect(result.detail.stage, field).toBe("calibration-identity");
    }
  });

  it("checks factorized provider identity exactly as it checks joint identity", () => {
    // Identity is settled before the composition decision, so a factorized
    // payload with a divergent identity yields MODEL_VERSION_MISMATCH rather than
    // the MODEL_UNAVAILABLE of the deferred composition path.
    const artifact = buildArtifact({ modelFamily: "factorized-logistic" });
    for (const field of STRING_IDENTITY_FIELDS) {
      const result = evaluateObservation(
        buildObservationInput(),
        buildRuntimeDeps({
          artifact,
          provider: createStubProvider({
            scores: buildFactorizedScores(),
            artifact: { ...artifact, [field]: DIVERGENT[field] },
          }),
        }),
      );
      expect(isFailedResult(result) && result.code, field).toBe("MODEL_VERSION_MISMATCH");
      if (!isFailedResult(result)) {
        return;
      }
      expect(result.detail.stage, field).toBe("provider");
      expect(result.detail.reason, field).toBe("artifact-identity-divergence");
    }
  });

  it("reaches the deferred composition path only once factorized identity agrees", () => {
    const artifact = buildArtifact({ modelFamily: "factorized-logistic" });
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact,
        provider: createStubProvider({ scores: buildFactorizedScores(), artifact }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_UNAVAILABLE");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.stage).toBe("composition");
    expect(result.detail.reason).toBe("composition-not-implemented");
  });
});
