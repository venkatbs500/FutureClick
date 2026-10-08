/**
 * FC-008 Sprint 1 — understanding runtime.
 *
 * The runtime owns every decision: version checks, calibration/model identity
 * checks, freshness checks, support assessment, deadline enforcement,
 * calibration application, threshold application, the frozen precedence ladder,
 * and hypothesis construction. Providers score; the runtime decides.
 *
 * The runtime is platform-neutral. It imports no DOM, no MutationObserver, no
 * browser lifecycle, no network, no filesystem, no timer, no clock, and no
 * FC-007 module. Current-state ownership is injected through
 * `FreshnessValidator`; time is injected through `RuntimeClock`.
 *
 * Sprint 5A owns factorized composition and temperature calibration on the
 * runtime side. Providers still return raw 13-tuple or 10/9/10 logits only.
 */

import type { ConfidenceScore } from "@futureclick/action-schema";
import type { IdGenerator, IsoTimestamp } from "@futureclick/shared";
import { FC008_SAFETY_CAPS } from "./bounds.js";
import { type FailureReason, type FailureStage, createFailureDetail } from "./failure-detail.js";
import { FC008_FEATURE_POLICY_VERSION, type FeatureVocabulary } from "./feature-policy.js";
import type { FreshnessValidator } from "./freshness.js";
import {
  type ActionHypothesis,
  type ActionHypothesisId,
  CALIBRATION_METHOD,
  FC008_EVIDENCE_MODE,
  type Fc008ModelFamily,
  type InferenceDiagnostics,
  validateActionHypothesis,
} from "./hypothesis.js";
import type { ClassHeadIndices } from "./inference/artifact.js";
import { composeFactorizedLogits } from "./inference/scoring.js";
import { type ActionObservation, validateActionObservation } from "./observation.js";
import {
  PRE_INFERENCE_MAX_STEP,
  firstFailingSupportCheck,
  outcomeForSupportCheck,
} from "./outcome-mapping.js";
import type { AbstentionPolicy } from "./policy.js";
import {
  type ArtifactDescriptor,
  type ProviderOutcome,
  type ScoringProvider,
  artifactIdentityDivergence,
  artifactIdentityMatches,
  createProviderScoringContext,
  validateProviderOutcome,
} from "./provider.js";
import {
  type OperationalFailureCode,
  type UnderstandingResult,
  createAbstainedResult,
  createFailedResult,
  createHypothesisResult,
} from "./result.js";
import {
  FC008_SUPPORTED_TUPLE_COUNT,
  FC008_SUPPORT_MATRIX,
  FC008_SUPPORT_MATRIX_VERSION,
} from "./support-matrix.js";
import { type RuntimeSupportDiagnostics, assessSupport } from "./support.js";
import { InferenceDeadline, type RuntimeClock } from "./timing.js";

// ============================================================================
// CALIBRATION BOUNDARY (interface only in Sprint 1)
// ============================================================================

export interface CalibratedScores {
  /**
   * Calibrated probabilities over the supported tuples, in frozen class order
   * (array index 0..12, i.e. class numbers 1..13). Must sum to one within
   * `PROBABILITY_SUM_TOLERANCE`.
   */
  readonly probabilities: readonly number[];
  /** Maximum UNCALIBRATED probability. Research diagnostic only. */
  readonly uncalibratedMaxProbability: number;
  readonly temperature: number;
  readonly calibrationArtifactVersion: string;
  /**
   * Probability mass discarded when renormalising a factorized composition onto
   * the supported set. Zero for the joint family by construction.
   */
  readonly unsupportedCombinationMass: number;
  /**
   * Identity of the artifact this calibration was fitted for.
   *
   * Carried so the runtime can refuse to combine scores from one artifact with
   * calibration metadata fitted for another. A temperature fitted on a
   * different model is not a valid temperature for these logits.
   *
   * All five model and feature dimensions are stated, not just the model hash:
   * a temperature fitted under a different support matrix or feature policy is
   * fitted over a different class space or a different feature space, and is
   * just as wrong as one fitted for a different model.
   */
  readonly calibratedForModelFamily: Fc008ModelFamily;
  readonly calibratedForModelVersion: string;
  readonly calibratedForArtifactSha256: string;
  readonly calibratedForSupportMatrixVersion: string;
  readonly calibratedForFeaturePolicyVersion: string;
}

