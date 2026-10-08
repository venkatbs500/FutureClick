/**
 * FC-008 Sprint 5A — headless runtime entry point.
 *
 * sanitized ActionObservation
 *   → frozen feature projection (inside the provider)
 *   → frozen artifact provider (scores only)
 *   → runtime-owned composition / calibration / policy
 *   → immutable PREDICTED / abstained / failed result
 *
 * No execution authority. No persistence. No network. No FC-007 imports.
 *
 * Family selection is NOT inferred from Sprint-4 holdout results. ADR-016
 * froze "no runtime winner". This module therefore requires an explicit
 * already-loaded family bundle and refuses to start without one.
 */

import type { IdGenerator, IsoTimestamp } from "@futureclick/shared";
import { FC008_SAFETY_CAPS } from "./bounds.js";
import { createTemperatureCalibrator } from "./calibration.js";
import { createFailureDetail } from "./failure-detail.js";
import { FC008_FEATURE_POLICY_VERSION } from "./feature-policy.js";
import type { FreshnessValidator } from "./freshness.js";
import type { Fc008ModelFamily } from "./hypothesis.js";
import { FC008_MODEL_FAMILIES } from "./hypothesis.js";
import type { ArtifactBundle, FactorizedModelArtifact } from "./inference/artifact.js";
import { type AbstentionPolicy, validateAbstentionPolicy } from "./policy.js";
import type { ArtifactDescriptor } from "./provider.js";
import {
  createFrozenArtifactProvider,
  vocabularyFromModelArtifact,
} from "./providers/frozen-artifact-provider.js";
import {
  type ResearchIndicatorViewModel,
  researchIndicatorFromResult,
} from "./research-indicator.js";
import { type UnderstandingResult, createAbstainedResult, createFailedResult } from "./result.js";
import { type UnderstandingRuntimeDeps, evaluateObservation } from "./runtime.js";
import { FC008_SUPPORT_MATRIX_VERSION } from "./support-matrix.js";
import type { RuntimeClock } from "./timing.js";

/** Operational timeout: the Sprint-1 ceiling, now the Sprint-5 bound. */
export const HEADLESS_INFERENCE_TIMEOUT_MS = FC008_SAFETY_CAPS.absoluteInferenceTimeoutCeilingMs;

export const HEADLESS_CONCURRENCY = FC008_SAFETY_CAPS.maxConcurrentInference;

/**
 * Support-gate values that were never locked inside the Sprint-3 policy
 * artifact. They are caller-supplied pre-existing runtime policy, not
 * holdout-derived defaults.
 */
export interface HeadlessSupportGates {
  readonly minMargin: number;
  readonly maxUnknownTokenRatio: number;
  readonly minFeatureCoverage: number;
  readonly minRetainedRedactionRatio: number;
}

export interface HeadlessRuntimeConfig {
  /** Required. No silent default. Must match `bundle.modelFamily`. */
  readonly modelFamily: Fc008ModelFamily;
  readonly bundle: ArtifactBundle;
  readonly supportGates: HeadlessSupportGates;
  readonly freshnessValidator: FreshnessValidator;
  readonly clock: RuntimeClock;
  readonly now: () => IsoTimestamp;
  readonly idGenerator: IdGenerator;
  readonly researchMode?: boolean;
}

export type HeadlessStartupRefusal =
  | "family-not-specified"
  | "family-unregistered"
  | "family-bundle-mismatch"
  | "policy-invalid"
  | "timeout-not-frozen";

export type HeadlessRuntimeCreation =
  | { readonly status: "ready"; readonly runtime: HeadlessRuntime }
  | { readonly status: "refused"; readonly reason: HeadlessStartupRefusal };

export interface HeadlessRuntime {
  readonly modelFamily: Fc008ModelFamily;
  readonly concurrency: typeof HEADLESS_CONCURRENCY;
  readonly inferenceTimeoutMs: typeof HEADLESS_INFERENCE_TIMEOUT_MS;
  understandAction(observation: unknown): UnderstandingResult;
  researchIndicator(result: UnderstandingResult): ResearchIndicatorViewModel;
}

function descriptorFromBundle(bundle: ArtifactBundle): ArtifactDescriptor {
  return Object.freeze({
    modelFamily: bundle.modelFamily,
    modelVersion: bundle.model.modelVersion,
    artifactSha256: bundle.modelSha256,
    supportMatrixVersion: bundle.model.identity.supportMatrixVersion,
    featurePolicyVersion: bundle.model.identity.featurePolicyVersion,
    calibrationArtifactVersion: bundle.calibration.calibrationArtifactVersion,
  });
}

/**
 * Build an abstention policy from the frozen Sprint-3 policy artifact plus
 * caller-supplied support gates. Confidence threshold and versions come from
 * the artifact. The timeout is the frozen 250 ms ceiling.
 */
