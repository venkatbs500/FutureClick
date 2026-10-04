import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAILURE_REASONS, FAILURE_STAGES } from "../src/failure-detail.js";
import {
  type ActionObservation,
  type ObservationSemantics,
  validateActionObservation,
} from "../src/observation.js";
import {
  MAX_ABSOLUTE_LOGIT,
  PROVIDER_DIAGNOSTICS,
  PROVIDER_OUTCOME_STATUSES,
  type ProviderScoringContext,
  type ScoringProvider,
  createProviderScoringContext,
  validateProviderOutcome,
} from "../src/provider.js";
import { NULL_PROVIDER_DETAIL, createNullScoringProvider } from "../src/providers/null-provider.js";
import { isFailedResult, isHypothesisResult } from "../src/result.js";
import { evaluateObservation } from "../src/runtime.js";
import {
  FC008_MATRIX_OBJECT_KIND_COUNT,
  FC008_MATRIX_TRANSITION_PROPERTY_COUNT,
  FC008_MATRIX_VERB_COUNT,
  FC008_SUPPORT_MATRIX,
  FC008_SUPPORTED_TUPLE_COUNT,
} from "../src/support-matrix.js";
import {
  buildArtifact,
  buildFactorizedScores,
  buildObservationInput,
  buildRuntimeDeps,
  buildSemantics,
  confidentLogits,
  createStubProvider,
} from "./helpers.js";

type AssertTrue<T extends true> = T;
type AssertFalse<T extends false> = T;
type HasKey<O, K extends string> = K extends keyof O ? true : false;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

// A provider sees Layer B only, exactly like a projector.
type ScoreParams = Parameters<ScoringProvider["score"]>;
type _FirstParamIsSemantics = AssertTrue<Equals<ScoreParams[0], ObservationSemantics>>;
type _FirstParamIsNotObservation = AssertFalse<Equals<ScoreParams[0], ActionObservation>>;

// A provider is told versions and nothing else: there is no threshold to apply.
type _ContextIsVersionsOnly = AssertTrue<
  Equals<keyof ProviderScoringContext, "supportMatrixVersion" | "featurePolicyVersion">
>;
type _NoThresholdInContext = AssertFalse<HasKey<ProviderScoringContext, "minCalibratedConfidence">>;
type _NoMarginInContext = AssertFalse<HasKey<ProviderScoringContext, "minMargin">>;
type _NoPolicyInContext = AssertFalse<HasKey<ProviderScoringContext, "policy">>;
type _NoThresholdsInContext = AssertFalse<HasKey<ProviderScoringContext, "thresholds">>;
type _NoCalibrationInContext = AssertFalse<HasKey<ProviderScoringContext, "calibration">>;
type _NoTemperatureInContext = AssertFalse<HasKey<ProviderScoringContext, "temperature">>;
type _NoObservationInContext = AssertFalse<HasKey<ProviderScoringContext, "observation">>;
type _NoAcquisitionInContext = AssertFalse<HasKey<ProviderScoringContext, "acquisition">>;
type _NoBenchmarkInContext = AssertFalse<HasKey<ProviderScoringContext, "benchmark">>;

// A provider returns scores. The outcome union has no hypothesis-bearing member.
type ScoreReturn = ReturnType<ScoringProvider["score"]>;
type _NoHypothesisInOutcome = AssertFalse<HasKey<ScoreReturn, "hypothesis">>;
type _NoEvidenceModeInOutcome = AssertFalse<HasKey<ScoreReturn, "evidenceMode">>;
type _NoAcceptedInOutcome = AssertFalse<HasKey<ScoreReturn, "accepted">>;
type _NoProbabilitiesInOutcome = AssertFalse<HasKey<ScoreReturn, "probabilities">>;
type _NoCalibratedConfidence = AssertFalse<HasKey<ScoreReturn, "calibratedConfidence">>;
type _NoAbstentionInOutcome = AssertFalse<HasKey<ScoreReturn, "abstained">>;
type _NoThresholdsInOutcome = AssertFalse<HasKey<ScoreReturn, "thresholds">>;
type _NoSupportInOutcome = AssertFalse<HasKey<ScoreReturn, "support">>;
type _NoEvidenceInOutcome = AssertFalse<HasKey<ScoreReturn, "evidence">>;
type _NoReleaseInOutcome = AssertFalse<HasKey<ScoreReturn, "release">>;

function expectInvalid(input: unknown): readonly string[] {
  const result = validateProviderOutcome(input);
  expect(result.valid).toBe(false);
  return result.issues.map((i) => i.code);
}