export type CalibrationOutcome =
  | { readonly status: "calibrated"; readonly scores: CalibratedScores }
  | { readonly status: "error"; readonly detail: string };

/**
 * Runtime-owned calibration. Providers never calibrate themselves, so the
 * authority to turn a score into a probability stays with the runtime.
 */
export interface ScoreCalibrator {
  readonly calibratorId: string;
  calibrate(logits: readonly number[], family: Fc008ModelFamily): CalibrationOutcome;
}

export const PROBABILITY_SUM_TOLERANCE = 1e-6;

// ============================================================================
// RUNTIME DEPENDENCIES
// ============================================================================

export interface UnderstandingRuntimeDeps {
  readonly policy: AbstentionPolicy;
  readonly provider: ScoringProvider;
  readonly calibrator: ScoreCalibrator;
  /** Caller-owned current-state authority. */
  readonly freshnessValidator: FreshnessValidator;
  /** Monotonic clock. Injected so timing is platform-neutral and testable. */
  readonly clock: RuntimeClock;
  /** Result of fail-closed artifact validation, or null when none is loaded. */
  readonly artifact: ArtifactDescriptor | null;
  /** Fitted feature vocabulary, or null until a Sprint 3 artifact is loaded. */
  readonly vocabulary: FeatureVocabulary | null;
  readonly now: () => IsoTimestamp;
  readonly idGenerator: IdGenerator;
  /** When false, no `InferenceDiagnostics` are emitted anywhere. */
  readonly researchMode: boolean;
  /**
   * Frozen 13-tuple composition mapping. Required to score a factorized
   * payload. Taken from the already-loaded Sprint-3 artifact, never invented
   * from holdout results. Absent mapping still fails closed.
   */
  readonly factorizedComposition?: readonly ClassHeadIndices[];
}

interface RankedClass {
  readonly classIndex: number;
  readonly probability: number;
}

/**
 * Deterministic ranking: descending probability, ties broken by ascending class
 * index so that identical input always produces identical output.
 */
function rankClasses(probabilities: readonly number[]): readonly RankedClass[] {
  const ranked: RankedClass[] = [];
  for (let i = 0; i < probabilities.length; i++) {
    ranked.push({ classIndex: i, probability: probabilities[i] as number });
  }
  ranked.sort((a, b) => {
    if (a.probability !== b.probability) {
      return b.probability - a.probability;
    }
    return a.classIndex - b.classIndex;
  });
  return ranked;
}

/** Normalised Shannon entropy of a calibrated distribution, in [0, 1]. */
function normalisedEntropy(probabilities: readonly number[]): number {
  let sum = 0;
  for (const p of probabilities) {
    if (p > 0) {
      sum -= p * Math.log(p);
    }
  }
  const maximum = Math.log(probabilities.length);
  return maximum > 0 ? sum / maximum : 0;
}

/**
 * Checks that every declared version agrees across the observation, the policy,
 * the frozen package constants, the loaded artifact, and the loaded vocabulary.
 *
 * Returns the name of the first disagreeing field, or null when all agree.
 */
