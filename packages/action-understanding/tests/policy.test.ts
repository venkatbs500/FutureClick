import { describe, expect, it } from "vitest";
import * as bounds from "../src/bounds.js";
import { FC008_SAFETY_CAPS, FC008_MEASURE_THEN_FREEZE_TARGETS } from "../src/bounds.js";
import { FC008_FEATURE_POLICY_VERSION } from "../src/feature-policy.js";
import * as policyModule from "../src/policy.js";
import { type AbstentionPolicy, validateAbstentionPolicy } from "../src/policy.js";
import { isAbstainedResult, isFailedResult, isHypothesisResult } from "../src/result.js";
import { evaluateObservation } from "../src/runtime.js";
import { FC008_SUPPORT_MATRIX_VERSION } from "../src/support-matrix.js";
import { findNonInertPath, findUnfrozenPath } from "../src/validation.js";
import {
  buildObservationInput,
  buildPolicy,
  buildPolicyInput,
  buildRuntimeDeps,
  createStubProvider,
} from "./helpers.js";

type AssertFalse<T extends false> = T;
type HasKey<O, K extends string> = K extends keyof O ? true : false;

// A policy carries thresholds and versions, never a capability or a model.
type _NoProvider = AssertFalse<HasKey<AbstentionPolicy, "provider">>;
type _NoModel = AssertFalse<HasKey<AbstentionPolicy, "model">>;
type _NoWeights = AssertFalse<HasKey<AbstentionPolicy, "weights">>;
type _NoExecute = AssertFalse<HasKey<AbstentionPolicy, "execute">>;
type _NoOverride = AssertFalse<HasKey<AbstentionPolicy, "override">>;

function expectInvalid(input: unknown): readonly string[] {
  const result = validateAbstentionPolicy(input);
  expect(result.valid).toBe(false);
  return result.issues.map((i) => i.code);
}

describe("Sprint 1 ships no calibrated default policy", () => {
  it("exports no default or recommended policy value", () => {
    // Thresholds are selected on the POLICY-VALIDATION partition in Sprint 3.
    // Shipping a number here would fabricate a calibration decision that no
    // data yet supports.
    const exported = Object.keys(policyModule);
    expect(exported).toEqual(["validateAbstentionPolicy"]);
    for (const name of exported) {
      expect(name.toLowerCase()).not.toContain("default");
      expect(name.toLowerCase()).not.toContain("recommended");
    }
  });

  it("requires the caller to supply every threshold explicitly", () => {
    const required = [
      "policyVersion",
      "minCalibratedConfidence",
      "minMargin",
      "maxUnknownTokenRatio",
      "minFeatureCoverage",
      "minRetainedRedactionRatio",
      "inferenceTimeoutMs",
      "requiredSupportMatrixVersion",
      "requiredFeaturePolicyVersion",
    ];
    for (const key of required) {
      const input = buildPolicyInput();
      delete input[key];
      expect(expectInvalid(input)).toContain("FC008_MISSING_KEY");
    }
  });
});

