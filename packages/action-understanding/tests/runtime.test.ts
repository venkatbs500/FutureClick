import { describe, expect, it } from "vitest";
import { FC008_SAFETY_CAPS } from "../src/bounds.js";
import { isAbstainedResult, isFailedResult, isHypothesisResult } from "../src/result.js";
import * as runtimeModule from "../src/runtime.js";
import { PROBABILITY_SUM_TOLERANCE, evaluateObservation } from "../src/runtime.js";
import { FC008_SUPPORT_MATRIX, FC008_SUPPORTED_TUPLE_COUNT } from "../src/support-matrix.js";
import {
  FC008_SUPPORT_OUTCOME_MAPPING,
  NOVELTY_CHECK_CODES,
  SUPPORT_CHECK_CODES,
  outcomeForSupportCheck,
  verifyOutcomeMapping,
} from "../src/outcome-mapping.js";
import {
  assessSupport,
  computeFeatureCoverage,
  countUnknownCategoricals,
  hasMinimumSemanticEvidence,
  representedRequiredGroups,
} from "../src/support.js";
import { findNonInertPath, findUnfrozenPath } from "../src/validation.js";
import {
  at,
  buildArtifact,
  buildCalibratedScores,
  buildFactorizedScores,
  buildObservationInput,
  buildPolicy,
  buildRuntimeDeps,
  buildSemantics,
  confidentLogits,
  createStubCalibrator,
  createStubProvider,
} from "./helpers.js";
import { createScriptedClock } from "../src/timing.js";
import { FC008_FEATURE_POLICY_VERSION, type FeatureVocabulary } from "../src/feature-policy.js";
import type { SupportAssessmentContext } from "../src/support.js";

/** A fitted vocabulary containing exactly the named features. */
function buildVocabulary(features: readonly string[]): FeatureVocabulary {
  return {
    vocabularyVersion: "test-vocab-1",
    featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
    entries: new Map(features.map((name, index) => [name, index] as const)),
    size: features.length,
  };
}

/** Runtime-held context for a fully supported observation, with no vocabulary. */
const FULL_SUPPORT_CONTEXT: SupportAssessmentContext = {
  vocabulary: null,
  schemaVersionsMatched: true,
  supportedTupleResolved: true,
};

describe("Sprint 1 ships the calibration interface but no calibrator", () => {
  it("exports no calibrator implementation or factory", () => {
    // The numeric transform lands in Sprint 4 with the golden Python and
    // TypeScript parity vectors that are the only honest way to validate it.
    const runtimeValues = Object.entries(runtimeModule).filter(
      ([, value]) => typeof value === "function" || typeof value === "object",
    );
    const names = runtimeValues.map(([name]) => name);
    expect(names).toEqual(["evaluateObservation"]);
    for (const name of names) {
      expect(name.toLowerCase()).not.toContain("calibrat");
      expect(name.toLowerCase()).not.toContain("softmax");
      expect(name.toLowerCase()).not.toContain("temperature");
    }
  });

  it("declares the probability sum tolerance for the Sprint 4 implementation", () => {
    expect(PROBABILITY_SUM_TOLERANCE).toBe(1e-6);
    expect(PROBABILITY_SUM_TOLERANCE).toBeLessThanOrEqual(
      FC008_SAFETY_CAPS.maxAcceptableProbabilityParityCeiling,
    );
  });

  it("requires an injected calibrator, so the runtime never calibrates itself", () => {
    const deps = buildRuntimeDeps();
    expect(typeof deps.calibrator.calibrate).toBe("function");
    expect("calibrate" in runtimeModule).toBe(false);
  });
});

