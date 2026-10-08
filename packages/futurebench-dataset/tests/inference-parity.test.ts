/**
 * FC-008 Sprint 4A — Python <-> TypeScript golden-vector parity.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT
 *
 * This is IMPLEMENTATION PARITY, not model accuracy. It shows that the
 * TypeScript port computes the same numbers as the frozen Python reference on
 * the frozen development golden vectors. It says nothing whatsoever about
 * whether those numbers are good predictions, and it touches no sealed data:
 * the golden artifact records `partitionsUsed: ["calibration", "train"]` and
 * `sealedPartitionsUsed: []`, and this test asserts that before using it.
 *
 * The Python artifacts are frozen REFERENCE EVIDENCE. If a comparison fails, the
 * TypeScript implementation is wrong and gets fixed. The artifacts do not move.
 */

import {
  type ArtifactBundle,
  type FactorizedModelArtifact,
  type JointModelArtifact,
  applyTemperature,
  composeFactorizedLogits,
  densifyFeatures,
  factorizedHeadLogits,
  inferFactorized,
  inferJoint,
  jointRawLogits,
  predictionDiagnostics,
  stableSoftmax,
} from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import { loadFrozenArtifacts } from "../src/artifact-source.js";

const frozen = loadFrozenArtifacts();
const golden = frozen.goldenVectors.value as Record<string, unknown>;

/** The frozen tolerance, read from the artifact rather than restated here. */
const TOLERANCE = golden.parityAbsoluteTolerance as number;

interface GoldenFamily {
  readonly rawTupleLogits: readonly number[];
  readonly scaledTupleLogits: readonly number[];
  readonly probabilities: readonly number[];
  readonly selectedClassNumber: number;
  readonly calibratedConfidence: number;
  readonly topTwoMargin: number;
  readonly normalizedEntropy: number;
  readonly temperature: number;
  readonly composedTupleLogits?: readonly number[];
  readonly rawHeadLogits?: {
    readonly verb: readonly number[];
    readonly objectKind: readonly number[];
    readonly transitionProperty: readonly number[];
  };
}

interface GoldenVector {
  readonly recordId: string;
  readonly parentLineageId: string;
  readonly partition: string;
  readonly actualClassNumber: number;
  readonly activeFeatureCount: number;
  readonly featureIndices: readonly number[];
  readonly featureValues: readonly number[];
  readonly families: Readonly<Record<string, GoldenFamily>>;
}

const vectors = golden.vectors as readonly GoldenVector[];

/**
 * Accumulates the worst absolute error seen for each compared quantity.
 *
 * Recorded as it goes so the Sprint-4A parity report can state actual maxima
 * rather than only "every assertion passed".
 */
const worst = new Map<string, number>();

function compare(label: string, actual: number, expected: number): void {
  const error = Math.abs(actual - expected);
  worst.set(label, Math.max(worst.get(label) ?? 0, error));
  expect(
    error,
    `${label}: TypeScript ${actual} vs Python reference ${expected}, absolute error ${error}`,
  ).toBeLessThanOrEqual(TOLERANCE);
}

function compareVector(
  label: string,
  actual: readonly number[],
  expected: readonly number[],
): void {
  expect(actual.length, `${label} length`).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    compare(label, actual[index] as number, expected[index] as number);
  }
}

function densify(vector: GoldenVector): readonly number[] {
  const densified = densifyFeatures(vector.featureIndices, vector.featureValues);
  expect(densified.activeCount).toBe(vector.activeFeatureCount);
  expect(densified.ignoredIndices).toEqual([]);
  return densified.vector;
}

describe("golden vector provenance", () => {
  it("uses only development partitions", () => {
    expect(golden.sealedPartitionsUsed).toEqual([]);
    expect(golden.partitionsUsed).toEqual(["calibration", "train"]);
    for (const vector of vectors) {
      expect(["train", "calibration", "policy-validation"]).toContain(vector.partition);
    }
  });

  it("carries the frozen shape the parity contract assumes", () => {
    expect(golden.vectorCount).toBe(15);
    expect(vectors).toHaveLength(15);
    expect(TOLERANCE).toBe(1e-6);
    expect(golden.classesCovered).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(golden.datasetHash).toBe(frozen.manifest.datasetHash);
    expect(golden.vocabularyHash).toBe(frozen.manifest.vocabularyHash);
  });

  it("matches the frozen temperatures recorded in the calibration artifacts", () => {
    for (const vector of vectors) {
      expect((vector.families["joint-logistic"] as GoldenFamily).temperature).toBe(
        frozen.joint.calibration.temperature,
      );
      expect((vector.families["factorized-logistic"] as GoldenFamily).temperature).toBe(
        frozen.factorized.calibration.temperature,
      );
    }
  });
});

