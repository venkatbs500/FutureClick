/**
 * Deterministic vocabulary fitting, restricted to the TRAIN partition.
 *
 * WHY THE RESTRICTION IS A TYPE AND NOT A COMMENT
 *
 * Fitting a vocabulary is a learning step. A vocabulary fitted over calibration,
 * policy-validation, or any test partition has seen data those partitions exist to
 * keep unseen, and the inflated generalization number that follows cannot be
 * detected from the artifact afterwards.
 *
 * So `fitFeatureVocabulary` does not accept samples. It accepts a `TrainOnlyCorpus`,
 * which carries a private brand and can only be produced by `openTrainOnlyCorpus`,
 * which refuses any sample whose partition is not `train`. Passing a test partition
 * is therefore a COMPILE error, and assembling a corpus from mixed partitions is a
 * RUNTIME refusal. Both doors are shut, because either alone can be walked around.
 *
 * WHY THIS LIVES IN THE OFFLINE PACKAGE
 *
 * `@futureclick/action-understanding` ships to the browser. Exporting a fitting
 * function from it would place a learning capability in the runtime surface for no
 * reason, so the fitter lives here and the runtime only ever consumes a finished
 * `FeatureVocabulary`.
 *
 * Nothing here fits weights or a temperature. Those are Sprint 3.
 */

import {
  FC008_FEATURE_POLICY_VERSION,
  FC008_FITTABLE_PARTITION,
  FC008_SAFETY_CAPS,
  type Fc008DatasetPartition,
  type FeatureVocabulary,
  type ObservationSemantics,
  enumerateCandidateFeatures,
  isFittablePartition,
} from "@futureclick/action-understanding";

/** One sample offered for vocabulary fitting. */
export interface VocabularyFitSample {
  readonly partition: Fc008DatasetPartition;
  readonly semantics: ObservationSemantics;
}

/**
 * A corpus proven to contain train samples only.
 *
 * The brand is a phantom property: `TRAIN_ONLY_BRAND` is declared as a type and
 * never exists at runtime, so no object literal outside this module satisfies the
 * interface and the fitter cannot be handed an unvetted array even by a determined
 * caller. The constructor below therefore asserts the brand rather than assigning
 * it — assigning would require a runtime symbol the declaration does not provide.
 */
declare const TRAIN_ONLY_BRAND: unique symbol;

export interface TrainOnlyCorpus {
  readonly [TRAIN_ONLY_BRAND]: true;
  readonly samples: readonly VocabularyFitSample[];
}

export type OpenCorpusResult =
  | { readonly ok: true; readonly corpus: TrainOnlyCorpus }
  | {
      readonly ok: false;
      readonly reason: "non-train-partition-present" | "empty-corpus";
      /** Which forbidden partitions were present. Never sample content. */
      readonly offendingPartitions: readonly Fc008DatasetPartition[];
    };

/**
 * Admits samples to a train-only corpus, refusing any other partition.
 *
 * Reports every offending partition rather than only the first, so one run surfaces
 * the whole contamination problem.
 */
export function openTrainOnlyCorpus(samples: readonly VocabularyFitSample[]): OpenCorpusResult {
  const offending = new Set<Fc008DatasetPartition>();
  for (const sample of samples) {
    // Checked against the architecture package's own rule table rather than a
    // local string comparison, so there is one definition of "fittable".
    if (sample.partition !== FC008_FITTABLE_PARTITION || !isFittablePartition(sample.partition)) {
      offending.add(sample.partition);
    }
  }
  if (offending.size > 0) {
    return {
      ok: false,
      reason: "non-train-partition-present",
      offendingPartitions: Object.freeze([...offending].sort()),
    };
  }
  if (samples.length === 0) {
    return { ok: false, reason: "empty-corpus", offendingPartitions: [] };
  }
  return {
    ok: true,
    // The brand is asserted, not assigned: it exists only in the type system, so
    // writing it would reference a symbol that is absent at runtime. This is the
    // one place in the package permitted to assert it, and it is reachable only
    // after every sample has passed the fittable-partition check above.
    corpus: { samples: Object.freeze([...samples]) } as unknown as TrainOnlyCorpus,
  };
}