function versionMismatch(
  observation: ActionObservation,
  policy: AbstentionPolicy,
  artifact: ArtifactDescriptor | null,
  vocabulary: FeatureVocabulary | null,
): string | null {
  const binding = observation.freshness;
  if (binding.supportMatrixVersion !== policy.requiredSupportMatrixVersion) {
    return "observation.supportMatrixVersion";
  }
  if (binding.featurePolicyVersion !== policy.requiredFeaturePolicyVersion) {
    return "observation.featurePolicyVersion";
  }
  if (binding.abstentionPolicyVersion !== policy.policyVersion) {
    return "observation.abstentionPolicyVersion";
  }
  if (policy.requiredSupportMatrixVersion !== FC008_SUPPORT_MATRIX_VERSION) {
    return "policy.requiredSupportMatrixVersion";
  }
  if (policy.requiredFeaturePolicyVersion !== FC008_FEATURE_POLICY_VERSION) {
    return "policy.requiredFeaturePolicyVersion";
  }
  if (artifact !== null) {
    if (artifact.supportMatrixVersion !== policy.requiredSupportMatrixVersion) {
      return "artifact.supportMatrixVersion";
    }
    if (artifact.featurePolicyVersion !== policy.requiredFeaturePolicyVersion) {
      return "artifact.featurePolicyVersion";
    }
  }
  if (
    vocabulary !== null &&
    vocabulary.featurePolicyVersion !== policy.requiredFeaturePolicyVersion
  ) {
    return "vocabulary.featurePolicyVersion";
  }
  return null;
}

function validateCalibratedScores(scores: CalibratedScores): string | null {
  const { probabilities } = scores;
  if (probabilities.length !== FC008_SUPPORTED_TUPLE_COUNT) {
    return `calibrated probability vector must contain ${FC008_SUPPORTED_TUPLE_COUNT} entries`;
  }
  let total = 0;
  for (const p of probabilities) {
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
      return "calibrated probabilities must be finite numbers within [0, 1]";
    }
    total += p;
  }
  if (Math.abs(total - 1) > PROBABILITY_SUM_TOLERANCE) {
    return "calibrated probabilities must sum to one within tolerance";
  }
  if (
    !Number.isFinite(scores.temperature) ||
    scores.temperature <= 0 ||
    !Number.isFinite(scores.uncalibratedMaxProbability) ||
    scores.uncalibratedMaxProbability < 0 ||
    scores.uncalibratedMaxProbability > 1
  ) {
    return "calibration metadata is out of range";
  }
  if (
    !Number.isFinite(scores.unsupportedCombinationMass) ||
    scores.unsupportedCombinationMass < 0 ||
    scores.unsupportedCombinationMass > 1
  ) {
    return "unsupportedCombinationMass must be within [0, 1]";
  }
  return null;
}

/**
 * Projects a calibration result onto the artifact identity it claims.
 *
 * Done so the calibration boundary is compared by exactly the same rule as the
 * provider boundary, through `artifactIdentityDivergence`. Two hand-written
 * comparisons would be two places to forget a field.
 */
function claimedCalibrationIdentity(scores: CalibratedScores): ArtifactDescriptor {
  return {
    modelFamily: scores.calibratedForModelFamily,
    modelVersion: scores.calibratedForModelVersion,
    artifactSha256: scores.calibratedForArtifactSha256,
    supportMatrixVersion: scores.calibratedForSupportMatrixVersion,
    featurePolicyVersion: scores.calibratedForFeaturePolicyVersion,
    calibrationArtifactVersion: scores.calibrationArtifactVersion,
  };
}

/**
 * Whether a calibration result was fitted for the artifact actually in use.
 *
 * Combining logits from one artifact with a temperature fitted for another
 * silently produces a mis-calibrated probability that looks entirely normal, so
 * this is checked rather than assumed.
 */
function calibrationIdentityMatches(
  scores: CalibratedScores,
  artifact: ArtifactDescriptor,
): boolean {
  return artifactIdentityMatches(claimedCalibrationIdentity(scores), artifact);
}

/**
 * Evaluates an untrusted observation and returns exactly one
 * `UnderstandingResult`, walking `FC008_PRECEDENCE` in order.
 */
export function evaluateObservation(
  input: unknown,
  deps: UnderstandingRuntimeDeps,
): UnderstandingResult {
  try {
    return evaluateObservationInternal(input, deps);
  } catch {
    // Any unanticipated throw is an OPERATIONAL defect, never model uncertainty.
    return fail("INTERNAL_ERROR", null, "runtime", "unhandled-exception");
  }
}