describe("runtime-owned calibration validation", () => {
  it("rejects a probability vector of the wrong length", () => {
    for (const length of [0, 12, 14]) {
      const result = evaluateObservation(
        buildObservationInput(),
        buildRuntimeDeps({
          calibrator: createStubCalibrator({
            outcome: {
              status: "calibrated",
              scores: buildCalibratedScores({
                probabilities: new Array<number>(length).fill(1 / Math.max(length, 1)),
              }),
            },
          }),
        }),
      );
      expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
    }
  });

  it("rejects a distribution that does not sum to one", () => {
    const probabilities = new Array<number>(FC008_SUPPORTED_TUPLE_COUNT).fill(0);
    probabilities[0] = 0.5;
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        calibrator: createStubCalibrator({
          outcome: { status: "calibrated", scores: buildCalibratedScores({ probabilities }) },
        }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
  });

  it("rejects out-of-range calibration metadata", () => {
    const probabilities = new Array<number>(FC008_SUPPORTED_TUPLE_COUNT).fill(
      1 / FC008_SUPPORTED_TUPLE_COUNT,
    );
    for (const patch of [
      { temperature: 0 },
      { temperature: -1 },
      { uncalibratedMaxProbability: 1.5 },
      { unsupportedCombinationMass: -0.1 },
      { unsupportedCombinationMass: 1.1 },
    ]) {
      const result = evaluateObservation(
        buildObservationInput(),
        buildRuntimeDeps({
          calibrator: createStubCalibrator({
            outcome: {
              status: "calibrated",
              scores: buildCalibratedScores({ probabilities, ...patch }),
            },
          }),
        }),
      );
      expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
    }
  });

  it("treats a calibrator error or throw as an operational failure", () => {
    for (const calibrator of [
      createStubCalibrator({ throws: true }),
      createStubCalibrator({ outcome: { status: "error", detail: "no artifact" } }),
    ]) {
      const result = evaluateObservation(buildObservationInput(), buildRuntimeDeps({ calibrator }));
      expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
    }
  });
});

describe("runtime determinism", () => {
  it("returns an identical accepted hypothesis for identical input", () => {
    const observation = buildObservationInput();
    const first = evaluateObservation(observation, buildRuntimeDeps());
    const second = evaluateObservation(observation, buildRuntimeDeps());
    expect(isHypothesisResult(first) && isHypothesisResult(second)).toBe(true);
    if (!isHypothesisResult(first) || !isHypothesisResult(second)) {
      return;
    }
    expect(first.hypothesis).toEqual(second.hypothesis);
  });

  it("breaks probability ties by ascending class index", () => {
    // A uniform distribution over all thirteen classes: every probability is
    // equal, so the deterministic tie-break must select class number 1, which
    // is array index 0.
    const probabilities = new Array<number>(FC008_SUPPORTED_TUPLE_COUNT).fill(
      1 / FC008_SUPPORTED_TUPLE_COUNT,
    );
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ minCalibratedConfidence: 0.01, minMargin: 0 }),
        calibrator: createStubCalibrator({
          outcome: { status: "calibrated", scores: buildCalibratedScores({ probabilities }) },
        }),
      }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    expect(result.hypothesis.tuple).toEqual(at(FC008_SUPPORT_MATRIX, 0).tuple);
    expect(result.hypothesis.alternatives.map((a) => a.tuple)).toEqual([
      at(FC008_SUPPORT_MATRIX, 1).tuple,
      at(FC008_SUPPORT_MATRIX, 2).tuple,
      at(FC008_SUPPORT_MATRIX, 3).tuple,
    ]);
  });

  it("maps the top class to the matching support matrix tuple", () => {
    for (const classIndex of [0, 5, 7, 12]) {
      const result = evaluateObservation(
        buildObservationInput(),
        buildRuntimeDeps({
          provider: createStubProvider({ logits: confidentLogits(classIndex) }),
        }),
      );
      expect(isHypothesisResult(result)).toBe(true);
      if (!isHypothesisResult(result)) {
        continue;
      }
      expect(result.hypothesis.tuple).toEqual(at(FC008_SUPPORT_MATRIX, classIndex).tuple);
    }
  });

  it("caps alternatives at the frozen maximum", () => {
    const result = evaluateObservation(buildObservationInput(), buildRuntimeDeps());
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    expect(result.hypothesis.alternatives.length).toBeLessThanOrEqual(
      FC008_SAFETY_CAPS.maxAlternatives,
    );
  });

  it("returns a deeply frozen, inert result on every path", () => {
    const deps = [
      buildRuntimeDeps(),
      buildRuntimeDeps({ artifact: null }),
      buildRuntimeDeps({ provider: createStubProvider({ throws: true }) }),
      buildRuntimeDeps({ policy: buildPolicy({ minCalibratedConfidence: 0.999999 }) }),
    ];
    for (const dep of deps) {
      const result = evaluateObservation(buildObservationInput(), dep);
      expect(findUnfrozenPath(result)).toBeNull();
      expect(findNonInertPath(result)).toBeNull();
    }
  });
});

