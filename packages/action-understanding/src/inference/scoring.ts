/**
 * FC-008 Sprint 4A — local inference numerics.
 *
 * PURE. Ordinary JavaScript `number` (IEEE-754 double) arithmetic, no matrix
 * library, no WASM, no Python, no network. Every formula here is a direct port of
 * the frozen Python reference in `research/futurebench/src/futurebench/fc008/`,
 * and `tests/inference-parity.test.ts` proves the port agrees with it to within
 * the frozen 1e-6 absolute tolerance on all 15 golden vectors.
 *
 * THE FROZEN FORMULAS, STATED ONCE
 *
 *   joint       rawLogit[k]   = intercept[k] + sum_j coefficient[k][j] * x[j]
 *   factorized  rawLogit[k]   = verbLogit[verb(k)]
 *                             + objectLogit[object(k)]
 *                             + transitionPropertyLogit[property(k)]
 *   both        scaledLogit[k] = rawLogit[k] / T
 *   both        probability    = softmax(scaledLogit), max-shifted
 *   confidence  = max(probability)
 *   margin      = top probability - second probability
 *   entropy     = -sum_k p[k] * log(p[k]) / log(13)
 *
 * Three details are load-bearing and easy to get subtly wrong:
 *
 * 1. Temperature is applied to the COMPOSED 13-tuple logits, never to the three
 *    factorized heads separately. Scaling heads individually is not equivalent:
 *    it would divide each head's contribution before summing, which only
 *    coincides with the frozen definition when T = 1.
 * 2. The entropy denominator is log(13) — the fixed class count — for both
 *    families. Using the per-head class count, or the count of classes with
 *    non-zero probability, would produce a different and incomparable number.
 * 3. The entropy sum multiplies the UNCLIPPED probability by the log of the
 *    CLIPPED one, exactly as the reference does. The clip only keeps `log` finite
 *    when a probability underflows to zero; because the unclipped factor is then
 *    also zero, the term contributes nothing and no floor is introduced.
 */

import { FC008_SUPPORTED_TUPLE_COUNT } from "../support-matrix.js";
import {
  type ClassHeadIndices,
  FC008_FROZEN_FEATURE_COUNT,
  type FactorizedHead,
  type FactorizedModelArtifact,
  type JointModelArtifact,
} from "./artifact.js";

/** Matches the reference clip that keeps `log(0)` finite. */
const PROBABILITY_LOG_FLOOR = 1e-300;

/** Why an inference input was refused. */
export const INFERENCE_REFUSALS = Object.freeze([
  "length-mismatch",
  "index-invalid",
  "index-duplicated",
  "value-not-finite",
  "vector-empty",
  "dimension-mismatch",
  "temperature-invalid",
  "logit-not-finite",
] as const);
export type InferenceRefusal = (typeof INFERENCE_REFUSALS)[number];

export class InferenceError extends Error {
  readonly refusal: InferenceRefusal;

  constructor(refusal: InferenceRefusal, detail: string) {
    super(`${refusal}: ${detail}`);
    this.name = "InferenceError";
    this.refusal = refusal;
  }
}

function refuse(refusal: InferenceRefusal, detail: string): never {
  throw new InferenceError(refusal, detail);
}

// ============================================================================
// FEATURE VECTOR
// ============================================================================

export interface DensifiedFeatures {
  /** Dense 370-length vector in the frozen feature order. */
  readonly vector: readonly number[];
  /** Active in-vocabulary entries. */
  readonly activeCount: number;
  /**
   * Supplied indices at or beyond the frozen vocabulary, which were ignored.
   *
   * Reported rather than silently dropped so a caller can surface the condition.
   * The frozen golden `unknownFeatureCase` requires that ignoring them leave the
   * known features untouched: the logits for a row carrying out-of-vocabulary
   * indices must equal the logits for the same row without them.
   */
  readonly ignoredIndices: readonly number[];
}