describe("AbstentionPolicy validation", () => {
  it("accepts a well-formed policy and returns it deeply frozen and inert", () => {
    const result = validateAbstentionPolicy(buildPolicyInput());
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(findUnfrozenPath(result.value)).toBeNull();
    expect(findNonInertPath(result.value)).toBeNull();
  });

  it("detaches the validated policy from the caller's object", () => {
    const input = buildPolicyInput();
    const result = validateAbstentionPolicy(input);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    input.minCalibratedConfidence = 0.01;
    expect(result.value.minCalibratedConfidence).toBe(0.7);
  });

  it("rejects thresholds outside the unit interval", () => {
    for (const key of [
      "minCalibratedConfidence",
      "minMargin",
      "maxUnknownTokenRatio",
      "minFeatureCoverage",
      "minRetainedRedactionRatio",
    ]) {
      for (const bad of [-0.001, 1.001, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null]) {
        expect(expectInvalid(buildPolicyInput({ [key]: bad })).length).toBeGreaterThan(0);
      }
    }
  });

  it("rejects an inference timeout outside the frozen absolute ceiling", () => {
    expect(validateAbstentionPolicy(buildPolicyInput({ inferenceTimeoutMs: 1 })).valid).toBe(true);
    expect(
      validateAbstentionPolicy(
        buildPolicyInput({
          inferenceTimeoutMs: FC008_SAFETY_CAPS.absoluteInferenceTimeoutCeilingMs,
        }),
      ).valid,
    ).toBe(true);
    for (const bad of [0, -1, 1.5, FC008_SAFETY_CAPS.absoluteInferenceTimeoutCeilingMs + 1]) {
      expect(expectInvalid(buildPolicyInput({ inferenceTimeoutMs: bad })).length).toBeGreaterThan(
        0,
      );
    }
  });

  it("rejects a policy bound to a different support matrix or feature policy", () => {
    expect(expectInvalid(buildPolicyInput({ requiredSupportMatrixVersion: "0.9" }))).toContain(
      "FC008_ENUM_VIOLATION",
    );
    expect(expectInvalid(buildPolicyInput({ requiredFeaturePolicyVersion: "0.9" }))).toContain(
      "FC008_ENUM_VIOLATION",
    );
    expect(buildPolicy().requiredSupportMatrixVersion).toBe(FC008_SUPPORT_MATRIX_VERSION);
    expect(buildPolicy().requiredFeaturePolicyVersion).toBe(FC008_FEATURE_POLICY_VERSION);
  });

  it("rejects unknown keys, including a capability-shaped one", () => {
    for (const key of ["override", "execute", "provider", "weights", "allowVerified"]) {
      expect(expectInvalid(buildPolicyInput({ [key]: true }))).toContain("FC008_UNKNOWN_KEY");
    }
  });

  it("rejects a non-plain object and a hostile prototype", () => {
    class Hostile {}
    expect(expectInvalid(Object.assign(new Hostile(), buildPolicyInput()))).toContain(
      "FC008_NOT_PLAIN_OBJECT",
    );
    for (const bad of [null, undefined, [], "policy", 1]) {
      expect(expectInvalid(bad)).toContain("FC008_NOT_PLAIN_OBJECT");
    }
  });

  it("fails closed rather than throwing on a hostile getter", () => {
    const input = buildPolicyInput();
    Object.defineProperty(input, "minMargin", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("hostile");
      },
    });
    expect(expectInvalid(input)).toContain("FC008_ACCESSOR_PROPERTY");
  });
});

describe("neither a provider nor a page can mutate the active policy", () => {
  it("rejects a write to a frozen policy and leaves the runtime decision unchanged", () => {
    const policy = buildPolicy({ minCalibratedConfidence: 0.99 });
    expect(() => {
      (policy as unknown as Record<string, unknown>).minCalibratedConfidence = 0;
    }).toThrow(TypeError);
    expect(policy.minCalibratedConfidence).toBe(0.99);
  });

  it("ignores a provider's attempt to lower the bar during scoring", () => {
    const policy = buildPolicy({ minCalibratedConfidence: 0.999999, minMargin: 0 });
    const saboteur = createStubProvider();
    const originalScore = saboteur.score.bind(saboteur);
    const provider = {
      providerId: saboteur.providerId,
      score(
        semantics: Parameters<typeof originalScore>[0],
        context: Parameters<typeof originalScore>[1],
      ) {
        // A provider holds no reference to the policy, so the only thing it can
        // try is to mutate what it was given. Nothing it does reaches the policy.
        try {
          (context as unknown as Record<string, unknown>).minCalibratedConfidence = 0;
        } catch {
          // frozen context
        }
        return originalScore(semantics, context);
      },
    };

    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ policy, provider }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("LOW_CONFIDENCE");
    expect(policy.minCalibratedConfidence).toBe(0.999999);
  });

  it("applies a stricter policy to the same scores, proving the runtime decides", () => {
    const observation = buildObservationInput();
    const permissive = evaluateObservation(
      observation,
      buildRuntimeDeps({ policy: buildPolicy({ minCalibratedConfidence: 0.5, minMargin: 0 }) }),
    );
    const strict = evaluateObservation(
      observation,
      buildRuntimeDeps({
        policy: buildPolicy({ minCalibratedConfidence: 0.999999, minMargin: 0 }),
      }),
    );
    expect(isHypothesisResult(permissive)).toBe(true);
    expect(isAbstainedResult(strict) && strict.reason).toBe("LOW_CONFIDENCE");
  });
});