export function policyFromFrozenBundle(
  bundle: ArtifactBundle,
  supportGates: HeadlessSupportGates,
): AbstentionPolicy | null {
  const validated = validateAbstentionPolicy({
    policyVersion: bundle.policy.abstentionPolicyVersion,
    minCalibratedConfidence: bundle.policy.selectedConfidenceThreshold,
    minMargin: supportGates.minMargin,
    maxUnknownTokenRatio: supportGates.maxUnknownTokenRatio,
    minFeatureCoverage: supportGates.minFeatureCoverage,
    minRetainedRedactionRatio: supportGates.minRetainedRedactionRatio,
    inferenceTimeoutMs: HEADLESS_INFERENCE_TIMEOUT_MS,
    requiredSupportMatrixVersion: bundle.model.identity.supportMatrixVersion,
    requiredFeaturePolicyVersion: bundle.model.identity.featurePolicyVersion,
  });
  return validated.valid ? validated.value : null;
}

function isRegisteredFamily(value: unknown): value is Fc008ModelFamily {
  return typeof value === "string" && (FC008_MODEL_FAMILIES as readonly string[]).includes(value);
}

/**
 * Construct the headless runtime. Refuses if family is missing, unregistered,
 * or disagrees with the supplied frozen bundle.
 */
export function createHeadlessRuntime(config: HeadlessRuntimeConfig): HeadlessRuntimeCreation {
  if (config.modelFamily === undefined || config.modelFamily === null) {
    return Object.freeze({ status: "refused" as const, reason: "family-not-specified" });
  }
  if (!isRegisteredFamily(config.modelFamily)) {
    return Object.freeze({ status: "refused" as const, reason: "family-unregistered" });
  }
  if (config.bundle.modelFamily !== config.modelFamily) {
    return Object.freeze({ status: "refused" as const, reason: "family-bundle-mismatch" });
  }
  const policy = policyFromFrozenBundle(config.bundle, config.supportGates);
  if (policy === null) {
    return Object.freeze({ status: "refused" as const, reason: "policy-invalid" });
  }
  if (policy.inferenceTimeoutMs !== HEADLESS_INFERENCE_TIMEOUT_MS) {
    return Object.freeze({ status: "refused" as const, reason: "timeout-not-frozen" });
  }
  if (
    policy.requiredSupportMatrixVersion !== FC008_SUPPORT_MATRIX_VERSION ||
    policy.requiredFeaturePolicyVersion !== FC008_FEATURE_POLICY_VERSION
  ) {
    return Object.freeze({ status: "refused" as const, reason: "policy-invalid" });
  }

  const artifact = descriptorFromBundle(config.bundle);
  const provider = createFrozenArtifactProvider({ bundle: config.bundle });
  const calibrator = createTemperatureCalibrator({
    temperature: config.bundle.calibration.temperature,
    artifact,
  });
  const vocabulary = vocabularyFromModelArtifact(
    config.bundle.model,
    config.bundle.model.modelVersion,
  );
  const factorizedComposition =
    config.bundle.modelFamily === "factorized-logistic"
      ? (config.bundle.model as FactorizedModelArtifact).classHeadIndices
      : undefined;

  const deps: UnderstandingRuntimeDeps = Object.freeze({
    policy,
    provider,
    calibrator,
    freshnessValidator: config.freshnessValidator,
    clock: config.clock,
    artifact,
    vocabulary,
    now: config.now,
    idGenerator: config.idGenerator,
    researchMode: config.researchMode === true,
    ...(factorizedComposition === undefined ? {} : { factorizedComposition }),
  });

  let inFlightGeneration = 0;
  let active = false;

  const runtime: HeadlessRuntime = {
    modelFamily: config.modelFamily,
    concurrency: HEADLESS_CONCURRENCY,
    inferenceTimeoutMs: HEADLESS_INFERENCE_TIMEOUT_MS,
    understandAction(observation: unknown): UnderstandingResult {
      if (active && HEADLESS_CONCURRENCY === 1) {
        inFlightGeneration += 1;
      }
      const generation = inFlightGeneration + 1;
      inFlightGeneration = generation;
      active = true;
      try {
        const result = evaluateObservation(observation, deps);
        if (generation !== inFlightGeneration) {
          if (result.outcome === "failed") {
            return result;
          }
          return createAbstainedResult({
            reason: "OBSERVATION_STALE",
            observationId: null,
            inputFingerprint: null,
          });
        }
        return result;
      } catch {
        return createFailedResult(
          "INTERNAL_ERROR",
          null,
          createFailureDetail("runtime", "unhandled-exception", null),
        );
      } finally {
        if (generation === inFlightGeneration) {
          active = false;
        }
      }
    },
    researchIndicator(result: UnderstandingResult): ResearchIndicatorViewModel {
      return researchIndicatorFromResult(result);
    },
  };
  return Object.freeze({ status: "ready" as const, runtime: Object.freeze(runtime) });
}

/**
 * Headless entry point. `runtime` must already have been created with an
 * explicit family and matching frozen bundle.
 */
export function understandAction(
  observation: unknown,
  runtime: HeadlessRuntime,
): UnderstandingResult {
  return runtime.understandAction(observation);
}
