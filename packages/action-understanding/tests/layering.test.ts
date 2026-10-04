/**
 * Layer separation and projector boundary (AI-15, AI-16, AI-19).
 *
 * Type-level assertions in this file are enforced by `pnpm typecheck`, which
 * includes the tests directory. A widening of the projector signature or the
 * appearance of a prohibited field on `ObservationSemantics` becomes a COMPILE
 * error, not merely a failing assertion.
 */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_PRIMARY_FEATURE_FAMILIES,
  FC008_FEATURE_POLICY,
  FC008_FEATURE_POLICY_VERSION,
  type FeaturePolicy,
  type FeatureProjectionResult,
  type FeatureVocabulary,
  PROHIBITED_PRIMARY_FEATURE_INPUTS,
  type PrimaryProjectorInput,
  type ProjectPrimaryFeatures,
  REQUIRED_SEMANTIC_FEATURE_GROUPS,
} from "../src/feature-policy.js";
import {
  DISPLAY_RETENTION_POLICY,
  type EphemeralDisplayContext,
  createEphemeralDisplayContext,
} from "../src/display.js";
import { computeObservationInputFingerprint } from "../src/fingerprint.js";
import {
  type AcquisitionContext,
  type ActionObservation,
  type BenchmarkMetadata,
  OBSERVATION_FORBIDDEN_KEYS,
  OBSERVATION_LAYER_KEYS,
  type ObservationSemantics,
  validateActionObservation,
} from "../src/observation.js";
import { collectReachableKeys } from "../src/validation.js";
import {
  buildAcquisition,
  buildBenchmarkInput,
  buildObservationInput,
  buildSemantics,
} from "./helpers.js";

// ============================================================================
// TYPE-LEVEL ASSERTIONS
// ============================================================================

type AssertTrue<T extends true> = T;
type AssertFalse<T extends false> = T;
type HasKey<O, K extends string> = K extends keyof O ? true : false;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

// The projector input is exactly Layer B and nothing else.
type _ProjectorInputIsSemantics = AssertTrue<Equals<PrimaryProjectorInput, ObservationSemantics>>;
type _ProjectorInputIsNotObservation = AssertFalse<
  Equals<PrimaryProjectorInput, ActionObservation>
>;

// The other three layers are not reachable from the projector input.
type _NoAcquisition = AssertFalse<HasKey<ObservationSemantics, "acquisition">>;
type _NoBenchmark = AssertFalse<HasKey<ObservationSemantics, "benchmark">>;
type _NoDisplay = AssertFalse<HasKey<ObservationSemantics, "display">>;
type _NoProvenance = AssertFalse<HasKey<ObservationSemantics, "provenance">>;
type _NoRedaction = AssertFalse<HasKey<ObservationSemantics, "redaction">>;
type _NoFreshness = AssertFalse<HasKey<ObservationSemantics, "freshness">>;
type _NoId = AssertFalse<HasKey<ObservationSemantics, "id">>;
type _NoFingerprint = AssertFalse<HasKey<ObservationSemantics, "inputFingerprint">>;

// AI-15: site and application identity.
type _NoHostname = AssertFalse<HasKey<ObservationSemantics, "hostname">>;
type _NoOrigin = AssertFalse<HasKey<ObservationSemantics, "origin">>;
type _NoUrl = AssertFalse<HasKey<ObservationSemantics, "url">>;
type _NoReferrer = AssertFalse<HasKey<ObservationSemantics, "referrer">>;
type _NoApplicationName = AssertFalse<HasKey<ObservationSemantics, "applicationName">>;
type _NoRouteId = AssertFalse<HasKey<ObservationSemantics, "routeId">>;

// AI-16: object labels.
type _NoObjectLabel = AssertFalse<HasKey<ObservationSemantics, "objectLabel">>;
type _NoSurfaceTitle = AssertFalse<HasKey<ObservationSemantics, "surfaceTitle">>;
type _NoRepositoryName = AssertFalse<HasKey<ObservationSemantics, "repositoryName">>;
type _NoFileName = AssertFalse<HasKey<ObservationSemantics, "fileName">>;