export interface VocabularyFitOptions {
  /** Minimum number of train samples a feature must appear in to be admitted. */
  readonly minDocumentFrequency: number;
  /** Hard ceiling, which may not exceed the absolute safety cap. */
  readonly maxVocabulary: number;
  readonly vocabularyVersion: string;
}

export const DEFAULT_VOCABULARY_FIT_OPTIONS: VocabularyFitOptions = Object.freeze({
  minDocumentFrequency: 2,
  maxVocabulary: FC008_SAFETY_CAPS.maxFeatureVocabulary,
  vocabularyVersion: "fb-vocab-1",
});

export interface VocabularyFitDiagnostics {
  readonly trainSampleCount: number;
  readonly distinctCandidateCount: number;
  readonly belowFrequencyFloorCount: number;
  readonly truncatedByCeilingCount: number;
}

export type VocabularyFitResult =
  | {
      readonly ok: true;
      readonly vocabulary: FeatureVocabulary;
      readonly diagnostics: VocabularyFitDiagnostics;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Fits a feature vocabulary from a train-only corpus.
 *
 * Index assignment does not depend on sample order: features are ranked by
 * descending document frequency and then lexicographically, so the same corpus in
 * any order yields the same indices. That is what makes the manifests reproducible
 * and what will let Sprint 4 compare Python and TypeScript vectors index by index.
 *
 * Candidate names come from `enumerateCandidateFeatures`, the same function the
 * projector uses, so the vocabulary cannot contain a name the projector never emits
 * nor miss one it does.
 */
export function fitFeatureVocabulary(
  corpus: TrainOnlyCorpus,
  options: VocabularyFitOptions = DEFAULT_VOCABULARY_FIT_OPTIONS,
): VocabularyFitResult {
  if (!Number.isInteger(options.maxVocabulary) || options.maxVocabulary <= 0) {
    return { ok: false, reason: "max-vocabulary-must-be-a-positive-integer" };
  }
  if (options.maxVocabulary > FC008_SAFETY_CAPS.maxFeatureVocabulary) {
    return { ok: false, reason: "max-vocabulary-exceeds-absolute-cap" };
  }
  if (!Number.isInteger(options.minDocumentFrequency) || options.minDocumentFrequency < 1) {
    return { ok: false, reason: "min-document-frequency-must-be-at-least-one" };
  }

  const documentFrequency = new Map<string, number>();
  for (const sample of corpus.samples) {
    const namesInSample = new Set<string>();
    for (const candidate of enumerateCandidateFeatures(sample.semantics)) {
      namesInSample.add(candidate.name);
    }
    for (const name of namesInSample) {
      documentFrequency.set(name, (documentFrequency.get(name) ?? 0) + 1);
    }
  }

  const admitted: string[] = [];
  let belowFloor = 0;
  for (const [name, frequency] of documentFrequency) {
    if (frequency < options.minDocumentFrequency) {
      belowFloor += 1;
      continue;
    }
    admitted.push(name);
  }

  admitted.sort((a, b) => {
    const byFrequency = (documentFrequency.get(b) ?? 0) - (documentFrequency.get(a) ?? 0);
    return byFrequency !== 0 ? byFrequency : a.localeCompare(b, "en");
  });

  const kept = admitted.slice(0, options.maxVocabulary);
  const entries = new Map<string, number>();
  for (const [index, name] of kept.entries()) {
    entries.set(name, index);
  }

  return {
    ok: true,
    vocabulary: Object.freeze({
      vocabularyVersion: options.vocabularyVersion,
      featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
      entries,
      size: entries.size,
    }),
    diagnostics: {
      trainSampleCount: corpus.samples.length,
      distinctCandidateCount: documentFrequency.size,
      belowFrequencyFloorCount: belowFloor,
      truncatedByCeilingCount: admitted.length - kept.length,
    },
  };
}
