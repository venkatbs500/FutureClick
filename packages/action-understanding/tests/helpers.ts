/**
 * Shared Sprint-1 test fixtures.
 *
 * Threshold values here are TEST values chosen to exercise control flow. They
 * are not calibrated policy values: the real thresholds are selected on the
 * POLICY-VALIDATION partition during Sprint 3 and frozen into the
 * preregistration at Sprint 3 exit.
 */

import { createDeterministicIdGenerator } from "@futureclick/shared";
import type { IdGenerator, IsoTimestamp } from "@futureclick/shared";
import { FC008_FEATURE_POLICY_VERSION } from "../src/feature-policy.js";
import type { FeatureVocabulary } from "../src/feature-policy.js";
import { computeObservationInputFingerprint } from "../src/fingerprint.js";
import type { FreshnessBinding, FreshnessValidator } from "../src/freshness.js";
import type { Fc008ModelFamily } from "../src/hypothesis.js";
import type {
  AcquisitionContext,
  ObservationSemantics,
  SemanticToken,
} from "../src/observation.js";
import type { AbstentionPolicy } from "../src/policy.js";
import { validateAbstentionPolicy } from "../src/policy.js";
import type {
  ArtifactDescriptor,
  ProviderModelScores,
  ProviderOutcome,
  ProviderScoringContext,
  ScoringProvider,
} from "../src/provider.js";
import { createScriptedClock } from "../src/timing.js";
import type { RuntimeClock } from "../src/timing.js";
import type { RuntimeSupportDiagnostics } from "../src/support.js";
import {
  FC008_MATRIX_OBJECT_KIND_COUNT,
  FC008_MATRIX_TRANSITION_PROPERTY_COUNT,
  FC008_MATRIX_VERB_COUNT,
} from "../src/support-matrix.js";
import type {
  CalibratedScores,
  CalibrationOutcome,
  ScoreCalibrator,
  UnderstandingRuntimeDeps,
} from "../src/runtime.js";
import {
  FC008_SUPPORT_MATRIX,
  FC008_SUPPORT_MATRIX_VERSION,
  FC008_SUPPORTED_TUPLE_COUNT,
} from "../src/support-matrix.js";

/**
 * Index helper that fails loudly instead of yielding `undefined`.
 * The package compiles with `noUncheckedIndexedAccess`, so tests index through
 * this rather than asserting non-null and hiding a genuine out-of-range bug.
 */
export function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`fixture index ${index} is out of range (length ${items.length})`);
  }
  return value;
}

export const TEST_SHA256 = "a".repeat(64);
export const TEST_POLICY_VERSION = "fc008-test-policy-1";
export const TEST_TIMESTAMP = "2026-10-04T05:00:00.000Z" as IsoTimestamp;

export const DEFAULT_TOKENS: readonly SemanticToken[] = Object.freeze([
  { channel: "ctl", value: "make" },
  { channel: "ctl", value: "public" },
  { channel: "acc", value: "change-visibility" },
  { channel: "hd", value: "danger-zone" },
  { channel: "nb", value: "repository" },
  { channel: "st", value: "private" },
]);

export function buildSemantics(
  overrides: Partial<ObservationSemantics> = {},
): ObservationSemantics {
  const tokens = overrides.tokens ?? DEFAULT_TOKENS;
  const stateTokens = overrides.stateTokens ?? ["visibility:private"];
  const objectKindEvidence = overrides.objectKindEvidence ?? ["repository"];
  const headingCount = overrides.structuralCounts?.headingCount ?? 1;
  const nearbyLabelCount = overrides.structuralCounts?.nearbyLabelCount ?? 2;

  return {
    semanticsVersion: "1.0",
    tokens,
    controlKind: overrides.controlKind ?? "button",
    controlRole: overrides.controlRole ?? "button",
    interactionKind: overrides.interactionKind ?? "submit",
    surfaceKind: overrides.surfaceKind ?? "modal-dialog",
    formMethod: overrides.formMethod ?? "post",
    stateTokens,
    objectKindEvidence,
    destructiveStyle: overrides.destructiveStyle ?? true,
    missingness: overrides.missingness ?? {
      accessibleNameMissing: !tokens.some((t) => t.channel === "acc"),
      headingsMissing: headingCount === 0,
      nearbyLabelsMissing: nearbyLabelCount === 0,
      stateTokensMissing: stateTokens.length === 0,
      objectKindEvidenceMissing: objectKindEvidence.length === 0,
      redactionApplied: false,
    },
    structuralCounts: overrides.structuralCounts ?? {
      headingCount,
      nearbyLabelCount,
      stateTokenCount: stateTokens.length,
      surfaceDepth: 3,
      siblingControlCount: 2,
    },
  };
}