describe("research diagnostics are emitted only in research mode", () => {
  it("emits no diagnostics by default", () => {
    const result = evaluateObservation(buildObservationInput(), buildRuntimeDeps());
    expect(isHypothesisResult(result) && result.diagnostics).toBeNull();
  });

  it("emits diagnostics only when research mode is explicitly enabled", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ researchMode: true }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    expect(result.diagnostics).not.toBeNull();
    expect(Object.keys(result.diagnostics ?? {}).sort()).toEqual([
      "entropy",
      "latencyMs",
      "margin",
      "modelConfidence",
      "unsupportedCombinationMass",
    ]);
  });

  it("keeps diagnostics off the hypothesis itself even in research mode", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ researchMode: true }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    for (const key of ["modelConfidence", "margin", "entropy", "latencyMs", "logits"]) {
      expect(key in result.hypothesis).toBe(false);
    }
    expect(Object.keys(result.hypothesis.confidence).sort()).toEqual([
      "calibratedConfidence",
      "calibrationArtifactVersion",
      "calibrationMethod",
    ]);
  });

  it("emits diagnostics on an abstention in research mode too", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        researchMode: true,
        policy: buildPolicy({ minCalibratedConfidence: 0.999999, minMargin: 0 }),
      }),
    );
    expect(isAbstainedResult(result) && result.diagnostics).not.toBeNull();
  });

  it("reports normalised entropy within the unit interval", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ researchMode: true }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    const entropy = result.diagnostics?.entropy ?? -1;
    expect(entropy).toBeGreaterThanOrEqual(0);
    expect(entropy).toBeLessThanOrEqual(1);
  });
});