/**
 * Expand a sparse projection into the frozen dense feature vector.
 *
 * The vocabulary is FIXED at 370. An index beyond it is ignored, never appended:
 * growing the vector would invent a feature the frozen coefficients have no
 * weight for, and would make the vector's length depend on the input.
 *
 * Duplicate indices are refused rather than resolved. The reference builds its
 * design matrix by assignment, so a duplicate would mean "last value wins" — an
 * ordering-dependent result from data that is supposed to be a set. The frozen
 * projector never emits one, so refusing costs nothing and closes the ambiguity.
 */
export function densifyFeatures(
  indices: readonly number[],
  values: readonly number[],
  featureCount: number = FC008_FROZEN_FEATURE_COUNT,
): DensifiedFeatures {
  if (indices.length !== values.length) {
    refuse("length-mismatch", `received ${indices.length} indices and ${values.length} values`);
  }
  const vector = new Array<number>(featureCount).fill(0);
  const seen = new Set<number>();
  const ignoredIndices: number[] = [];
  let activeCount = 0;

  for (let position = 0; position < indices.length; position += 1) {
    const index = indices[position] as number;
    const value = values[position] as number;
    if (!Number.isInteger(index) || index < 0) {
      refuse("index-invalid", `index at position ${position} is ${String(index)}`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      refuse("value-not-finite", `value at position ${position} is ${String(value)}`);
    }
    if (seen.has(index)) {
      refuse("index-duplicated", `index ${index} appears more than once`);
    }
    seen.add(index);
    if (index >= featureCount) {
      ignoredIndices.push(index);
      continue;
    }
    vector[index] = value;
    activeCount += 1;
  }

  return Object.freeze({
    vector: Object.freeze(vector),
    activeCount,
    ignoredIndices: Object.freeze(ignoredIndices),
  });
}

// ============================================================================
// LINEAR SCORING
// ============================================================================

function scoreLinear(
  coefficients: readonly (readonly number[])[],
  intercepts: readonly number[],
  features: readonly number[],
  label: string,
): readonly number[] {
  if (features.length !== FC008_FROZEN_FEATURE_COUNT) {
    refuse(
      "dimension-mismatch",
      `${label} expects ${FC008_FROZEN_FEATURE_COUNT} features, received ${features.length}`,
    );
  }
  const logits = new Array<number>(coefficients.length);
  for (let k = 0; k < coefficients.length; k += 1) {
    const row = coefficients[k] as readonly number[];
    let total = intercepts[k] as number;
    for (let j = 0; j < FC008_FROZEN_FEATURE_COUNT; j += 1) {
      total += (row[j] as number) * (features[j] as number);
    }
    if (!Number.isFinite(total)) {
      refuse("logit-not-finite", `${label} logit ${k} is ${String(total)}`);
    }
    logits[k] = total;
  }
  return Object.freeze(logits);
}

/** The 13 raw joint tuple logits, in frozen class order. No scaling, no rounding. */
export function jointRawLogits(
  model: JointModelArtifact,
  features: readonly number[],
): readonly number[] {
  return scoreLinear(model.coefficients, model.intercepts, features, "joint");
}

export interface FactorizedHeadLogits {
  /** 10 verb logits in canonical verb order. */
  readonly verb: readonly number[];
  /** 9 object-kind logits in canonical object order. */
  readonly objectKind: readonly number[];
  /** 10 transition-property logits in canonical property order. */
  readonly transitionProperty: readonly number[];
}

function headLogits(head: FactorizedHead, features: readonly number[]): readonly number[] {
  return scoreLinear(head.coefficients, head.intercepts, features, `factorized.${head.name}`);
}

/**
 * The three independent head logit vectors, preserved separately.
 *
 * Kept separate because RQ1 needs them and because composition must be
 * reconstructible from them. Collapsing here would make the 10/9/10 evidence
 * unrecoverable.
 */
export function factorizedHeadLogits(
  model: FactorizedModelArtifact,
  features: readonly number[],
): FactorizedHeadLogits {
  return Object.freeze({
    verb: headLogits(model.verb, features),
    objectKind: headLogits(model.objectKind, features),
    transitionProperty: headLogits(model.transitionProperty, features),
  });
}

/**
 * Compose head logits into the 13 tuple logits by frozen additive sum.
 *
 * No learned combiner, no averaging, no extra weights, no normalization — the
 * composition is exactly the sum of the three head logits selected by the frozen
 * per-class head indices.
 */
export function composeFactorizedLogits(
  heads: FactorizedHeadLogits,
  classHeadIndices: readonly ClassHeadIndices[],
): readonly number[] {
  if (classHeadIndices.length !== FC008_SUPPORTED_TUPLE_COUNT) {
    refuse(
      "dimension-mismatch",
      `composition expects ${FC008_SUPPORTED_TUPLE_COUNT} classes, received ${classHeadIndices.length}`,
    );
  }
  const logits = new Array<number>(classHeadIndices.length);
  for (let k = 0; k < classHeadIndices.length; k += 1) {
    const mapping = classHeadIndices[k] as ClassHeadIndices;
    const total =
      (heads.verb[mapping.verbIndex] as number) +
      (heads.objectKind[mapping.objectIndex] as number) +
      (heads.transitionProperty[mapping.transitionPropertyIndex] as number);
    if (!Number.isFinite(total)) {
      refuse("logit-not-finite", `composed logit ${k} is ${String(total)}`);
    }
    logits[k] = total;
  }
  return Object.freeze(logits);
}

/** The 13 raw factorized tuple logits, composed from the three heads. */
export function factorizedRawLogits(
  model: FactorizedModelArtifact,
  features: readonly number[],
): readonly number[] {
  return composeFactorizedLogits(factorizedHeadLogits(model, features), model.classHeadIndices);
}

// ============================================================================
// TEMPERATURE AND SOFTMAX
// ============================================================================

/**
 * Divide raw logits by the frozen temperature.
 *
 * Applied to the composed 13-tuple logits for BOTH families, after raw logits
 * exist as their own value. Raw and scaled are kept as separate vectors because
 * RQ2 compares T = 1 against the frozen T using identical weights.
 */
export function applyTemperature(
  rawLogits: readonly number[],
  temperature: number,
): readonly number[] {
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature <= 0) {
    refuse(
      "temperature-invalid",
      `temperature must be finite and positive, received ${String(temperature)}`,
    );
  }
  if (rawLogits.length === 0) {
    refuse("vector-empty", "cannot scale an empty logit vector");
  }
  const scaled = new Array<number>(rawLogits.length);
  for (let k = 0; k < rawLogits.length; k += 1) {
    const logit = rawLogits[k] as number;
    if (!Number.isFinite(logit)) {
      refuse("logit-not-finite", `raw logit ${k} is ${String(logit)}`);
    }
    scaled[k] = logit / temperature;
  }
  return Object.freeze(scaled);
}