export function buildAcquisition(overrides: Partial<AcquisitionContext> = {}): AcquisitionContext {
  return {
    actor: overrides.actor ?? { kind: "human" },
    platform: overrides.platform ?? "web",
    environmentKind: overrides.environmentKind ?? "browser",
    localeTag: overrides.localeTag ?? "en-US",
    topFrame: overrides.topFrame ?? true,
    acquisitionAuthorized: overrides.acquisitionAuthorized ?? true,
  };
}

export function buildFreshness(overrides: Partial<FreshnessBinding> = {}): FreshnessBinding {
  return {
    epoch: overrides.epoch ?? 1,
    observationSequence: overrides.observationSequence ?? 1,
    capturedAt: overrides.capturedAt ?? TEST_TIMESTAMP,
    featurePolicyVersion: overrides.featurePolicyVersion ?? FC008_FEATURE_POLICY_VERSION,
    supportMatrixVersion: overrides.supportMatrixVersion ?? FC008_SUPPORT_MATRIX_VERSION,
    abstentionPolicyVersion: overrides.abstentionPolicyVersion ?? TEST_POLICY_VERSION,
  };
}

export interface ObservationFixtureOverrides {
  readonly id?: string;
  readonly semantics?: Partial<ObservationSemantics>;
  readonly acquisition?: Partial<AcquisitionContext>;
  readonly freshness?: Partial<FreshnessBinding>;
  readonly benchmark?: unknown;
  readonly retainedRatio?: number;
  /** When set, the declared fingerprint is overridden instead of recomputed. */
  readonly inputFingerprint?: string;
}

/**
 * Builds a valid observation input object with a correctly computed fingerprint.
 * Returned as a mutable plain object so tests can corrupt individual fields.
 */
export function buildObservationInput(
  overrides: ObservationFixtureOverrides = {},
): Record<string, unknown> {
  const semantics = buildSemantics(overrides.semantics ?? {});
  const acquisition = buildAcquisition(overrides.acquisition ?? {});
  const fingerprintResult = computeObservationInputFingerprint(semantics, acquisition);
  if (!fingerprintResult.ok) {
    throw new Error(`fixture fingerprint failed: ${fingerprintResult.error}`);
  }

  return {
    schemaVersion: "1.0",
    id: overrides.id ?? "obs-0001",
    semantics: structuredClone(semantics) as unknown,
    acquisition: structuredClone(acquisition) as unknown,
    benchmark: overrides.benchmark ?? null,
    redaction: {
      redactedTokenCount: 0,
      droppedTokenCount: 0,
      truncatedStringCount: 0,
      credentialPatternDetected: false,
      nameLikePatternDropped: 0,
      retainedRatio: overrides.retainedRatio ?? 1,
      sanitizerVersion: "test-sanitizer-1",
    },
    freshness: structuredClone(buildFreshness(overrides.freshness ?? {})) as unknown,
    provenance: {
      extractorId: "test-extractor",
      extractorVersion: "1.0",
      sanitizerVersion: "test-sanitizer-1",
      source: "adapter",
      synthetic: true,
    },
    inputFingerprint: overrides.inputFingerprint ?? fingerprintResult.fingerprint,
  };
}

export function buildBenchmarkInput(): Record<string, string> {
  return {
    applicationFamilyId: "app-family-a",
    templateLineageId: "lineage-01",
    wordingVariantId: "wording-01",
    layoutVariantId: "layout-01",
    scenarioId: "scenario-01",
    generatorVersion: "gen-1-0",
  };
}