function fail(
  code: OperationalFailureCode,
  observationId: ActionObservation["id"] | null,
  stage: FailureStage,
  reason: FailureReason,
  measurement: number | null = null,
): UnderstandingResult {
  return createFailedResult(code, observationId, createFailureDetail(stage, reason, measurement));
}

function evaluateObservationInternal(
  input: unknown,
  deps: UnderstandingRuntimeDeps,
): UnderstandingResult {
  const { policy, provider, calibrator, freshnessValidator, artifact, clock } = deps;

  // --- STEP 1: SCHEMA_INVALID --------------------------------------------
  const observationResult = validateActionObservation(input);
  if (!observationResult.valid) {
    return fail(
      "SCHEMA_INVALID",
      null,
      "observation-validation",
      "schema-invalid",
      observationResult.issues.length,
    );
  }
  const observation = observationResult.value;

  // --- STEP 2: MODEL_VERSION_MISMATCH ------------------------------------
  if (versionMismatch(observation, policy, artifact, deps.vocabulary) !== null) {
    return fail("MODEL_VERSION_MISMATCH", observation.id, "version-check", "version-mismatch");
  }

  // --- STEP 3: MODEL_UNAVAILABLE (no artifact loaded) --------------------
  if (artifact === null) {
    return fail("MODEL_UNAVAILABLE", observation.id, "artifact-load", "no-validated-artifact");
  }

  // --- STEP 5: pre-inference OBSERVATION_STALE ---------------------------
  // Short-circuits before the provider runs, so no timeout can be encountered.
  if (!freshnessValidator.isCurrent(observation.freshness, observation.inputFingerprint)) {
    return createAbstainedResult({
      reason: "OBSERVATION_STALE",
      observationId: observation.id,
      inputFingerprint: observation.inputFingerprint,
    });
  }

  // --- RUNTIME-OWNED SUPPORT ASSESSMENT ----------------------------------
  // Produced before the provider is invoked and from the observation only, so a
  // provider cannot contribute to, inspect, or influence it.
  const support = assessSupport(observation.semantics, {
    vocabulary: deps.vocabulary,
    schemaVersionsMatched: true,
    supportedTupleResolved: true,
  });

  // --- STEPS 6, 7, 8: pre-inference epistemic gates ----------------------
  // Evaluated through the single frozen mapping rather than inline conditions,
  // bounded to the pre-inference phase so step 9 still runs after scoring.
  const preInferenceCheck = firstFailingSupportCheck(
    observation,
    support,
    policy,
    PRE_INFERENCE_MAX_STEP,
  );
  if (preInferenceCheck !== null) {
    const outcome = outcomeForSupportCheck(preInferenceCheck);
    if (outcome.category === "operational") {
      // The code comes from the frozen mapping, not from a literal here, so the
      // mapping is the single source of truth for what a condition produces.
      return fail(outcome.code, observation.id, "support-assessment", "version-mismatch");
    }
    return createAbstainedResult({
      reason: outcome.reason,
      observationId: observation.id,
      inputFingerprint: observation.inputFingerprint,
      support,
    });
  }

  // --- DEADLINE: opened before the provider, closed after calibration ----
  const deadline = InferenceDeadline.open(clock, policy.inferenceTimeoutMs);
  if (deadline === null) {
    return fail("INTERNAL_ERROR", observation.id, "runtime", "clock-invalid");
  }

  // --- INFERENCE: provider scores, runtime decides ------------------------
  let rawOutcome: unknown;
  try {
    rawOutcome = provider.score(observation.semantics, createProviderScoringContext());
  } catch {
    return fail("INTERNAL_ERROR", observation.id, "provider", "provider-threw");
  }

  // Deadline check immediately after the provider call. A synchronous provider
  // cannot be preempted, so an over-budget score is DISCARDED here rather than
  // interrupted; either way it cannot reach a decision.
  const afterProvider = deadline.elapsed();
  if (!afterProvider.ok) {
    return fail("INTERNAL_ERROR", observation.id, "provider", "clock-invalid");
  }
  if (afterProvider.deadlineExceeded) {
    return fail(
      "MODEL_TIMEOUT",
      observation.id,
      "provider",
      "deadline-exceeded",
      afterProvider.elapsedMs,
    );
  }

  const outcomeResult = validateProviderOutcome(rawOutcome);
  if (!outcomeResult.valid) {
    // A malformed or self-certifying provider outcome is an operational defect.
    return fail(
      "INTERNAL_ERROR",
      observation.id,
      "provider-outcome-validation",
      "provider-outcome-invalid",
      outcomeResult.issues.length,
    );
  }
  const outcome: ProviderOutcome = outcomeResult.value;

  if (outcome.status === "unavailable") {
    return fail("MODEL_UNAVAILABLE", observation.id, "provider", "provider-unavailable");
  }
  if (outcome.status === "version-mismatch") {
    return fail("MODEL_VERSION_MISMATCH", observation.id, "provider", "version-mismatch");
  }
  if (outcome.status === "timeout") {
    return fail("MODEL_TIMEOUT", observation.id, "provider", "provider-timeout");
  }
  if (outcome.status === "error") {
    return fail("INTERNAL_ERROR", observation.id, "provider", "provider-error");
  }

  const scoreSet = outcome.scores;

  // --- ARTIFACT IDENTITY -------------------------------------------------
  // Compared across EVERY identity dimension, including support-matrix and
  // feature-policy version. Scores produced under a different support matrix
  // describe a different class space and scores produced under a different
  // feature policy describe a different feature space; either is a real
  // incompatibility that a model-hash-only check would accept.
  if (artifactIdentityDivergence(scoreSet.artifact, artifact) !== null) {
    return fail(
      "MODEL_VERSION_MISMATCH",
      observation.id,
      "provider",
      "artifact-identity-divergence",
    );
  }
  // Defence in depth, and currently unreachable: outcome validation already
  // requires scores.family === scoreSet.artifact.modelFamily, and the check
  // above requires scoreSet.artifact.modelFamily === artifact.modelFamily. It is
  // kept so that relaxing either of those cannot silently admit a family
  // mismatch here.
  if (scoreSet.scores.family !== artifact.modelFamily) {
    return fail("MODEL_VERSION_MISMATCH", observation.id, "provider", "provider-family-divergence");
  }

  // --- FACTORIZED COMPOSITION: RUNTIME-OWNED -----------------------------
  // Providers emit raw 10/9/10 heads. Composition is the frozen additive sum
  // over the 13 supported tuples only. Temperature is applied later, by the
  // calibrator, never to the heads and never over a 900-class softmax.
  let tupleLogits: readonly number[];
  if (scoreSet.scores.family === "factorized-logistic") {
    const mapping = deps.factorizedComposition;
    if (mapping === undefined || mapping.length !== FC008_SUPPORTED_TUPLE_COUNT) {
      return fail(
        "MODEL_UNAVAILABLE",
        observation.id,
        "composition",
        "composition-not-implemented",
      );
    }
    try {
      tupleLogits = composeFactorizedLogits(
        {
          verb: scoreSet.scores.verbLogits,
          objectKind: scoreSet.scores.objectLogits,
          transitionProperty: scoreSet.scores.transitionLogits,
        },
        mapping,
      );
    } catch {
      return fail("INTERNAL_ERROR", observation.id, "composition", "unhandled-exception");
    }
  } else {
    tupleLogits = scoreSet.scores.tupleLogits;
  }

  // --- CALIBRATION: runtime-owned ----------------------------------------
  let calibrationOutcome: CalibrationOutcome;
  try {
    calibrationOutcome = calibrator.calibrate(tupleLogits, scoreSet.artifact.modelFamily);
  } catch {
    return fail("INTERNAL_ERROR", observation.id, "calibration", "calibrator-threw");
  }
  if (calibrationOutcome.status !== "calibrated") {
    return fail("INTERNAL_ERROR", observation.id, "calibration", "calibration-failed");
  }
  if (validateCalibratedScores(calibrationOutcome.scores) !== null) {
    return fail("INTERNAL_ERROR", observation.id, "calibration-validation", "invalid-distribution");
  }
  const calibrated = calibrationOutcome.scores;

  // --- CALIBRATION IDENTITY ----------------------------------------------
  if (!calibrationIdentityMatches(calibrated, artifact)) {
    return fail(
      "MODEL_VERSION_MISMATCH",
      observation.id,
      "calibration-identity",
      "calibration-identity-divergence",
    );
  }

  // --- DEADLINE: total inference budget ----------------------------------
  const afterCalibration = deadline.elapsed();
  if (!afterCalibration.ok) {
    return fail("INTERNAL_ERROR", observation.id, "calibration", "clock-invalid");
  }
  if (afterCalibration.deadlineExceeded) {
    return fail(
      "MODEL_TIMEOUT",
      observation.id,
      "calibration",
      "deadline-exceeded",
      afterCalibration.elapsedMs,
    );
  }
  const latencyMs = afterCalibration.elapsedMs;

  // --- derived quantities -------------------------------------------------
  const ranked = rankClasses(calibrated.probabilities);
  const top = ranked[0];
  const second = ranked[1];
  if (top === undefined || second === undefined) {
    return fail("INTERNAL_ERROR", observation.id, "ranking", "insufficient-classes");
  }
  const calibratedConfidence = top.probability;
  const margin = top.probability - second.probability;

  const diagnostics: InferenceDiagnostics | null = deps.researchMode
    ? Object.freeze({
        modelConfidence: calibrated.uncalibratedMaxProbability,
        margin,
        entropy: normalisedEntropy(calibrated.probabilities),
        unsupportedCombinationMass: calibrated.unsupportedCombinationMass,
        latencyMs,
      })
    : null;

  const provenance = Object.freeze({
    source: "model" as const,
    modelFamily: artifact.modelFamily,
    modelVersion: artifact.modelVersion,
    artifactSha256: artifact.artifactSha256,
    supportMatrixVersion: artifact.supportMatrixVersion,
    featurePolicyVersion: artifact.featurePolicyVersion,
    abstentionPolicyVersion: policy.policyVersion,
    inferenceTimestamp: deps.now(),
  });

  // The post-inference result is computed first, then subjected to step 13.
  const postInferenceResult = decidePostInference({
    observation,
    policy,
    artifact,
    support,
    calibratedConfidence,
    margin,
    ranked,
    calibrated,
    provenance,
    diagnostics,
    idGenerator: deps.idGenerator,
  });

  // --- STEP 13: final post-inference freshness replacement ----------------
  // Applies to epistemic and accepted results only. An operational failure is
  // never relabelled as stale input, because that would hide a defect.
  if (
    postInferenceResult.outcome !== "failed" &&
    !freshnessValidator.isCurrent(observation.freshness, observation.inputFingerprint)
  ) {
    return createAbstainedResult({
      reason: "OBSERVATION_STALE",
      observationId: observation.id,
      inputFingerprint: observation.inputFingerprint,
      support,
      provenance,
      diagnostics,
    });
  }

  return postInferenceResult;
}