describe("joint-logistic parity", () => {
  const bundle: ArtifactBundle<JointModelArtifact> = frozen.joint;

  it.each(vectors.map((vector) => [vector.recordId, vector] as const))(
    "reproduces every joint quantity for %s",
    (_recordId, vector) => {
      const expected = vector.families["joint-logistic"] as GoldenFamily;
      const features = densify(vector);

      const raw = jointRawLogits(bundle.model, features);
      compareVector("joint.rawTupleLogits", raw, expected.rawTupleLogits);

      const scaled = applyTemperature(raw, bundle.calibration.temperature);
      compareVector("joint.scaledTupleLogits", scaled, expected.scaledTupleLogits);

      const probabilities = stableSoftmax(scaled);
      compareVector("joint.probabilities", probabilities, expected.probabilities);

      const diagnostics = predictionDiagnostics(probabilities, bundle.model.classOrder);
      expect(diagnostics.selectedClassNumber).toBe(expected.selectedClassNumber);
      compare(
        "joint.calibratedConfidence",
        diagnostics.calibratedConfidence,
        expected.calibratedConfidence,
      );
      compare("joint.topTwoMargin", diagnostics.topTwoMargin, expected.topTwoMargin);
      compare("joint.normalizedEntropy", diagnostics.normalizedEntropy, expected.normalizedEntropy);
    },
  );

  it("produces the same result through the end-to-end entry point", () => {
    for (const vector of vectors) {
      const expected = vector.families["joint-logistic"] as GoldenFamily;
      const result = inferJoint(bundle.model, densify(vector), bundle.calibration.temperature);
      compareVector(
        "joint.endToEnd.rawTupleLogits",
        result.rawTupleLogits,
        expected.rawTupleLogits,
      );
      compareVector("joint.endToEnd.probabilities", result.probabilities, expected.probabilities);
      expect(result.diagnostics.selectedClassNumber).toBe(expected.selectedClassNumber);
      expect(result.headLogits).toBeNull();
    }
  });
});