/** A valid JOINT-family scored outcome, with `overrides` spliced into `scores`. */
function scoredOutcome(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "scored",
    scores: {
      scores: { family: "joint-logistic", tupleLogits: confidentLogits() },
      artifact: { ...buildArtifact() },
      ...overrides,
    },
  };
}

/** A valid FACTORIZED-family scored outcome with all three heads present. */
function factorizedOutcome(scoreOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "scored",
    scores: {
      scores: { ...buildFactorizedScores(), ...scoreOverrides },
      artifact: { ...buildArtifact({ modelFamily: "factorized-logistic" }) },
    },
  };
}

describe("provider scoring context carries no authority", () => {
  it("exposes only the two version fields at runtime", () => {
    const context = createProviderScoringContext();
    expect(Object.keys(context).sort()).toEqual(["featurePolicyVersion", "supportMatrixVersion"]);
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("declares exactly the five outcome statuses", () => {
    expect(PROVIDER_OUTCOME_STATUSES).toEqual([
      "scored",
      "unavailable",
      "timeout",
      "version-mismatch",
      "error",
    ]);
  });

  it("hands the provider Layer B only, with no other layer reachable", () => {
    let seen: unknown;
    const observer: ScoringProvider = {
      providerId: "observer",
      score(semantics, context) {
        seen = { semantics, context };
        return { status: "unavailable", detail: "not-implemented" };
      },
    };
    evaluateObservation(buildObservationInput(), buildRuntimeDeps({ provider: observer }));

    const captured = seen as { semantics: Record<string, unknown>; context: object };
    for (const key of ["acquisition", "benchmark", "display", "freshness", "redaction", "id"]) {
      expect(key in captured.semantics).toBe(false);
    }
    expect(Object.keys(captured.context).sort()).toEqual([
      "featurePolicyVersion",
      "supportMatrixVersion",
    ]);
  });
});

describe("a provider cannot self-certify a result", () => {
  it("rejects an outcome carrying a hypothesis", () => {
    const outcome = scoredOutcome();
    (outcome as Record<string, unknown>).hypothesis = { evidenceMode: "verified" };
    expect(expectInvalid(outcome)).toContain("FC008_UNKNOWN_KEY");
  });

  it("rejects an outcome asserting an evidence mode", () => {
    for (const key of ["evidenceMode", "verified", "accepted", "decision"]) {
      const outcome = scoredOutcome();
      (outcome as Record<string, unknown>)[key] = "verified";
      expect(expectInvalid(outcome)).toContain("FC008_UNKNOWN_KEY");
    }
  });

  it("rejects an outcome supplying its own acceptance policy or thresholds", () => {
    for (const key of ["policy", "thresholds", "minCalibratedConfidence", "abstain"]) {
      const outcome = scoredOutcome();
      (outcome as Record<string, unknown>)[key] = 0.99;
      expect(expectInvalid(outcome)).toContain("FC008_UNKNOWN_KEY");
    }
  });

  it("rejects calibrated probabilities inside the score set", () => {
    for (const key of ["probabilities", "calibratedConfidence", "temperature"]) {
      expect(expectInvalid(scoredOutcome({ [key]: 0.99 }))).toContain("FC008_UNKNOWN_KEY");
    }
  });

  it("rejects an executor, element, or callback smuggled into the outcome", () => {
    for (const key of ["execute", "element", "callback", "releaseToken"]) {
      const outcome = scoredOutcome();
      (outcome as Record<string, unknown>)[key] = () => undefined;
      expect(expectInvalid(outcome)).toContain("FC008_UNKNOWN_KEY");
    }
  });

  it("turns a self-certifying provider into an operational failure, not a hypothesis", () => {
    const hostile: ScoringProvider = {
      providerId: "hostile",
      score() {
        return {
          status: "scored",
          scores: scoredOutcome().scores,
          hypothesis: { evidenceMode: "verified" },
        } as never;
      },
    };
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ provider: hostile }),
    );
    expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
    expect(isHypothesisResult(result)).toBe(false);
  });

  it("ignores a provider's artifact claim when it diverges from the loaded artifact", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        provider: createStubProvider({
          artifact: buildArtifact({ artifactSha256: "b".repeat(64) }),
        }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });

  it("takes provenance from the loaded artifact, never from the provider", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact: buildArtifact({ modelFamily: "joint-logistic", modelVersion: "m-1" }),
        provider: createStubProvider({
          artifact: buildArtifact({ modelFamily: "joint-logistic", modelVersion: "m-1" }),
        }),
      }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    expect(result.hypothesis.provenance.modelVersion).toBe("m-1");
    expect(result.hypothesis.provenance.source).toBe("model");
  });
});