/**
 * Builds a valid `ActionHypothesis` input object as a mutable plain object so
 * tests can corrupt individual fields. Used to prove that the validator, not the
 * producer, decides what counts as a hypothesis.
 */
export function buildHypothesisInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const entry = at(FC008_SUPPORT_MATRIX, 7);
  return {
    schemaVersion: "1.0",
    id: "hyp-0001",
    evidenceMode: "predicted",
    observationId: "obs-0001",
    inputFingerprint: "FP1|L2:fixture",
    freshness: structuredClone(buildFreshness()) as unknown,
    actor: { kind: "human" },
    tuple: structuredClone(entry.tuple) as unknown,
    alternatives: [],
    confidence: {
      calibratedConfidence: 0.91,
      calibrationMethod: "temperature-scaling",
      calibrationArtifactVersion: "cal-1",
    },
    support: buildSupportRecord(),
    provenance: {
      source: "model",
      modelFamily: "joint-logistic",
      modelVersion: "m-1",
      artifactSha256: TEST_SHA256,
      supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
      featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
      abstentionPolicyVersion: TEST_POLICY_VERSION,
      inferenceTimestamp: TEST_TIMESTAMP,
    },
    ...overrides,
  };
}

/** Alternative entry for class `classIndex` at the given calibrated confidence. */
export function buildAlternative(classIndex: number, calibratedConfidence: number): unknown {
  return {
    tuple: structuredClone(at(FC008_SUPPORT_MATRIX, classIndex).tuple) as unknown,
    calibratedConfidence,
  };
}

export function buildPolicyInput(
  overrides: Partial<Record<keyof AbstentionPolicy, unknown>> = {},
): Record<string, unknown> {
  return {
    policyVersion: TEST_POLICY_VERSION,
    minCalibratedConfidence: 0.7,
    minMargin: 0.1,
    maxUnknownTokenRatio: 0.3,
    minFeatureCoverage: 0.5,
    minRetainedRedactionRatio: 0.5,
    inferenceTimeoutMs: 50,
    requiredSupportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
    requiredFeaturePolicyVersion: FC008_FEATURE_POLICY_VERSION,
    ...overrides,
  };
}