describe("factorized-logistic parity", () => {
  const bundle: ArtifactBundle<FactorizedModelArtifact> = frozen.factorized;

  it.each(vectors.map((vector) => [vector.recordId, vector] as const))(
    "reproduces every factorized quantity for %s",
    (_recordId, vector) => {
      const expected = vector.families["factorized-logistic"] as GoldenFamily;
      const expectedHeads = expected.rawHeadLogits;
      if (expectedHeads === undefined) {
        throw new Error("golden factorized vector is missing rawHeadLogits");
      }
      const features = densify(vector);

      const heads = factorizedHeadLogits(bundle.model, features);
      compareVector("factorized.rawHeadLogits.verb", heads.verb, expectedHeads.verb);
      compareVector(
        "factorized.rawHeadLogits.objectKind",
        heads.objectKind,
        expectedHeads.objectKind,
      );
      compareVector(
        "factorized.rawHeadLogits.transitionProperty",
        heads.transitionProperty,
        expectedHeads.transitionProperty,
      );

      const composed = composeFactorizedLogits(heads, bundle.model.classHeadIndices);
      compareVector("factorized.composedTupleLogits", composed, expected.rawTupleLogits);
      if (expected.composedTupleLogits !== undefined) {
        compareVector("factorized.composedTupleLogits", composed, expected.composedTupleLogits);
      }

      const scaled = applyTemperature(composed, bundle.calibration.temperature);
      compareVector("factorized.scaledTupleLogits", scaled, expected.scaledTupleLogits);

      const probabilities = stableSoftmax(scaled);
      compareVector("factorized.probabilities", probabilities, expected.probabilities);

      const diagnostics = predictionDiagnostics(probabilities, bundle.model.classOrder);
      expect(diagnostics.selectedClassNumber).toBe(expected.selectedClassNumber);
      compare(
        "factorized.calibratedConfidence",
        diagnostics.calibratedConfidence,
        expected.calibratedConfidence,
      );
      compare("factorized.topTwoMargin", diagnostics.topTwoMargin, expected.topTwoMargin);
      compare(
        "factorized.normalizedEntropy",
        diagnostics.normalizedEntropy,
        expected.normalizedEntropy,
      );
    },
  );

  it("composes additively from the preserved 10/9/10 head logits", () => {
    const vector = vectors[0] as GoldenVector;
    const heads = factorizedHeadLogits(bundle.model, densify(vector));
    expect(heads.verb).toHaveLength(10);
    expect(heads.objectKind).toHaveLength(9);
    expect(heads.transitionProperty).toHaveLength(10);

    const composed = composeFactorizedLogits(heads, bundle.model.classHeadIndices);
    for (let k = 0; k < composed.length; k += 1) {
      const mapping = bundle.model.classHeadIndices[k];
      if (mapping === undefined) {
        throw new Error(`missing composition mapping for class index ${k}`);
      }
      const sum =
        (heads.verb[mapping.verbIndex] as number) +
        (heads.objectKind[mapping.objectIndex] as number) +
        (heads.transitionProperty[mapping.transitionPropertyIndex] as number);
      expect(composed[k]).toBe(sum);
    }
  });

  it("is invariant to per-head normalization once support is restricted", () => {
    // Being precise about which orderings actually differ, because two of the
    // intuitive hazards turn out to be algebraic identities:
    //
    // 1. Dividing each head by the SAME temperature and then summing equals
    //    summing and then dividing, because division distributes over addition.
    // 2. Taking a softmax over each head, multiplying the three probabilities,
    //    and renormalizing over the 13 supported tuples equals one softmax over
    //    the composed logits. Each head's product term is
    //    exp(v/T)*exp(o/T)*exp(p/T) / (Zv*Zo*Zp), the composed numerator is
    //    exp((v+o+p)/T), and the per-head normalizers are a constant factor that
    //    the renormalization divides out.
    //
    // This test records identity 2 as a property. What actually changes the
    // answer is the normalization SUPPORT, which the next test covers.
    const temperature = bundle.calibration.temperature;
    const vector = vectors[0] as GoldenVector;
    const expected = vector.families["factorized-logistic"] as GoldenFamily;
    const heads = factorizedHeadLogits(bundle.model, densify(vector));

    const frozenPipeline = stableSoftmax(
      applyTemperature(composeFactorizedLogits(heads, bundle.model.classHeadIndices), temperature),
    );
    compareVector("factorized.probabilities", frozenPipeline, expected.probabilities);

    const verbProbabilities = stableSoftmax(applyTemperature(heads.verb, temperature));
    const objectProbabilities = stableSoftmax(applyTemperature(heads.objectKind, temperature));
    const propertyProbabilities = stableSoftmax(
      applyTemperature(heads.transitionProperty, temperature),
    );
    const perHeadProduct = bundle.model.classHeadIndices.map(
      (mapping) =>
        (verbProbabilities[mapping.verbIndex] as number) *
        (objectProbabilities[mapping.objectIndex] as number) *
        (propertyProbabilities[mapping.transitionPropertyIndex] as number),
    );
    const total = perHeadProduct.reduce((sum, value) => sum + value, 0);
    for (let k = 0; k < perHeadProduct.length; k += 1) {
      compare(
        "factorized.perHeadNormalizationIdentity",
        (perHeadProduct[k] as number) / total,
        frozenPipeline[k] as number,
      );
    }
  });

  it("normalizes over the 13 supported tuples, not the 900 unrestricted combinations", () => {
    // This is the substantive choice. Normalizing over the full verb x object x
    // property Cartesian product puts mass on combinations the support matrix
    // does not admit, which changes every probability and therefore every
    // calibration and selective-prediction metric downstream.
    const temperature = bundle.calibration.temperature;
    const vector = vectors[0] as GoldenVector;
    const heads = factorizedHeadLogits(bundle.model, densify(vector));
    const frozenPipeline = stableSoftmax(
      applyTemperature(composeFactorizedLogits(heads, bundle.model.classHeadIndices), temperature),
    );

    const unrestricted: number[] = [];
    for (let v = 0; v < heads.verb.length; v += 1) {
      for (let o = 0; o < heads.objectKind.length; o += 1) {
        for (let p = 0; p < heads.transitionProperty.length; p += 1) {
          unrestricted.push(
            ((heads.verb[v] as number) +
              (heads.objectKind[o] as number) +
              (heads.transitionProperty[p] as number)) /
              temperature,
          );
        }
      }
    }
    expect(unrestricted).toHaveLength(900);
    const unrestrictedProbabilities = stableSoftmax(unrestricted);

    const supportedMass = bundle.model.classHeadIndices.reduce((sum, mapping) => {
      const flat =
        mapping.verbIndex * heads.objectKind.length * heads.transitionProperty.length +
        mapping.objectIndex * heads.transitionProperty.length +
        mapping.transitionPropertyIndex;
      return sum + (unrestrictedProbabilities[flat] as number);
    }, 0);

    // The 13 supported tuples do not carry all the unrestricted mass, so the two
    // distributions genuinely differ rather than differing in the last bits.
    expect(supportedMass).toBeLessThan(1 - TOLERANCE);
    const divergence = Math.max(
      ...bundle.model.classHeadIndices.map((mapping, index) => {
        const flat =
          mapping.verbIndex * heads.objectKind.length * heads.transitionProperty.length +
          mapping.objectIndex * heads.transitionProperty.length +
          mapping.transitionPropertyIndex;
        return Math.abs(
          (unrestrictedProbabilities[flat] as number) - (frozenPipeline[index] as number),
        );
      }),
    );
    expect(divergence).toBeGreaterThan(TOLERANCE);
  });

  it("applies temperature to the composed tuple logits", () => {
    const temperature = bundle.calibration.temperature;
    const vector = vectors[0] as GoldenVector;
    const expected = vector.families["factorized-logistic"] as GoldenFamily;
    const heads = factorizedHeadLogits(bundle.model, densify(vector));
    const composed = composeFactorizedLogits(heads, bundle.model.classHeadIndices);

    // Raw and scaled are distinct recorded values, and the scaled vector is
    // exactly the composed raw vector divided by the frozen temperature.
    compareVector("factorized.rawTupleLogits", composed, expected.rawTupleLogits);
    const scaled = applyTemperature(composed, temperature);
    for (let k = 0; k < scaled.length; k += 1) {
      expect(scaled[k]).toBe((composed[k] as number) / temperature);
    }
    compareVector("factorized.scaledTupleLogits", scaled, expected.scaledTupleLogits);
  });

  it("produces the same result through the end-to-end entry point", () => {
    for (const vector of vectors) {
      const expected = vector.families["factorized-logistic"] as GoldenFamily;
      const result = inferFactorized(bundle.model, densify(vector), bundle.calibration.temperature);
      compareVector(
        "factorized.endToEnd.rawTupleLogits",
        result.rawTupleLogits,
        expected.rawTupleLogits,
      );
      compareVector(
        "factorized.endToEnd.probabilities",
        result.probabilities,
        expected.probabilities,
      );
      expect(result.diagnostics.selectedClassNumber).toBe(expected.selectedClassNumber);
      expect(result.headLogits).not.toBeNull();
    }
  });
});

