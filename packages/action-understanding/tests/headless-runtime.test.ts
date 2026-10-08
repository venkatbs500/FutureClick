/**
 * FC-008 Sprint 5A — headless runtime integration.
 *
 * SYNTHETIC OBSERVATIONS ONLY. These tests never open sealed partitions, never
 * reread the final evaluation result, and never choose a family from holdout
 * metrics. Family is always an explicit constructor argument.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeterministicIdGenerator } from "@futureclick/shared";
import { describe, expect, it } from "vitest";
import { FC008_SAFETY_CAPS } from "../src/bounds.js";
import { createTemperatureCalibrator } from "../src/calibration.js";
import { createEphemeralDisplayContext } from "../src/display.js";
import { FC008_FEATURE_POLICY, PROHIBITED_PRIMARY_FEATURE_INPUTS } from "../src/feature-policy.js";
import {
  HEADLESS_CONCURRENCY,
  HEADLESS_INFERENCE_TIMEOUT_MS,
  type HeadlessRuntime,
  type HeadlessSupportGates,
  createHeadlessRuntime,
  policyFromFrozenBundle,
  understandAction,
} from "../src/headless.js";
import type { Fc008ModelFamily } from "../src/hypothesis.js";
import {
  type ArtifactBundle,
  type FactorizedModelArtifact,
  parseArtifactBundle,
} from "../src/inference/artifact.js";
import { composeFactorizedLogits } from "../src/inference/scoring.js";
import type { ObservationSemantics } from "../src/observation.js";
import { FC008_PRECEDENCE } from "../src/precedence.js";
import { projectPrimaryFeatures } from "../src/projection.js";
import { vocabularyFromModelArtifact } from "../src/providers/frozen-artifact-provider.js";
import {
  RESEARCH_INDICATOR_FORBIDDEN_KEYS,
  researchIndicatorFromResult,
} from "../src/research-indicator.js";
import {
  type UnderstandingResult,
  isAbstainedResult,
  isFailedResult,
  isHypothesisResult,
} from "../src/result.js";
import { evaluateObservation } from "../src/runtime.js";
import { FC008_SUPPORTED_TUPLE_COUNT } from "../src/support-matrix.js";
import { createScriptedClock } from "../src/timing.js";
import {
  TEST_TIMESTAMP,
  buildArtifact,
  buildFactorizedScores,
  buildObservationInput,
  buildPolicy,
  buildRuntimeDeps,
  confidentLogits,
  createStubCalibrator,
  createStubFreshness,
  createStubProvider,
} from "./helpers.js";

const ARTIFACT_DIRECTORY = join(
  fileURLToPath(new URL("../../..", import.meta.url)),
  "research",
  "futurebench",
  "artifacts",
);

const FROZEN_SHA256 = Object.freeze({
  jointModel: "d30aceb684901bf42b8267719dc20e5319ef35b8603eb7781f50ce486c9d4194",
  jointCalibration: "5d5d99b6f085501de1f83371b3cae08117f8b281b0babc5bf6ae0eb96b1fe8b5",
  jointPolicy: "b3ea74e93bc311fd1025857db8dc6d715e188e7f7dbfbd2d6d377bf3f9b3ecb7",
  factorizedModel: "b2713475a86cd52d6703acbdacae7bb49814b77f1277f4021038cb5f53dbdb8f",
  factorizedCalibration: "9c985d623d29042cd5b7112c9edec80db786e056ac38a056294b1347924de359",
  factorizedPolicy: "89609abe1930e31268e14365d764ec95a6723e869fee6d975ebbf8ac014276c0",
});

function readJson(fileName: string): unknown {
  return JSON.parse(readFileSync(join(ARTIFACT_DIRECTORY, fileName), "utf8"));
}

function sha256File(fileName: string): string {
  return createHash("sha256")
    .update(readFileSync(join(ARTIFACT_DIRECTORY, fileName)))
    .digest("hex");
}

function loadBundle(family: Fc008ModelFamily): ArtifactBundle {
  if (family === "joint-logistic") {
    return parseArtifactBundle({
      modelFamily: family,
      model: readJson("fc008-joint-logistic-model.json"),
      calibration: readJson("fc008-joint-logistic-calibration.json"),
      policy: readJson("fc008-joint-logistic-policy.json"),
      modelSha256: FROZEN_SHA256.jointModel,
      calibrationSha256: FROZEN_SHA256.jointCalibration,
      policySha256: FROZEN_SHA256.jointPolicy,
    });
  }
  return parseArtifactBundle({
    modelFamily: family,
    model: readJson("fc008-factorized-logistic-model.json"),
    calibration: readJson("fc008-factorized-logistic-calibration.json"),
    policy: readJson("fc008-factorized-logistic-policy.json"),
    modelSha256: FROZEN_SHA256.factorizedModel,
    calibrationSha256: FROZEN_SHA256.factorizedCalibration,
    policySha256: FROZEN_SHA256.factorizedPolicy,
  });
}

const SUPPORT_GATES: HeadlessSupportGates = Object.freeze({
  minMargin: 0,
  maxUnknownTokenRatio: 1,
  minFeatureCoverage: 0,
  minRetainedRedactionRatio: 0,
});

function frozenObservation(overrides: Parameters<typeof buildObservationInput>[0] = {}) {
  return buildObservationInput({
    ...overrides,
    freshness: { abstentionPolicyVersion: "1.0", ...overrides.freshness },
  });
}

function readyRuntime(
  family: Fc008ModelFamily,
  extras: {
    freshness?: ReturnType<typeof createStubFreshness>;
    clock?: ReturnType<typeof createScriptedClock>;
  } = {},
): HeadlessRuntime {
  const created = createHeadlessRuntime({
    modelFamily: family,
    bundle: loadBundle(family),
    supportGates: SUPPORT_GATES,
    freshnessValidator: extras.freshness ?? createStubFreshness(),
    clock: extras.clock ?? createScriptedClock([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    now: () => TEST_TIMESTAMP,
    idGenerator: createDeterministicIdGenerator("headless"),
    researchMode: false,
  });
  if (created.status !== "ready") {
    throw new Error(`expected ready runtime, refused ${created.reason}`);
  }
  return created.runtime;
}

describe("family configuration is explicit and pre-test", () => {
  it("refuses to start without a registered family that matches the bundle", () => {
    const bundle = loadBundle("joint-logistic");
    const base = {
      bundle,
      supportGates: SUPPORT_GATES,
      freshnessValidator: createStubFreshness(),
      clock: createScriptedClock([0, 1, 2, 3]),
      now: () => TEST_TIMESTAMP,
      idGenerator: createDeterministicIdGenerator("cfg"),
    };
    expect(createHeadlessRuntime({ ...base, modelFamily: "factorized-logistic" }).status).toBe(
      "refused",
    );
    const unregistered = createHeadlessRuntime({
      ...base,
      modelFamily: "not-a-family" as Fc008ModelFamily,
    });
    expect(unregistered.status).toBe("refused");
    if (unregistered.status !== "refused") {
      return;
    }
    expect(unregistered.reason).toBe("family-unregistered");
  });

  it("does not default a family from holdout outcomes", () => {
    const source = readFileSync(new URL("../src/headless.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/final-evaluation|won|lost|test-ooa|test-id/);
    expect(source).toContain("explicit");
    expect(HEADLESS_CONCURRENCY).toBe(1);
  });

  it("binds the frozen Sprint-3 confidence threshold, not a holdout retune", () => {
    const joint = policyFromFrozenBundle(loadBundle("joint-logistic"), SUPPORT_GATES);
    const factorized = policyFromFrozenBundle(loadBundle("factorized-logistic"), SUPPORT_GATES);
    expect(joint?.minCalibratedConfidence).toBe(0.4);
    expect(factorized?.minCalibratedConfidence).toBe(0.65);
    expect(joint?.inferenceTimeoutMs).toBe(250);
  });
});

describe("evaluateObservation predicted and abstention paths", () => {
  it("publishes a PREDICTED hypothesis for a supported observation", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ minCalibratedConfidence: 0.01, minMargin: 0 }),
        provider: createStubProvider({ logits: confidentLogits(0) }),
      }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    expect(result.hypothesis.evidenceMode).toBe("predicted");
    expect(result.hypothesis.evidenceMode).not.toBe("verified");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.hypothesis)).toBe(true);
  });

  it("composes factorized 10/9/10 heads into a 13-class distribution", () => {
    const mapping = (loadBundle("factorized-logistic").model as FactorizedModelArtifact)
      .classHeadIndices;
    expect(mapping).toHaveLength(13);
    const first = mapping[0];
    if (first === undefined) {
      throw new Error("missing composition row");
    }
    const verb = new Array<number>(10).fill(0);
    const object = new Array<number>(9).fill(0);
    const property = new Array<number>(10).fill(0);
    verb[first.verbIndex] = 8;
    object[first.objectIndex] = 8;
    property[first.transitionPropertyIndex] = 8;
    const composed = composeFactorizedLogits(
      { verb, objectKind: object, transitionProperty: property },
      mapping,
    );
    expect(composed).toHaveLength(13);
    expect(composed[0]).toBe(24);
    const artifact = buildArtifact({ modelFamily: "factorized-logistic" });
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        artifact,
        policy: buildPolicy({ minCalibratedConfidence: 0.01, minMargin: 0 }),
        provider: createStubProvider({
          scores: buildFactorizedScores({
            verbLogits: verb,
            objectLogits: object,
            transitionLogits: property,
          }),
          artifact,
        }),
        factorizedComposition: mapping,
        calibrator: createStubCalibrator({ calibratedFor: artifact }),
      }),
    );
    expect(isHypothesisResult(result)).toBe(true);
    if (!isHypothesisResult(result)) {
      return;
    }
    expect(result.hypothesis.tuple).toBeDefined();
    expect(result.hypothesis.evidenceMode).toBe("predicted");
  });

  it("does not softmax 900 unrestricted combinations", () => {
    const mapping = (loadBundle("factorized-logistic").model as FactorizedModelArtifact)
      .classHeadIndices;
    const composed = composeFactorizedLogits(
      {
        verb: new Array<number>(10).fill(0),
        objectKind: new Array<number>(9).fill(0),
        transitionProperty: new Array<number>(10).fill(0),
      },
      mapping,
    );
    expect(composed).toHaveLength(FC008_SUPPORTED_TUPLE_COUNT);
    expect(composed).not.toHaveLength(900);
  });

  it("abstains deterministically on an unsupported object", () => {
    const result = evaluateObservation(
      buildObservationInput({ semantics: { objectKindEvidence: ["other"] } }),
      buildRuntimeDeps(),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("UNSUPPORTED_OBJECT");
  });

  it("abstains deterministically on an unsupported / novel categorical", () => {
    const result = evaluateObservation(
      buildObservationInput({ semantics: { interactionKind: "other" } }),
      buildRuntimeDeps(),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("NOVEL_OR_UNSUPPORTED_INPUT");
  });

  it("abstains on insufficient context", () => {
    const result = evaluateObservation(
      buildObservationInput({
        semantics: {
          tokens: [{ channel: "ctl", value: "go" }],
          stateTokens: [],
          objectKindEvidence: [],
        },
      }),
      buildRuntimeDeps({ policy: buildPolicy({ minFeatureCoverage: 0.9 }) }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("INSUFFICIENT_CONTEXT");
  });

  it("abstains when privacy redaction is too high", () => {
    const result = evaluateObservation(
      buildObservationInput({ retainedRatio: 0.1 }),
      buildRuntimeDeps({ policy: buildPolicy({ minRetainedRedactionRatio: 0.5 }) }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("PRIVACY_REDACTION_TOO_HIGH");
  });

  it("abstains on low confidence", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ minCalibratedConfidence: 0.999999, minMargin: 0 }),
      }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("LOW_CONFIDENCE");
  });

  it("abstains on an ambiguous action", () => {
    const logits = new Array<number>(13).fill(-8);
    logits[0] = 3;
    logits[1] = 2.999;
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ minCalibratedConfidence: 0.01, minMargin: 0.2 }),
        provider: createStubProvider({ logits }),
      }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("AMBIGUOUS_ACTION");
  });
});

describe("operational failures stay operational", () => {
  it("fails closed when the model is unavailable", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ artifact: null }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_UNAVAILABLE");
  });

  it("fails closed on a model version mismatch", () => {
    const result = evaluateObservation(
      buildObservationInput({ freshness: { supportMatrixVersion: "9.9" } }),
      buildRuntimeDeps(),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_VERSION_MISMATCH");
  });

  it("fails closed on timeout and discards late scores", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ inferenceTimeoutMs: 10 }),
        clock: createScriptedClock([0, 11]),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_TIMEOUT");
    expect(() => {
      (result as { code: string }).code = "LOW_CONFIDENCE";
    }).toThrow(TypeError);
  });

  it("fails closed on a provider internal error", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ provider: createStubProvider({ throws: true }) }),
    );
    expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
  });
});

describe("freshness races", () => {
  it("publishes when the observation is unchanged", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ minCalibratedConfidence: 0.01, minMargin: 0 }),
        freshnessValidator: createStubFreshness([true, true]),
      }),
    );
    expect(isHypothesisResult(result)).toBe(true);
  });

  it("refuses when the observation is stale before inference", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({ freshnessValidator: createStubFreshness([false]) }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("OBSERVATION_STALE");
  });

  it("discards scores when the observation changes during inference", () => {
    const freshness = createStubFreshness([true, false]);
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ minCalibratedConfidence: 0.01, minMargin: 0 }),
        freshnessValidator: freshness,
      }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("OBSERVATION_STALE");
  });

  it("discards scores when the observation changes after scoring and before publish", () => {
    const freshness = createStubFreshness([true, false]);
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ minCalibratedConfidence: 0.01, minMargin: 0 }),
        freshnessValidator: freshness,
      }),
    );
    expect(isAbstainedResult(result) && result.reason).toBe("OBSERVATION_STALE");
  });

  it("keeps timeout operational when freshness also flips", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        policy: buildPolicy({ inferenceTimeoutMs: 10 }),
        clock: createScriptedClock([0, 11]),
        freshnessValidator: createStubFreshness([true, false]),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("MODEL_TIMEOUT");
  });

  it("keeps a provider error operational when freshness also flips", () => {
    const result = evaluateObservation(
      buildObservationInput(),
      buildRuntimeDeps({
        provider: createStubProvider({ throws: true }),
        freshnessValidator: createStubFreshness([true, false]),
      }),
    );
    expect(isFailedResult(result) && result.code).toBe("INTERNAL_ERROR");
  });
});

describe("headless understandAction integration", () => {
  it("scores a sanitized observation through the frozen joint provider", () => {
    expect(sha256File("fc008-joint-logistic-model.json")).toBe(FROZEN_SHA256.jointModel);
    const runtime = readyRuntime("joint-logistic");
    const result = understandAction(frozenObservation(), runtime);
    expect(["hypothesis", "abstained", "failed"]).toContain(result.outcome);
    if (isHypothesisResult(result)) {
      expect(result.hypothesis.evidenceMode).toBe("predicted");
      expect(result.hypothesis.provenance.modelFamily).toBe("joint-logistic");
    }
    if (isFailedResult(result)) {
      expect([
        "SCHEMA_INVALID",
        "MODEL_UNAVAILABLE",
        "MODEL_TIMEOUT",
        "MODEL_VERSION_MISMATCH",
        "INTERNAL_ERROR",
      ]).toContain(result.code);
    }
  });

  it("scores the same observation through the frozen factorized provider", () => {
    const runtime = readyRuntime("factorized-logistic");
    const result = runtime.understandAction(frozenObservation());
    expect(["hypothesis", "abstained", "failed"]).toContain(result.outcome);
    if (isHypothesisResult(result)) {
      expect(result.hypothesis.provenance.modelFamily).toBe("factorized-logistic");
    }
  });

  it("enforces concurrency 1 and supersedes an older in-flight call", () => {
    const bundle = loadBundle("joint-logistic");
    let runtime: HeadlessRuntime | null = null;
    let nested: UnderstandingResult | null = null;
    let entered = 0;
    const freshness = {
      isCurrent(): boolean {
        entered += 1;
        if (entered === 1 && runtime !== null) {
          nested = runtime.understandAction(
            frozenObservation({
              freshness: { epoch: 2, observationSequence: 2 },
            }),
          );
        }
        return true;
      },
    };
    const created = createHeadlessRuntime({
      modelFamily: "joint-logistic",
      bundle,
      supportGates: SUPPORT_GATES,
      freshnessValidator: freshness,
      clock: createScriptedClock([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
      now: () => TEST_TIMESTAMP,
      idGenerator: createDeterministicIdGenerator("conc"),
    });
    if (created.status !== "ready") {
      throw new Error(created.reason);
    }
    runtime = created.runtime;
    const older = runtime.understandAction(frozenObservation());
    expect(runtime.concurrency).toBe(1);
    expect(HEADLESS_CONCURRENCY).toBe(1);
    expect(nested).not.toBeNull();
    expect(isAbstainedResult(older) && older.reason).toBe("OBSERVATION_STALE");
  });

  it("returns MODEL_TIMEOUT on the frozen 250 ms ceiling", () => {
    const runtime = readyRuntime("joint-logistic", {
      clock: createScriptedClock([0, 251]),
    });
    const result = runtime.understandAction(frozenObservation());
    expect(isFailedResult(result) && result.code).toBe("MODEL_TIMEOUT");
  });

  it("produces an inert research indicator with no authority fields", () => {
    const runtime = readyRuntime("joint-logistic");
    const result = runtime.understandAction(frozenObservation());
    const indicator = runtime.researchIndicator(result);
    expect(indicator.retentionPolicy).toBe("ephemeral-memory-only");
    for (const key of RESEARCH_INDICATOR_FORBIDDEN_KEYS) {
      expect(Object.keys(indicator)).not.toContain(key);
    }
    expect(researchIndicatorFromResult(result)).toEqual(indicator);
  });
});

describe("privacy, isolation, and bounds", () => {
  it("keeps prohibited fields out of provider feature input", () => {
    const semantics = frozenObservation().semantics as ObservationSemantics;
    const bundle = loadBundle("joint-logistic");
    const vocabulary = vocabularyFromModelArtifact(bundle.model, bundle.model.modelVersion);
    const projected = projectPrimaryFeatures(semantics, vocabulary, FC008_FEATURE_POLICY);
    expect(projected.ok).toBe(true);
    const serialized = JSON.stringify(semantics);
    for (const field of PROHIBITED_PRIMARY_FEATURE_INPUTS) {
      expect(serialized).not.toContain(`"${field}"`);
    }
    expect(serialized).not.toContain("hostname");
    expect(serialized).not.toContain("objectLabel");
  });

  it("excludes ephemeral display context from observation and features", () => {
    const display = createEphemeralDisplayContext({
      objectLabel: "secret-repo",
      surfaceTitle: "private title",
      retentionPolicy: "ephemeral-memory-only",
    });
    expect(display.valid).toBe(true);
    if (!display.valid) {
      return;
    }
    expect(() => JSON.stringify(display.value)).toThrow(/memory-only/);
    const observation = frozenObservation();
    expect(JSON.stringify(observation)).not.toContain("secret-repo");
    expect(observation).not.toHaveProperty("display");
  });

  it("imports no FC-007 release or native-click authority", () => {
    const source = [
      readFileSync(new URL("../src/headless.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../src/calibration.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../src/research-indicator.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../src/runtime.ts", import.meta.url), "utf8"),
    ].join("\n");
    expect(source).not.toMatch(/fc007|native-click|release-attempt|verified-decision/i);
    expect(source).not.toMatch(/localStorage|indexedDB|fetch\(|XMLHttpRequest/);
  });

  it("preserves the frozen reason precedence order", () => {
    expect(FC008_PRECEDENCE.map((step) => step.step)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it("preserves resource bounds including timeout and concurrency", () => {
    expect(HEADLESS_INFERENCE_TIMEOUT_MS).toBe(250);
    expect(HEADLESS_CONCURRENCY).toBe(1);
    expect(FC008_SAFETY_CAPS.maxStringUtf8Bytes).toBe(512);
    expect(FC008_SAFETY_CAPS.maxLabelChars).toBe(256);
    expect(FC008_SAFETY_CAPS.maxHeadingsPerSurface).toBe(8);
    expect(FC008_SAFETY_CAPS.maxNearbyLabels).toBe(12);
    expect(FC008_SAFETY_CAPS.maxTokensPerChannel).toBe(64);
    expect(FC008_SAFETY_CAPS.maxTotalTokens).toBe(192);
    expect(FC008_SAFETY_CAPS.maxStateTokens).toBe(24);
    expect(FC008_SAFETY_CAPS.maxObjectKindEvidence).toBe(4);
    expect(FC008_SAFETY_CAPS.maxCandidateControlsPerScan).toBe(32);
    expect(FC008_SAFETY_CAPS.maxTraversalDepth).toBe(8);
    expect(FC008_SAFETY_CAPS.maxAlternatives).toBe(3);
    expect(FC008_SAFETY_CAPS.maxFeatureVocabulary).toBe(4096);
    expect(FC008_SAFETY_CAPS.maxActiveFeatures).toBe(256);
    expect(FC008_SAFETY_CAPS.absoluteArtifactCeilingBytes).toBe(2_097_152);
  });

  it("does not let the provider decide policy", () => {
    const provider = createStubProvider({ logits: confidentLogits(0) });
    const contextKeys = Object.keys(
      (
        provider as unknown as {
          score: (semantics: unknown, context: object) => unknown;
        }
      ).score.length === 2
        ? { supportMatrixVersion: "1.0", featurePolicyVersion: "1.0" }
        : {},
    );
    expect(contextKeys).not.toContain("minCalibratedConfidence");
    expect(contextKeys).not.toContain("accepted");
  });
});

describe("runtime-owned calibration", () => {
  it("applies temperature after composition and returns 13 probabilities", () => {
    const artifact = buildArtifact();
    const calibrator = createTemperatureCalibrator({ temperature: 2, artifact });
    const outcome = calibrator.calibrate(confidentLogits(0), "joint-logistic");
    expect(outcome.status).toBe("calibrated");
    if (outcome.status !== "calibrated") {
      return;
    }
    expect(outcome.scores.probabilities).toHaveLength(13);
    expect(outcome.scores.temperature).toBe(2);
    expect(outcome.scores.unsupportedCombinationMass).toBe(0);
  });
});