// AI-19: remaining prohibited families, including oracle metadata.
type _NoOracleClass = AssertFalse<HasKey<ObservationSemantics, "oracleClass">>;
type _NoFixtureId = AssertFalse<HasKey<ObservationSemantics, "fixtureId">>;
type _NoGeneratorId = AssertFalse<HasKey<ObservationSemantics, "generatorId">>;
type _NoTemplateId = AssertFalse<HasKey<ObservationSemantics, "templateId">>;
type _NoSplitId = AssertFalse<HasKey<ObservationSemantics, "splitId">>;
type _NoRuleOutcome = AssertFalse<HasKey<ObservationSemantics, "deterministicRuleOutcome">>;
type _NoRawHtml = AssertFalse<HasKey<ObservationSemantics, "rawHtml">>;
type _NoDomSnapshot = AssertFalse<HasKey<ObservationSemantics, "domSnapshot">>;
type _NoSelector = AssertFalse<HasKey<ObservationSemantics, "selector">>;
type _NoXpath = AssertFalse<HasKey<ObservationSemantics, "xpath">>;
type _NoShadowRoot = AssertFalse<HasKey<ObservationSemantics, "shadowRoot">>;
type _NoElement = AssertFalse<HasKey<ObservationSemantics, "element">>;
type _NoNode = AssertFalse<HasKey<ObservationSemantics, "node">>;
type _NoEvent = AssertFalse<HasKey<ObservationSemantics, "event">>;
type _NoCallback = AssertFalse<HasKey<ObservationSemantics, "callback">>;
type _NoFormValues = AssertFalse<HasKey<ObservationSemantics, "formValues">>;
type _NoHiddenValues = AssertFalse<HasKey<ObservationSemantics, "hiddenValues">>;
type _NoPassword = AssertFalse<HasKey<ObservationSemantics, "password">>;
type _NoToken = AssertFalse<HasKey<ObservationSemantics, "token">>;
type _NoCookies = AssertFalse<HasKey<ObservationSemantics, "cookies">>;
type _NoStorage = AssertFalse<HasKey<ObservationSemantics, "storage">>;
type _NoTimestamp = AssertFalse<HasKey<ObservationSemantics, "timestamp">>;
type _NoCapturedAt = AssertFalse<HasKey<ObservationSemantics, "capturedAt">>;
type _NoPageTitle = AssertFalse<HasKey<ObservationSemantics, "pageTitle">>;
type _NoScreenshot = AssertFalse<HasKey<ObservationSemantics, "screenshot">>;
type _NoClipboard = AssertFalse<HasKey<ObservationSemantics, "clipboard">>;
type _NoKeystrokes = AssertFalse<HasKey<ObservationSemantics, "keystrokes">>;
type _NoAxTree = AssertFalse<HasKey<ObservationSemantics, "accessibilityTree">>;
type _NoConsequenceLabel = AssertFalse<HasKey<ObservationSemantics, "consequenceLabel">>;
type _NoRiskLabel = AssertFalse<HasKey<ObservationSemantics, "riskLabel">>;
type _NoEvaluationTrace = AssertFalse<HasKey<ObservationSemantics, "evaluationTrace">>;
type _NoModelProvenance = AssertFalse<HasKey<ObservationSemantics, "modelProvenance">>;

// Layer C genuinely does carry material the projector must not see, which is why
// it is a separate type rather than merged into semantics.
type _BenchmarkHasApplicationFamily = AssertTrue<HasKey<BenchmarkMetadata, "applicationFamilyId">>;
type _BenchmarkHasTemplateLineage = AssertTrue<HasKey<BenchmarkMetadata, "templateLineageId">>;
type _AcquisitionHasActor = AssertTrue<HasKey<AcquisitionContext, "actor">>;

// Layer D carries the object label, and is NOT a field of the observation. The
// observation is the serializable record; Layer D must never be serialized, so
// it is a companion value held only in memory by the caller.
type _DisplayHasObjectLabel = AssertTrue<HasKey<EphemeralDisplayContext, "objectLabel">>;
type _ObservationHasNoDisplay = AssertFalse<HasKey<ActionObservation, "display">>;
type _ObservationHasNoObjectLabel = AssertFalse<HasKey<ActionObservation, "objectLabel">>;
type _ObservationHasNoSurfaceTitle = AssertFalse<HasKey<ActionObservation, "surfaceTitle">>;