describe("frozen unknown-feature case", () => {
  interface UnknownCase {
    readonly recordId: string;
    readonly expectedEqualToRecordId: string;
    readonly featureIndices: readonly number[];
    readonly outOfVocabularyIndices: readonly number[];
  }
  const unknownCase = golden.unknownFeatureCase as UnknownCase;

  it("ignores out-of-vocabulary indices without expanding the vector", () => {
    const baseline = vectors.find(
      (vector) => vector.recordId === unknownCase.expectedEqualToRecordId,
    );
    if (baseline === undefined) {
      throw new Error("golden unknown-feature case references an absent record");
    }
    expect(unknownCase.outOfVocabularyIndices.length).toBeGreaterThan(0);
    for (const index of unknownCase.outOfVocabularyIndices) {
      expect(index).toBeGreaterThanOrEqual(370);
    }

    const indices = [...unknownCase.featureIndices, ...unknownCase.outOfVocabularyIndices];
    const values = indices.map(() => 1);
    const densified = densifyFeatures(indices, values);

    // The vector stays exactly 370 long and the known features are untouched.
    expect(densified.vector).toHaveLength(370);
    expect(densified.ignoredIndices).toEqual([...unknownCase.outOfVocabularyIndices]);
    expect(densified.activeCount).toBe(unknownCase.featureIndices.length);
    expect(densified.vector).toEqual(
      densifyFeatures(baseline.featureIndices, baseline.featureValues).vector,
    );
  });

  it("produces logits identical to the same row without the unknown indices", () => {
    const baseline = vectors.find(
      (vector) => vector.recordId === unknownCase.expectedEqualToRecordId,
    );
    if (baseline === undefined) {
      throw new Error("golden unknown-feature case references an absent record");
    }
    const indices = [...unknownCase.featureIndices, ...unknownCase.outOfVocabularyIndices];
    const withUnknown = densifyFeatures(
      indices,
      indices.map(() => 1),
    ).vector;
    const without = densifyFeatures(baseline.featureIndices, baseline.featureValues).vector;

    // Byte-equal, not merely within tolerance: an ignored index must not perturb
    // the arithmetic at all.
    expect(jointRawLogits(frozen.joint.model, withUnknown)).toEqual(
      jointRawLogits(frozen.joint.model, without),
    );
    expect(factorizedHeadLogits(frozen.factorized.model, withUnknown)).toEqual(
      factorizedHeadLogits(frozen.factorized.model, without),
    );
  });
});

describe("parity summary", () => {
  it("reports the worst absolute error observed for every compared quantity", () => {
    const rows = [...worst.entries()].sort(([a], [b]) => a.localeCompare(b));
    expect(rows.length).toBeGreaterThan(0);

    const lines = rows.map(([label, error]) => `  ${label.padEnd(44)} ${error.toExponential(3)}`);
    // Printed so the Sprint-4A report can quote measured maxima. This runs last
    // within the file; Vitest executes describe blocks in declaration order.
    console.info(
      [`FC-008 Sprint 4A parity: ${vectors.length} vectors, tolerance ${TOLERANCE}`, ...lines].join(
        "\n",
      ),
    );

    for (const [label, error] of rows) {
      expect(error, `${label} worst absolute error`).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});