describe("policy version binding", () => {
  it("fails as MODEL_VERSION_MISMATCH when the observation names another policy", () => {
    const result = evaluateObservation(
      buildObservationInput({ freshness: { abstentionPolicyVersion: "other-policy" } }),
      buildRuntimeDeps(),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });

  it("records the active policy version on an accepted hypothesis", () => {
    const result = evaluateObservation(buildObservationInput(), buildRuntimeDeps());
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    expect(result.hypothesis.provenance.abstentionPolicyVersion).toBe(buildPolicy().policyVersion);
  });
});

describe("hard bounds", () => {
  it("is versioned and deeply frozen", () => {
    expect(bounds.FC008_BOUNDS_VERSION).toBe("1.0");
    expect(Object.isFrozen(FC008_SAFETY_CAPS)).toBe(true);
    expect(() => {
      (FC008_SAFETY_CAPS as unknown as Record<string, number>).maxTotalTokens = 10_000;
    }).toThrow(TypeError);
  });

  it("declares every cap as a positive finite number", () => {
    for (const [key, value] of Object.entries(FC008_SAFETY_CAPS)) {
      expect(Number.isFinite(value), key).toBe(true);
      expect(value, key).toBeGreaterThan(0);
    }
  });

  it("keeps the per-channel cap below the total cap", () => {
    expect(FC008_SAFETY_CAPS.maxTokensPerChannel).toBeLessThan(FC008_SAFETY_CAPS.maxTotalTokens);
    expect(FC008_SAFETY_CAPS.maxStateTokens).toBeLessThan(FC008_SAFETY_CAPS.maxTotalTokens);
  });

  it("keeps the joint class count equal to the supported tuple count", () => {
    expect(FC008_SAFETY_CAPS.jointModelClasses).toBe(13);
  });

  it("names exactly the three measure-then-freeze targets", () => {
    expect(Object.isFrozen(FC008_MEASURE_THEN_FREEZE_TARGETS)).toBe(true);
    expect(FC008_MEASURE_THEN_FREEZE_TARGETS.map((t) => t.target)).toEqual([
      "releasedArtifactSizeBytes",
      "operationalInferenceTimeoutMs",
      "probabilityParityTolerance",
    ]);
  });

  it("bounds each unmeasured target by a frozen absolute cap that actually exists", () => {
    for (const target of FC008_MEASURE_THEN_FREEZE_TARGETS) {
      expect(Object.isFrozen(target)).toBe(true);
      const cap = (FC008_SAFETY_CAPS as unknown as Record<string, number>)[target.boundedBy];
      expect(cap, target.boundedBy).toBeGreaterThan(0);
      expect(target.measuredIn.length).toBeGreaterThan(0);
      expect(target.frozenBefore.length).toBeGreaterThan(0);
    }
  });

  it("invents no measured value in Sprint 1", () => {
    // Sprint 1 measures nothing, so each target records only where it will be
    // measured, when it is frozen, and the cap it may never exceed.
    for (const target of FC008_MEASURE_THEN_FREEZE_TARGETS) {
      expect(Object.keys(target).sort()).toEqual([
        "boundedBy",
        "frozenBefore",
        "measuredIn",
        "target",
      ]);
    }
  });

  it("points the three targets at the three absolute ceilings", () => {
    expect(FC008_MEASURE_THEN_FREEZE_TARGETS.map((t) => t.boundedBy)).toEqual([
      "absoluteArtifactCeilingBytes",
      "absoluteInferenceTimeoutCeilingMs",
      "maxAcceptableProbabilityParityCeiling",
    ]);
  });
});