/**
 * Numerically stable softmax: subtract the maximum, exponentiate, normalize.
 *
 * The subtraction is mathematically a no-op and numerically essential — `exp` of
 * a large positive logit overflows to Infinity and the whole row becomes NaN.
 */
export function stableSoftmax(logits: readonly number[]): readonly number[] {
  if (logits.length === 0) {
    refuse("vector-empty", "cannot softmax an empty logit vector");
  }
  let maximum = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < logits.length; k += 1) {
    const logit = logits[k] as number;
    if (typeof logit !== "number" || !Number.isFinite(logit)) {
      refuse("logit-not-finite", `logit ${k} is ${String(logit)}`);
    }
    if (logit > maximum) {
      maximum = logit;
    }
  }
  const exponentiated = new Array<number>(logits.length);
  let total = 0;
  for (let k = 0; k < logits.length; k += 1) {
    const value = Math.exp((logits[k] as number) - maximum);
    exponentiated[k] = value;
    total += value;
  }
  // The maximum entry contributes exp(0) = 1, so the total is at least 1 and
  // this division cannot be by zero.
  const probabilities = new Array<number>(logits.length);
  for (let k = 0; k < logits.length; k += 1) {
    probabilities[k] = (exponentiated[k] as number) / total;
  }
  return Object.freeze(probabilities);
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

export interface PredictionDiagnostics {
  /** Frozen class number of the arg-max probability. */
  readonly selectedClassNumber: number;
  /** Position of the selected class within the frozen class order. */
  readonly selectedClassIndex: number;
  /** Calibrated confidence: the maximum probability. */
  readonly calibratedConfidence: number;
  /** Top-two probability margin. */
  readonly topTwoMargin: number;
  /** Shannon entropy divided by log(13). */
  readonly normalizedEntropy: number;
}