describe("the score union supports both planned model families", () => {
  it("accepts a joint-family payload of exactly one logit per supported tuple", () => {
    expect(FC008_SUPPORTED_TUPLE_COUNT).toBe(FC008_SUPPORT_MATRIX.length);
    expect(FC008_SUPPORTED_TUPLE_COUNT).toBe(13);
    expect(validateProviderOutcome(scoredOutcome()).valid).toBe(true);
  });

  it("accepts a factorized-family payload with all three heads", () => {
    const result = validateProviderOutcome(factorizedOutcome());
    expect(result.valid).toBe(true);
    if (!result.valid || result.value.status !== "scored") {
      return;
    }
    const scores = result.value.scores.scores;
    expect(scores.family).toBe("factorized-logistic");
    if (scores.family !== "factorized-logistic") {
      return;
    }
    // All three heads survive the boundary losslessly, so RQ1 can inspect them
    // and a later sprint can define composition over them.
    expect(scores.verbLogits).toHaveLength(FC008_MATRIX_VERB_COUNT);
    expect(scores.objectLogits).toHaveLength(FC008_MATRIX_OBJECT_KIND_COUNT);
    expect(scores.transitionLogits).toHaveLength(FC008_MATRIX_TRANSITION_PROPERTY_COUNT);
  });

  it("pins the three factorized head sizes at 10, 9, and 10", () => {
    expect(FC008_MATRIX_VERB_COUNT).toBe(10);
    expect(FC008_MATRIX_OBJECT_KIND_COUNT).toBe(9);
    expect(FC008_MATRIX_TRANSITION_PROPERTY_COUNT).toBe(10);
  });

  it("requires the exact head length for every factorized head", () => {
    // A short head is an invariant violation; an over-long one is stopped by the
    // capture bound before it is even read.
    for (const [key, size] of [
      ["verbLogits", FC008_MATRIX_VERB_COUNT],
      ["objectLogits", FC008_MATRIX_OBJECT_KIND_COUNT],
      ["transitionLogits", FC008_MATRIX_TRANSITION_PROPERTY_COUNT],
    ] as const) {
      for (const length of [0, size - 1]) {
        expect(
          expectInvalid(factorizedOutcome({ [key]: new Array<number>(length).fill(0) })),
        ).toContain("FC008_INVARIANT_VIOLATION");
      }
      expect(
        expectInvalid(factorizedOutcome({ [key]: new Array<number>(size + 1).fill(0) })),
      ).toContain("FC008_BOUND_EXCEEDED");
    }
  });

  it("requires exactly one logit per supported tuple for the joint family", () => {
    for (const length of [0, 1, 12]) {
      const tupleLogits = new Array<number>(length).fill(0);
      expect(
        expectInvalid(scoredOutcome({ scores: { family: "joint-logistic", tupleLogits } })),
      ).toContain("FC008_INVARIANT_VIOLATION");
    }
    expect(
      expectInvalid(
        scoredOutcome({
          scores: { family: "joint-logistic", tupleLogits: new Array<number>(14).fill(0) },
        }),
      ),
    ).toContain("FC008_BOUND_EXCEEDED");
  });

  it("rejects a payload mixing the two families", () => {
    // Closed per-family shapes, so a joint payload carrying factorized heads (or
    // the reverse) is rejected rather than partially interpreted.
    expect(
      expectInvalid(
        scoredOutcome({
          scores: {
            family: "joint-logistic",
            tupleLogits: confidentLogits(),
            verbLogits: new Array<number>(FC008_MATRIX_VERB_COUNT).fill(0),
          },
        }),
      ),
    ).toContain("FC008_UNKNOWN_KEY");
    expect(expectInvalid(factorizedOutcome({ tupleLogits: confidentLogits() }))).toContain(
      "FC008_UNKNOWN_KEY",
    );
  });

  it("rejects an unknown or missing family tag", () => {
    for (const family of ["linear", "joint", "", undefined]) {
      const result = validateProviderOutcome(
        scoredOutcome({ scores: { family, tupleLogits: confidentLogits() } }),
      );
      expect(result.valid).toBe(false);
    }
  });

  it("rejects a score payload whose family contradicts its own artifact", () => {
    // Self-inconsistency inside the provider's own return value, caught before
    // the runtime compares it with the loaded artifact.
    expect(
      expectInvalid({
        status: "scored",
        scores: {
          scores: { family: "joint-logistic", tupleLogits: confidentLogits() },
          artifact: { ...buildArtifact({ modelFamily: "factorized-logistic" }) },
        },
      }),
    ).toContain("FC008_INVARIANT_VIOLATION");
  });

  it("rejects a non-finite logit in either family", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const tupleLogits = confidentLogits();
      tupleLogits[0] = bad;
      expect(
        expectInvalid(scoredOutcome({ scores: { family: "joint-logistic", tupleLogits } })),
      ).toContain("FC008_TYPE_MISMATCH");

      const verbLogits = new Array<number>(FC008_MATRIX_VERB_COUNT).fill(0);
      verbLogits[0] = bad;
      expect(expectInvalid(factorizedOutcome({ verbLogits }))).toContain("FC008_TYPE_MISMATCH");
    }
  });

  it("rejects a logit beyond the magnitude cap in either family", () => {
    const tupleLogits = confidentLogits();
    tupleLogits[0] = MAX_ABSOLUTE_LOGIT + 1;
    expect(
      expectInvalid(scoredOutcome({ scores: { family: "joint-logistic", tupleLogits } })),
    ).toContain("FC008_BOUND_EXCEEDED");

    const objectLogits = new Array<number>(FC008_MATRIX_OBJECT_KIND_COUNT).fill(0);
    objectLogits[0] = -(MAX_ABSOLUTE_LOGIT + 1);
    expect(expectInvalid(factorizedOutcome({ objectLogits }))).toContain("FC008_BOUND_EXCEEDED");
  });

  it("rejects a non-numeric logit", () => {
    const tupleLogits = confidentLogits() as unknown[];
    tupleLogits[0] = "10";
    expect(
      expectInvalid(scoredOutcome({ scores: { family: "joint-logistic", tupleLogits } })),
    ).toContain("FC008_TYPE_MISMATCH");
  });
});