// The resolved oracle class is absent from Layer C as well, so it is unreachable
// from every structure the runtime touches.
type _BenchmarkHasNoOracleClass = AssertFalse<HasKey<BenchmarkMetadata, "oracleClass">>;

// A projector that accepted the whole observation would not satisfy the contract.
type WideningAttempt = (
  observation: ActionObservation,
  vocabulary: FeatureVocabulary,
  policy: FeaturePolicy,
) => FeatureProjectionResult;
type _WideningIsNotAssignable = AssertFalse<Equals<WideningAttempt, ProjectPrimaryFeatures>>;

describe("projector boundary type contract", () => {
  it("compiles the type-level layer assertions", () => {
    // The assertions above are compile-time. This records that they were loaded.
    const witness: PrimaryProjectorInput = buildSemantics();
    expect(witness.semanticsVersion).toBe("1.0");
  });
});

// ============================================================================
// RUNTIME ASSERTIONS
// ============================================================================

describe("runtime layer separation", () => {
  it("places exactly three named layers on the serializable observation", () => {
    // Layer D is deliberately absent: see the Layer D suite below.
    expect(Object.values(OBSERVATION_LAYER_KEYS).sort()).toEqual([
      "acquisition",
      "benchmark",
      "semantics",
    ]);
  });

  it("exposes no prohibited feature-input name anywhere inside Layer B", () => {
    const semantics = buildSemantics();
    const reachable = collectReachableKeys(semantics);
    const leaked = PROHIBITED_PRIMARY_FEATURE_INPUTS.filter((name) => reachable.has(name));
    expect(leaked).toEqual([]);
  });

  it("exposes no other-layer key anywhere inside Layer B", () => {
    const reachable = collectReachableKeys(buildSemantics());
    for (const key of [
      "acquisition",
      "benchmark",
      "display",
      "provenance",
      "redaction",
      "freshness",
    ] as const) {
      expect(reachable.has(key)).toBe(false);
    }
  });

  it("keeps application family and template lineage out of Layer B at runtime", () => {
    const result = validateActionObservation(
      buildObservationInput({ benchmark: buildBenchmarkInput() }),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const serializedSemantics = JSON.stringify(result.value.semantics);
    expect(serializedSemantics).not.toContain("app-family-a");
    expect(serializedSemantics).not.toContain("lineage-01");
    expect(serializedSemantics).not.toContain("scenario-01");
    expect(serializedSemantics).not.toContain("gen-1-0");
  });

  it("cannot reach a benchmark value through the projector input value", () => {
    const result = validateActionObservation(
      buildObservationInput({ benchmark: buildBenchmarkInput() }),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    // The value actually handed to a projector is `observation.semantics`.
    const projectorInput: PrimaryProjectorInput = result.value.semantics;
    const reachable = collectReachableKeys(projectorInput);
    expect(reachable.has("applicationFamilyId")).toBe(false);
    expect(reachable.has("objectLabel")).toBe(false);
    expect(reachable.has("actor")).toBe(false);
  });
});

// ============================================================================
// LAYER D: EPHEMERAL DISPLAY CONTEXT
// ============================================================================

describe("Layer D is not part of the serializable observation", () => {
  const SECRET_LABEL = "venky/secret-project";

  function buildDisplay(): EphemeralDisplayContext {
    const result = createEphemeralDisplayContext({
      objectLabel: SECRET_LABEL,
      surfaceTitle: "Danger zone for secret-project",
      retentionPolicy: DISPLAY_RETENTION_POLICY,
    });
    if (!result.valid) {
      throw new Error(`display fixture invalid: ${JSON.stringify(result.issues)}`);
    }
    return result.value;
  }

  it("validates a display context as a standalone companion value", () => {
    const display = buildDisplay();
    expect(display.objectLabel).toBe(SECRET_LABEL);
    expect(display.retentionPolicy).toBe("ephemeral-memory-only");
    expect(Object.isFrozen(display)).toBe(true);
  });

  it("omits display from a validated observation entirely", () => {
    const result = validateActionObservation(buildObservationInput());
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect("display" in result.value).toBe(false);
    expect(Object.keys(result.value)).not.toContain("display");
  });

  it("rejects an observation input that tries to carry a display layer", () => {
    // The observation validator uses closed-shape validation, so an unknown key
    // is a rejection rather than a silently ignored field. That is what makes
    // "Layer D is not observation data" enforced instead of merely documented.
    const input = buildObservationInput();
    input.display = {
      objectLabel: SECRET_LABEL,
      surfaceTitle: null,
      retentionPolicy: DISPLAY_RETENTION_POLICY,
    };
    const result = validateActionObservation(input);
    expect(result.valid).toBe(false);
  });

  it("names display and object label as forbidden observation keys", () => {
    expect(OBSERVATION_FORBIDDEN_KEYS).toContain("display");
    expect(OBSERVATION_FORBIDDEN_KEYS).toContain("objectLabel");
    expect(OBSERVATION_FORBIDDEN_KEYS).toContain("surfaceTitle");
    expect(Object.isFrozen(OBSERVATION_FORBIDDEN_KEYS)).toBe(true);
  });

  it("refuses to serialize a display context to JSON", () => {
    const display = buildDisplay();
    expect(() => JSON.stringify(display)).toThrow(TypeError);
  });

  it("keeps the display label out of the serialized observation", () => {
    const result = validateActionObservation(buildObservationInput());
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain(SECRET_LABEL);
    expect(serialized).not.toContain("objectLabel");
    expect(serialized).not.toContain("ephemeral-memory-only");
  });

  it("keeps the display label out of the fingerprint signature", () => {
    // The fingerprint is computed from Layer A and Layer B only. There is no
    // parameter through which a display value could enter it.
    const fingerprint = computeObservationInputFingerprint(buildSemantics(), buildAcquisition());
    expect(fingerprint.ok).toBe(true);
    if (!fingerprint.ok) {
      return;
    }
    expect(fingerprint.fingerprint).not.toContain(SECRET_LABEL);
    expect(fingerprint.fingerprint).not.toContain("secret-project");
  });

  it("keeps the display label unreachable from the projector input", () => {
    const reachable = collectReachableKeys(buildSemantics());
    expect(reachable.has("display")).toBe(false);
    expect(reachable.has("objectLabel")).toBe(false);
    expect(reachable.has("surfaceTitle")).toBe(false);
    expect(reachable.has("retentionPolicy")).toBe(false);
  });
});

describe("feature policy contract", () => {
  it("declares version 1.0 and the twelve allowed families", () => {
    expect(FC008_FEATURE_POLICY_VERSION).toBe("1.0");
    expect(ALLOWED_PRIMARY_FEATURE_FAMILIES).toHaveLength(12);
    expect(FC008_FEATURE_POLICY.allowedFamilies).toEqual(ALLOWED_PRIMARY_FEATURE_FAMILIES);
  });

  it("declares exactly six required semantic feature groups", () => {
    expect(REQUIRED_SEMANTIC_FEATURE_GROUPS).toHaveLength(6);
    expect(FC008_FEATURE_POLICY.requiredGroups).toEqual(REQUIRED_SEMANTIC_FEATURE_GROUPS);
  });

  it("is frozen and matches the frozen vocabulary and active-feature caps", () => {
    expect(Object.isFrozen(FC008_FEATURE_POLICY)).toBe(true);
    expect(FC008_FEATURE_POLICY.maxFeatureVocabulary).toBe(4096);
    expect(FC008_FEATURE_POLICY.maxActiveFeatures).toBe(256);
  });

  it("enumerates the prohibited inputs including oracle metadata and capabilities", () => {
    for (const name of [
      "hostname",
      "applicationName",
      "objectLabel",
      "oracleClass",
      "fixtureId",
      "generatorId",
      "templateId",
      "splitId",
      "deterministicRuleOutcome",
      "element",
      "node",
      "event",
      "callback",
      "password",
      "token",
      "cookies",
      "screenshot",
      "accessibilityTree",
    ]) {
      expect(PROHIBITED_PRIMARY_FEATURE_INPUTS).toContain(name);
    }
    expect(Object.isFrozen(PROHIBITED_PRIMARY_FEATURE_INPUTS)).toBe(true);
  });

  it("ships no fitted vocabulary in Sprint 1", () => {
    // The vocabulary is fit on the TRAIN partition only, during Sprint 3.
    expect("entries" in FC008_FEATURE_POLICY).toBe(false);
  });
});