export function buildPolicy(
  overrides: Partial<Record<keyof AbstentionPolicy, unknown>> = {},
): AbstentionPolicy {
  const result = validateAbstentionPolicy(buildPolicyInput(overrides));
  if (!result.valid) {
    throw new Error(`fixture policy invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

export function buildArtifact(overrides: Partial<ArtifactDescriptor> = {}): ArtifactDescriptor {
  return Object.freeze({
    modelFamily: overrides.modelFamily ?? "joint-logistic",
    modelVersion: overrides.modelVersion ?? "m-1",
    artifactSha256: overrides.artifactSha256 ?? TEST_SHA256,
    supportMatrixVersion: overrides.supportMatrixVersion ?? FC008_SUPPORT_MATRIX_VERSION,
    featurePolicyVersion: overrides.featurePolicyVersion ?? FC008_FEATURE_POLICY_VERSION,
    calibrationArtifactVersion: overrides.calibrationArtifactVersion ?? "cal-1",
  });
}

/** Logit vector that, under `createStubCalibrator`, yields a confident top class. */
export function confidentLogits(topIndex = 7): number[] {
  const logits = new Array<number>(FC008_SUPPORTED_TUPLE_COUNT).fill(0);
  logits[topIndex] = 10;
  return logits;
}

/** Logit vector that yields two nearly tied classes. */
export function ambiguousLogits(a = 7, b = 0): number[] {
  const logits = new Array<number>(FC008_SUPPORTED_TUPLE_COUNT).fill(-10);
  logits[a] = 5;
  logits[b] = 4.99;
  return logits;
}

export interface StubProviderOptions {
  readonly outcome?: unknown;
  readonly throws?: boolean;
  /** Joint-family tuple logits. Ignored when `scores` is supplied. */
  readonly logits?: readonly number[];
  /** Full score payload, for exercising the factorized family. */
  readonly scores?: ProviderModelScores;
  readonly artifact?: ArtifactDescriptor;
  /** Synchronous delay, in scripted clock terms, before returning. */
  readonly beforeScore?: () => void;
}

export interface StubProvider extends ScoringProvider {
  readonly calls: { count: number };
}

/**
 * Deterministic test provider. Returns scores only; it has no means of
 * constructing a hypothesis or an acceptance decision.
 */
export function createStubProvider(options: StubProviderOptions = {}): StubProvider {
  const calls = { count: 0 };
  return {
    providerId: "fc008-stub-provider",
    calls,
    score(_semantics: ObservationSemantics, _context: ProviderScoringContext): ProviderOutcome {
      calls.count += 1;
      if (options.throws === true) {
        throw new Error("stub provider failure");
      }
      options.beforeScore?.();
      if (options.outcome !== undefined) {
        return options.outcome as ProviderOutcome;
      }
      return {
        status: "scored",
        scores: {
          scores: options.scores ?? {
            family: "joint-logistic",
            tupleLogits: options.logits ?? confidentLogits(),
          },
          artifact: options.artifact ?? buildArtifact(),
        },
      };
    },
  };
}

export interface StubCalibratorOptions {
  readonly throws?: boolean;
  readonly outcome?: CalibrationOutcome;
  readonly temperature?: number;
  readonly calibrationArtifactVersion?: string;
  /** Identity the calibration claims to have been fitted for. */
  readonly calibratedFor?: Partial<ArtifactDescriptor>;
}

/**
 * Deterministic stub calibrator used ONLY to exercise runtime control flow.
 *
 * This is NOT the FC-008 calibration implementation. Temperature scaling, its
 * fitted temperature, and the golden Python/TypeScript parity vectors are
 * Sprint 3 and Sprint 4 deliverables.
 */
export function createStubCalibrator(options: StubCalibratorOptions = {}): ScoreCalibrator {
  const temperature = options.temperature ?? 1;
  return {
    calibratorId: "fc008-stub-calibrator",
    calibrate(logits: readonly number[], _family: Fc008ModelFamily): CalibrationOutcome {
      if (options.throws === true) {
        throw new Error("stub calibrator failure");
      }
      if (options.outcome !== undefined) {
        return options.outcome;
      }
      const scaled = logits.map((l) => l / temperature);
      const maxLogit = Math.max(...scaled);
      const exponentials = scaled.map((l) => Math.exp(l - maxLogit));
      const total = exponentials.reduce((sum, value) => sum + value, 0);
      const probabilities = exponentials.map((value) => value / total);

      const rawMax = Math.max(...logits);
      const rawExponentials = logits.map((l) => Math.exp(l - rawMax));
      const rawTotal = rawExponentials.reduce((sum, value) => sum + value, 0);
      const uncalibratedMaxProbability = Math.max(...rawExponentials.map((v) => v / rawTotal));

      const fittedFor = { ...buildArtifact(), ...(options.calibratedFor ?? {}) };
      return {
        status: "calibrated",
        scores: {
          probabilities,
          uncalibratedMaxProbability,
          temperature,
          calibrationArtifactVersion:
            options.calibrationArtifactVersion ?? fittedFor.calibrationArtifactVersion,
          unsupportedCombinationMass: 0,
          calibratedForModelFamily: fittedFor.modelFamily,
          calibratedForModelVersion: fittedFor.modelVersion,
          calibratedForArtifactSha256: fittedFor.artifactSha256,
          calibratedForSupportMatrixVersion: fittedFor.supportMatrixVersion,
          calibratedForFeaturePolicyVersion: fittedFor.featurePolicyVersion,
        },
      };
    },
  };
}

/** Freshness validator whose answers the test controls per checkpoint. */
export interface StubFreshness extends FreshnessValidator {
  readonly calls: { count: number };
}

export function createStubFreshness(answers: readonly boolean[] = [true, true]): StubFreshness {
  const calls = { count: 0 };
  return {
    calls,
    isCurrent(): boolean {
      const index = calls.count;
      calls.count += 1;
      return answers[index] ?? answers[answers.length - 1] ?? true;
    },
  };
}

export interface RuntimeDepsOverrides {
  readonly policy?: AbstentionPolicy;
  readonly provider?: ScoringProvider;
  readonly calibrator?: ScoreCalibrator;
  readonly freshnessValidator?: FreshnessValidator;
  readonly clock?: RuntimeClock;
  readonly artifact?: ArtifactDescriptor | null;
  readonly vocabulary?: FeatureVocabulary | null;
  readonly researchMode?: boolean;
  readonly idGenerator?: IdGenerator;
  readonly factorizedComposition?: UnderstandingRuntimeDeps["factorizedComposition"];
}

export function buildRuntimeDeps(overrides: RuntimeDepsOverrides = {}): UnderstandingRuntimeDeps {
  return {
    policy: overrides.policy ?? buildPolicy(),
    provider: overrides.provider ?? createStubProvider(),
    calibrator: overrides.calibrator ?? createStubCalibrator(),
    freshnessValidator: overrides.freshnessValidator ?? createStubFreshness(),
    // Default clock advances 1ms per reading, well inside the test timeout.
    clock: overrides.clock ?? createScriptedClock([0, 1, 2, 3, 4, 5]),
    artifact: overrides.artifact === undefined ? buildArtifact() : overrides.artifact,
    vocabulary: overrides.vocabulary ?? null,
    now: () => TEST_TIMESTAMP,
    idGenerator: overrides.idGenerator ?? createDeterministicIdGenerator("test"),
    researchMode: overrides.researchMode ?? false,
    ...(overrides.factorizedComposition === undefined
      ? {}
      : { factorizedComposition: overrides.factorizedComposition }),
  };
}

/** A fully supported runtime support record, as `assessSupport` would produce. */
export function buildSupportRecord(
  overrides: Partial<RuntimeSupportDiagnostics> = {},
): Record<string, unknown> {
  return {
    requiredFeatureGroupsPresent: 6,
    requiredFeatureGroupsTotal: 6,
    featureCoverage: 1,
    unknownTokenRatio: 0,
    unknownTokenRatioAvailable: false,
    unknownCategoricalCount: 0,
    supportedObjectEvidence: true,
    minimumSemanticEvidence: true,
    supportedTupleResolved: true,
    schemaVersionsMatched: true,
    ...overrides,
  };
}

/**
 * A calibrated score set whose identity matches `buildArtifact()` by default,
 * so a test that is not about identity does not trip the identity check.
 */
export function buildCalibratedScores(overrides: Partial<CalibratedScores> = {}): CalibratedScores {
  const uniform = new Array<number>(FC008_SUPPORTED_TUPLE_COUNT).fill(
    1 / FC008_SUPPORTED_TUPLE_COUNT,
  );
  const artifact = buildArtifact();
  return {
    probabilities: uniform,
    uncalibratedMaxProbability: 1 / FC008_SUPPORTED_TUPLE_COUNT,
    temperature: 1,
    calibrationArtifactVersion: artifact.calibrationArtifactVersion,
    unsupportedCombinationMass: 0,
    calibratedForModelFamily: artifact.modelFamily,
    calibratedForModelVersion: artifact.modelVersion,
    calibratedForArtifactSha256: artifact.artifactSha256,
    calibratedForSupportMatrixVersion: artifact.supportMatrixVersion,
    calibratedForFeaturePolicyVersion: artifact.featurePolicyVersion,
    ...overrides,
  };
}

/** Factorized score payload with all three heads at their canonical sizes. */
export function buildFactorizedScores(
  overrides: Partial<{
    verbLogits: readonly number[];
    objectLogits: readonly number[];
    transitionLogits: readonly number[];
  }> = {},
): ProviderModelScores {
  return {
    family: "factorized-logistic",
    verbLogits: overrides.verbLogits ?? new Array<number>(FC008_MATRIX_VERB_COUNT).fill(0),
    objectLogits:
      overrides.objectLogits ?? new Array<number>(FC008_MATRIX_OBJECT_KIND_COUNT).fill(0),
    transitionLogits:
      overrides.transitionLogits ??
      new Array<number>(FC008_MATRIX_TRANSITION_PROPERTY_COUNT).fill(0),
  };
}