describe("the runtime defers factorized numerics rather than faking them", () => {
  it("accepts a factorized payload at the boundary and refuses to compose it", () => {
    // Composing three heads into a distribution over the thirteen supported
    // tuples needs supported-set renormalisation and unsupported-combination
    // mass accounting, which are Sprint 3 deliverables. The runtime says so
    // instead of inventing a probability.
    const artifact = buildArtifact({ modelFamily: "factorized-logistic" });
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact,
        provider: createStubProvider({ scores: buildFactorizedScores(), artifact }),
      }),
    );
    expect(isFailedResult(result)).toBe(true);
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.code).toBe("MODEL_UNAVAILABLE");
    expect(result.detail.stage).toBe("composition");
    expect(result.detail.reason).toBe("composition-not-implemented");
  });

  it("returns an operational result, never an abstention or a hypothesis", () => {
    // An unimplemented composition is a system limitation, not a statement
    // about how difficult the input was.
    const artifact = buildArtifact({ modelFamily: "factorized-logistic" });
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact,
        provider: createStubProvider({ scores: buildFactorizedScores(), artifact }),
      }),
    );
    expect(isHypothesisResult(result)).toBe(false);
    expect(result.outcome).toBe("failed");
  });

  it("still validates the factorized heads before deferring", () => {
    // A malformed factorized payload is rejected at validation, so the deferral
    // path cannot be used to smuggle an unvalidated score set past the checks.
    const artifact = buildArtifact({ modelFamily: "factorized-logistic" });
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact,
        provider: createStubProvider({
          scores: buildFactorizedScores({ verbLogits: [0, 0] }),
          artifact,
        }),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
    if (!isFailedResult(result)) {
      return;
    }
    expect(result.detail.stage).toBe("provider-outcome-validation");
  });
});

describe("a provider cannot contribute support or novelty evidence", () => {
  it("rejects an outcome carrying support, coverage, or unknown-token fields", () => {
    // Support evidence is runtime-owned. A provider that could report its own
    // support could turn a refusable input into an accepted hypothesis.
    for (const key of [
      "support",
      "evidence",
      "unknownTokenCount",
      "unknownTokenRatio",
      "consideredTokenCount",
      "unknownCategoricalCount",
      "featureCoverage",
      "supportedTupleResolved",
      "schemaVersionsMatched",
      "novelty",
      "inSupport",
    ]) {
      const outcome = scoredOutcome();
      (outcome.scores as Record<string, unknown>)[key] = 1;
      expect(expectInvalid(outcome)).toContain("FC008_UNKNOWN_KEY");
    }
  });

  it("exposes no support-bearing field on a valid score set", () => {
    const result = validateProviderOutcome(scoredOutcome());
    expect(result.valid).toBe(true);
    if (!result.valid || result.value.status !== "scored") {
      return;
    }
    expect(Object.keys(result.value.scores).sort()).toEqual(["artifact", "scores"]);
  });
});