describe("support diagnostics are deterministic, never probabilistic", () => {
  it("declares nine deterministic novelty check codes", () => {
    expect(NOVELTY_CHECK_CODES).toHaveLength(9);
    expect(Object.isFrozen(NOVELTY_CHECK_CODES)).toBe(true);
  });

  it("names no distance or density measure, so no statistical OOD claim is made", () => {
    const joined = NOVELTY_CHECK_CODES.join(" ").toLowerCase();
    for (const forbidden of ["mahalanobis", "distance", "norm", "density", "likelihood", "ood"]) {
      expect(joined).not.toContain(forbidden);
    }
  });

  it("exposes no confidence or probability field", () => {
    const diagnostics = assessSupport(buildSemantics(), FULL_SUPPORT_CONTEXT);
    for (const key of ["confidence", "probability", "score", "logit", "distance", "novelty"]) {
      expect(key in diagnostics).toBe(false);
    }
    expect(Object.isFrozen(diagnostics)).toBe(true);
  });

  it("reports the unknown-token ratio as unavailable until a vocabulary is loaded", () => {
    // The ratio needs a fitted vocabulary, which is a Sprint 3 artifact. Sprint 1
    // says so rather than reporting a zero ratio as though the check had passed.
    const diagnostics = assessSupport(buildSemantics(), FULL_SUPPORT_CONTEXT);
    expect(diagnostics.unknownTokenRatioAvailable).toBe(false);
    expect(diagnostics.unknownTokenRatio).toBe(0);
  });

  it("computes the ratio from the loaded vocabulary once one exists", () => {
    const semantics = buildSemantics({
      tokens: [
        { channel: "ctl", value: "make" },
        { channel: "ctl", value: "public" },
        { channel: "acc", value: "unseen-token" },
        { channel: "acc", value: "another-unseen" },
      ],
    });
    const vocabulary = buildVocabulary(["tok:ctl:make", "tok:ctl:public"]);
    const diagnostics = assessSupport(semantics, { ...FULL_SUPPORT_CONTEXT, vocabulary });
    expect(diagnostics.unknownTokenRatioAvailable).toBe(true);
    expect(diagnostics.unknownTokenRatio).toBe(0.5);
  });

  it("reports a zero ratio when no token was considered, rather than dividing by zero", () => {
    const diagnostics = assessSupport(buildSemantics({ tokens: [] }), {
      ...FULL_SUPPORT_CONTEXT,
      vocabulary: buildVocabulary([]),
    });
    expect(diagnostics.unknownTokenRatio).toBe(0);
  });

  it("counts a categorical that resolved to the vocabulary escape hatch", () => {
    expect(countUnknownCategoricals(buildSemantics())).toBe(0);
    expect(countUnknownCategoricals(buildSemantics({ interactionKind: "other" }))).toBe(1);
    expect(
      countUnknownCategoricals(buildSemantics({ interactionKind: "other", surfaceKind: "other" })),
    ).toBe(2);
  });

  it("derives feature coverage from the six required semantic groups", () => {
    const full = buildSemantics();
    expect(representedRequiredGroups(full)).toHaveLength(6);
    expect(computeFeatureCoverage(full)).toBe(1);

    const thin = buildSemantics({
      tokens: [{ channel: "ctl", value: "x" }],
      stateTokens: [],
      objectKindEvidence: [],
    });
    expect(computeFeatureCoverage(thin)).toBeLessThan(1);
    expect(computeFeatureCoverage(thin)).toBeGreaterThan(0);
  });

  it("requires a control or accessible-name token as minimum semantic evidence", () => {
    expect(hasMinimumSemanticEvidence(buildSemantics())).toBe(true);
    expect(
      hasMinimumSemanticEvidence(buildSemantics({ tokens: [{ channel: "acc", value: "x" }] })),
    ).toBe(true);
    expect(
      hasMinimumSemanticEvidence(buildSemantics({ tokens: [{ channel: "hd", value: "x" }] })),
    ).toBe(false);
    expect(hasMinimumSemanticEvidence(buildSemantics({ tokens: [] }))).toBe(false);
  });

  it("carries support diagnostics onto an accepted hypothesis", () => {
    const result = evaluateObservation(buildObservationInput(), buildRuntimeDeps());
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    expect(result.hypothesis.support.requiredFeatureGroupsTotal).toBe(6);
    expect(result.hypothesis.support.supportedTupleResolved).toBe(true);
  });
});

describe("the runtime never throws", () => {
  it("returns INTERNAL_ERROR instead of propagating an unexpected throw", () => {
    const hostileDeps = buildRuntimeDeps({
      freshnessValidator: {
        isCurrent() {
          throw new Error("boom");
        },
      },
    });
    expect(() => evaluateObservation(buildObservationInput(), hostileDeps)).not.toThrow();
  });

  it("survives hostile input shapes without throwing", () => {
    const hostile: unknown[] = [
      null,
      undefined,
      0,
      "",
      [],
      () => undefined,
      Symbol("x"),
      new Map(),
      new Proxy(
        {},
        {
          get() {
            throw new Error("hostile proxy");
          },
          ownKeys() {
            throw new Error("hostile proxy keys");
          },
        },
      ),
    ];
    for (const input of hostile) {
      expect(() => evaluateObservation(input, buildRuntimeDeps())).not.toThrow();
      const result = evaluateObservation(input, buildRuntimeDeps());
      expect(result.outcome).toBe("failed");
    }
  });

  it("returns INTERNAL_ERROR when the id generator misbehaves", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        idGenerator: {
          generate: () => "not a valid id!!" as never,
          nextId: () => "not a valid id!!" as never,
        },
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
  });
});