/**
 * Confidence, margin, and normalized entropy for one probability vector.
 *
 * Margin and entropy are DIAGNOSTICS. Exactly one gate is tuned in FC-008 — the
 * confidence threshold — so these are reported, never thresholded here.
 *
 * Ties: arg-max takes the FIRST maximal class in frozen class order. A strict
 * `>` comparison makes that deterministic, which matters because tied confidence
 * is one of the required evaluation fixtures.
 */
export function predictionDiagnostics(
  probabilities: readonly number[],
  classOrder: readonly number[],
): PredictionDiagnostics {
  if (probabilities.length === 0) {
    refuse("vector-empty", "cannot summarize an empty probability vector");
  }
  if (probabilities.length !== classOrder.length) {
    refuse(
      "dimension-mismatch",
      `${probabilities.length} probabilities against ${classOrder.length} classes`,
    );
  }

  let selectedClassIndex = 0;
  let best = Number.NEGATIVE_INFINITY;
  let secondBest = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < probabilities.length; k += 1) {
    const probability = probabilities[k] as number;
    if (typeof probability !== "number" || !Number.isFinite(probability)) {
      refuse("value-not-finite", `probability ${k} is ${String(probability)}`);
    }
    if (probability > best) {
      secondBest = best;
      best = probability;
      selectedClassIndex = k;
    } else if (probability > secondBest) {
      secondBest = probability;
    }
  }
  // Only reachable for a single-class vector, which the 13-class contract never
  // produces but which a fixture could.
  if (!Number.isFinite(secondBest)) {
    secondBest = 0;
  }

  let entropy = 0;
  for (let k = 0; k < probabilities.length; k += 1) {
    const probability = probabilities[k] as number;
    const floored = Math.min(Math.max(probability, PROBABILITY_LOG_FLOOR), 1);
    entropy += probability * Math.log(floored);
  }

  return Object.freeze({
    selectedClassNumber: classOrder[selectedClassIndex] as number,
    selectedClassIndex,
    calibratedConfidence: best,
    topTwoMargin: best - secondBest,
    normalizedEntropy: -entropy / Math.log(probabilities.length),
  });
}

// ============================================================================
// END-TO-END
// ============================================================================

/** Everything one row produces, with every intermediate preserved. */
export interface InferenceResult {
  readonly modelFamily: "joint-logistic" | "factorized-logistic";
  /** Present only for the factorized family. Raw 10/9/10 head logits. */
  readonly headLogits: FactorizedHeadLogits | null;
  readonly rawTupleLogits: readonly number[];
  readonly scaledTupleLogits: readonly number[];
  readonly probabilities: readonly number[];
  readonly temperature: number;
  readonly diagnostics: PredictionDiagnostics;
}

export function inferJoint(
  model: JointModelArtifact,
  features: readonly number[],
  temperature: number,
): InferenceResult {
  const rawTupleLogits = jointRawLogits(model, features);
  const scaledTupleLogits = applyTemperature(rawTupleLogits, temperature);
  const probabilities = stableSoftmax(scaledTupleLogits);
  return Object.freeze({
    modelFamily: "joint-logistic" as const,
    headLogits: null,
    rawTupleLogits,
    scaledTupleLogits,
    probabilities,
    temperature,
    diagnostics: predictionDiagnostics(probabilities, model.classOrder),
  });
}

export function inferFactorized(
  model: FactorizedModelArtifact,
  features: readonly number[],
  temperature: number,
): InferenceResult {
  const heads = factorizedHeadLogits(model, features);
  const rawTupleLogits = composeFactorizedLogits(heads, model.classHeadIndices);
  const scaledTupleLogits = applyTemperature(rawTupleLogits, temperature);
  const probabilities = stableSoftmax(scaledTupleLogits);
  return Object.freeze({
    modelFamily: "factorized-logistic" as const,
    headLogits: heads,
    rawTupleLogits,
    scaledTupleLogits,
    probabilities,
    temperature,
    diagnostics: predictionDiagnostics(probabilities, model.classOrder),
  });
}