describe("non-scored provider outcomes", () => {
  it("accepts each non-scored status with a closed diagnostic token", () => {
    for (const status of ["unavailable", "timeout", "version-mismatch", "error"]) {
      expect(validateProviderOutcome({ status, detail: "internal-error" }).valid).toBe(true);
    }
  });

  it("rejects a non-scored outcome that also carries scores", () => {
    expect(
      expectInvalid({
        status: "timeout",
        detail: "deadline-exceeded",
        scores: scoredOutcome().scores,
      }),
    ).toContain("FC008_UNKNOWN_KEY");
  });

  it("rejects free-text detail in favour of the closed vocabulary", () => {
    // A provider must not be able to emit arbitrary text through a failure path,
    // because that text would be page- or model-derived and unbounded.
    for (const detail of ["x".repeat(201), "something went wrong", "", "NOT-IMPLEMENTED"]) {
      expect(expectInvalid({ status: "error", detail })).toContain("FC008_ENUM_VIOLATION");
    }
  });

  it("declares exactly the six diagnostic tokens, frozen", () => {
    expect(PROVIDER_DIAGNOSTICS).toEqual([
      "not-implemented",
      "no-artifact-loaded",
      "artifact-load-failed",
      "deadline-exceeded",
      "version-unsupported",
      "internal-error",
    ]);
    expect(Object.isFrozen(PROVIDER_DIAGNOSTICS)).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(expectInvalid({ status: "accepted", detail: "internal-error" })).toContain(
      "FC008_ENUM_VIOLATION",
    );
  });

  it("fails closed rather than throwing on a hostile getter", () => {
    const outcome: Record<string, unknown> = { status: "scored" };
    Object.defineProperty(outcome, "scores", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("hostile");
      },
    });
    expect(expectInvalid(outcome)).toContain("FC008_ACCESSOR_PROPERTY");
  });
});

describe("the null provider is the Sprint 1 default", () => {
  it("always reports unavailable and never scores", () => {
    const provider = createNullScoringProvider();
    const semantics = buildSemantics();
    for (let i = 0; i < 5; i++) {
      const outcome = provider.score(semantics, createProviderScoringContext());
      expect(outcome.status).toBe("unavailable");
      expect(outcome.status === "unavailable" && outcome.detail).toBe(NULL_PROVIDER_DETAIL);
    }
  });

  it("produces a valid outcome that the runtime maps to MODEL_UNAVAILABLE", () => {
    const provider = createNullScoringProvider();
    expect(
      validateProviderOutcome(provider.score(buildSemantics(), createProviderScoringContext()))
        .valid,
    ).toBe(true);

    const result = evaluateObservation(buildObservationInput(), buildRuntimeDeps({ provider }));
    expect(isFailedResult(result) && result.code).toBe("MODEL_UNAVAILABLE");
  });

  it("can never cause a hypothesis to be emitted", () => {
    const observationResult = validateActionObservation(buildObservationInput());
    expect(observationResult.valid).toBe(true);

    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ provider: createNullScoringProvider() }),
    );
    expect(isHypothesisResult(result)).toBe(false);
  });
});

/**
 * Documentation that names a symbol which does not exist is worse than no
 * documentation: a reader goes looking for a guarantee that was never written.
 */
describe("the provider documentation describes the real deferred path", () => {
  const PROVIDER_SOURCE = readFileSync(new URL("../src/provider.ts", import.meta.url), "utf8");
  const SOURCE_DIR = new URL("../src/", import.meta.url);

  it("names no COMPOSITION_NOT_IMPLEMENTED symbol anywhere in the package source", () => {
    // The symbol never existed. The behaviour it was supposed to name is asserted
    // directly in the identity suite: a valid factorized payload with an agreeing
    // identity yields MODEL_UNAVAILABLE with composition / composition-not-implemented.
    const files = readdirSync(SOURCE_DIR, { recursive: true, encoding: "utf8" }).filter((name) =>
      name.endsWith(".ts"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(new URL(name, SOURCE_DIR), "utf8");
      expect(source.includes("COMPOSITION_NOT_IMPLEMENTED"), name).toBe(false);
    }
  });

  it("states the categorical outcome the runtime actually returns", () => {
    expect(PROVIDER_SOURCE).toContain("MODEL_UNAVAILABLE");
    expect(PROVIDER_SOURCE).toContain("composition-not-implemented");
  });

  it("uses only failure stages and reasons that exist in the frozen vocabularies", () => {
    // Pins the claim made by that comment to the real bounded vocabularies, so a
    // rename cannot leave the documentation naming a token that no longer exists.
    expect(FAILURE_STAGES).toContain("composition");
    expect(FAILURE_REASONS).toContain("composition-not-implemented");
  });
});