interface PostInferenceInput {
  readonly observation: ActionObservation;
  readonly policy: AbstentionPolicy;
  /** The validated loaded artifact. The sole authority on identity. */
  readonly artifact: ArtifactDescriptor;
  readonly support: RuntimeSupportDiagnostics;
  readonly calibratedConfidence: number;
  readonly margin: number;
  readonly ranked: readonly RankedClass[];
  readonly calibrated: CalibratedScores;
  readonly provenance: ActionHypothesis["provenance"];
  readonly diagnostics: InferenceDiagnostics | null;
  readonly idGenerator: IdGenerator;
}

function decidePostInference(input: PostInferenceInput): UnderstandingResult {
  const {
    observation,
    policy,
    support,
    calibratedConfidence,
    margin,
    ranked,
    provenance,
    diagnostics,
    idGenerator,
  } = input;

  const abstain = (reason: "NOVEL_OR_UNSUPPORTED_INPUT" | "AMBIGUOUS_ACTION" | "LOW_CONFIDENCE") =>
    createAbstainedResult({
      reason,
      observationId: observation.id,
      inputFingerprint: observation.inputFingerprint,
      support,
      provenance,
      diagnostics,
    });

  // --- STEP 9: NOVEL_OR_UNSUPPORTED_INPUT --------------------------------
  // Deterministic support checks only, via the frozen mapping. No statistical
  // OOD claim is made.
  const supportCheck = firstFailingSupportCheck(observation, support, policy);
  if (supportCheck !== null) {
    const outcome = outcomeForSupportCheck(supportCheck);
    if (outcome.category === "epistemic") {
      return createAbstainedResult({
        reason: outcome.reason,
        observationId: observation.id,
        inputFingerprint: observation.inputFingerprint,
        support,
        provenance,
        diagnostics,
      });
    }
    // As in the pre-inference phase, the operational code is taken from the
    // frozen mapping rather than restated here.
    return createFailedResult(
      outcome.code,
      observation.id,
      createFailureDetail("support-assessment", "version-mismatch", null),
    );
  }

  // --- STEP 10: AMBIGUOUS_ACTION -----------------------------------------
  if (margin < policy.minMargin) {
    return abstain("AMBIGUOUS_ACTION");
  }

  // --- STEP 11: LOW_CONFIDENCE -------------------------------------------
  if (calibratedConfidence < policy.minCalibratedConfidence) {
    return abstain("LOW_CONFIDENCE");
  }

  // --- STEP 12: accepted PREDICTED result --------------------------------
  const top = ranked[0];
  if (top === undefined) {
    return createFailedResult(
      "INTERNAL_ERROR",
      observation.id,
      createFailureDetail("accept", "missing-top-class", null),
    );
  }
  const topEntry = FC008_SUPPORT_MATRIX[top.classIndex];
  if (topEntry === undefined) {
    return createFailedResult(
      "INTERNAL_ERROR",
      observation.id,
      createFailureDetail("accept", "class-index-out-of-range", null),
    );
  }

  const alternatives: { tuple: unknown; calibratedConfidence: number }[] = [];
  for (
    let i = 1;
    i < ranked.length && alternatives.length < FC008_SAFETY_CAPS.maxAlternatives;
    i++
  ) {
    const candidate = ranked[i];
    if (candidate === undefined || candidate.probability <= 0) {
      continue;
    }
    const entry = FC008_SUPPORT_MATRIX[candidate.classIndex];
    if (entry === undefined) {
      continue;
    }
    alternatives.push({ tuple: entry.tuple, calibratedConfidence: candidate.probability });
  }

  // The runtime validates its own output through the same fail-closed validator
  // that rejects foreign hypotheses, so there is exactly one construction path.
  const candidateHypothesis = {
    schemaVersion: "1.0",
    id: idGenerator.generate<"ActionHypothesisId">("fc008h") as ActionHypothesisId,
    evidenceMode: FC008_EVIDENCE_MODE,
    observationId: observation.id,
    inputFingerprint: observation.inputFingerprint,
    freshness: observation.freshness,
    actor: { kind: observation.acquisition.actor.kind },
    tuple: topEntry.tuple,
    alternatives,
    confidence: {
      calibratedConfidence: calibratedConfidence as ConfidenceScore,
      calibrationMethod: CALIBRATION_METHOD,
      // Taken from the validated loaded artifact, never from the calibrator's
      // own claim. The identity check has already established that the two
      // agree, so this is not a behavioural change; it removes the possibility
      // that a published provenance value traces to injected input at all.
      calibrationArtifactVersion: input.artifact.calibrationArtifactVersion,
    },
    support,
    provenance,
  };

  const hypothesisResult = validateActionHypothesis(candidateHypothesis);
  if (!hypothesisResult.valid) {
    return createFailedResult(
      "INTERNAL_ERROR",
      observation.id,
      createFailureDetail(
        "hypothesis-construction",
        "hypothesis-construction-invalid",
        hypothesisResult.issues.length,
      ),
    );
  }

  return createHypothesisResult(hypothesisResult.value, diagnostics);
}
