/**
 * The development-only bridge from FutureBench to the Python research trainer.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * Sprint 3 is the first sprint allowed to fit a model, which makes it the first
 * sprint that can invalidate the benchmark. The failure is not dramatic: someone
 * loads the whole corpus into a trainer, iterates on a metric that happens to be
 * computed over every partition, and the held-out sets quietly become development
 * data. Nothing crashes and no test fails, but every number reported afterwards is
 * worthless, and the damage is undetectable from the outside.
 *
 * So the training path is not given the corpus and asked to behave. It is given an
 * export that STRUCTURALLY CANNOT CONTAIN the sealed partitions. `test-id`,
 * `test-ooa`, and `test-novelty` are rejected here, before serialization, and the
 * exporter refuses rather than filtering — a silent filter would make an over-broad
 * request look like a correct one.
 *
 * WHAT CROSSES THE BOUNDARY
 *
 * Projected feature vectors and labels, not text. The sanitizer already decided what
 * was safe enough to become a token in Sprint 2, and re-exporting the strings would
 * re-open that question for no benefit: the trainer consumes indices into the frozen
 * 370-feature vocabulary and never needs to know what any of them mean. Raw surface
 * text and application-family identity are therefore absent, the latter because a
 * site-identity feature is exactly the shortcut the OOA split exists to prevent.
 *
 * The labels are derived from the frozen support matrix rather than recomputed, so
 * the factorized head targets cannot drift from the joint class they decompose.
 */

import {
  FC008_MATRIX_OBJECT_KINDS,
  FC008_MATRIX_TRANSITION_PROPERTIES,
  FC008_MATRIX_VERBS,
  FC008_PROJECTOR_VERSION,
  FC008_SUPPORT_MATRIX,
  FC008_SUPPORT_MATRIX_VERSION,
  type Fc008DatasetPartition,
  type FeaturePolicy,
  type FeatureVocabulary,
  projectPrimaryFeatures,
} from "@futureclick/action-understanding";
import type { FutureBenchRecord } from "./record.js";

/** Schema version of the export envelope itself. */
export const FC008_DEVELOPMENT_EXPORT_SCHEMA_VERSION = "1.0" as const;

/**
 * Partitions the model-development path may read.
 *
 * Frozen here and duplicated nowhere. Sprint 2 assigned the roles; this list is the
 * single place the TRAINING side encodes them.
 */
export const FC008_DEVELOPMENT_PARTITIONS: readonly Fc008DatasetPartition[] = Object.freeze([
  "train",
  "calibration",
  "policy-validation",
]);

/**
 * Partitions sealed for Sprint 3.
 *
 * Listed explicitly rather than derived as "everything else". A derived complement
 * would silently admit any partition added later, which is the opposite of what a
 * seal should do when the world changes.
 */
export const FC008_SEALED_PARTITIONS: readonly Fc008DatasetPartition[] = Object.freeze([
  "test-id",
  "test-ooa",
  "test-novelty",
]);

/** One development row: a feature vector and its labels, with provenance. */
export interface DevelopmentRow {
  readonly recordId: string;
  readonly parentLineageId: string;
  readonly partition: Fc008DatasetPartition;
  /** Ascending vocabulary indices of active features. */
  readonly featureIndices: readonly number[];
  readonly featureValues: readonly number[];
  /** Canonical external class, 1..13. */
  readonly classNumber: number;
  /** Zero-based indices into the frozen head vocabularies. */
  readonly verbIndex: number;
  readonly objectIndex: number;
  readonly transitionPropertyIndex: number;
  readonly unknownTokenCount: number;
}

/** Per-partition access accounting, including the sealed partitions at zero. */
export interface DevelopmentAccessReport {
  readonly developmentRowsByPartition: readonly { partition: string; rows: number }[];
  readonly sealedRowsByPartition: readonly { partition: string; rows: number }[];
  readonly sealedTotalRows: number;
}

/** One supported class, with the head indices its tuple decomposes into. */
export interface ClassOrderEntry {
  readonly classNumber: number;
  readonly verb: string;
  readonly objectKind: string;
  readonly transitionProperty: string;
  readonly verbIndex: number;
  readonly objectIndex: number;
  readonly transitionPropertyIndex: number;
}

export interface DevelopmentExport {
  readonly schemaVersion: typeof FC008_DEVELOPMENT_EXPORT_SCHEMA_VERSION;
  readonly datasetHash: string;
  readonly vocabularyHash: string;
  readonly manifestHash: string;
  readonly featurePolicyVersion: string;
  readonly supportMatrixVersion: string;
  readonly projectorVersion: string;
  readonly vocabularyVersion: string;
  /** Feature names in permanent index order. Index i is `featureOrder[i]`. */
  readonly featureOrder: readonly string[];
  readonly classOrder: readonly ClassOrderEntry[];
  readonly verbOrder: readonly string[];
  readonly objectOrder: readonly string[];
  readonly transitionPropertyOrder: readonly string[];
  readonly developmentPartitions: readonly string[];
  readonly sealedPartitions: readonly string[];
  readonly rows: readonly DevelopmentRow[];
  readonly accessReport: DevelopmentAccessReport;
}

export type DevelopmentExportResult =
  | { readonly ok: true; readonly export: DevelopmentExport }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

export interface DevelopmentExportInput {
  readonly records: readonly FutureBenchRecord[];
  readonly vocabulary: FeatureVocabulary;
  readonly policy: FeaturePolicy;
  readonly datasetHash: string;
  readonly vocabularyHash: string;
  readonly manifestHash: string;
}

/** Feature names in index order, or null when the indices are not contiguous. */
function featureOrderOf(vocabulary: FeatureVocabulary): string[] | null {
  const order = new Array<string | undefined>(vocabulary.size);
  for (const [name, index] of vocabulary.entries) {
    if (!Number.isInteger(index) || index < 0 || index >= vocabulary.size) {
      return null;
    }
    if (order[index] !== undefined) {
      return null;
    }
    order[index] = name;
  }
  const dense: string[] = [];
  for (const name of order) {
    if (name === undefined) {
      return null;
    }
    dense.push(name);
  }
  return dense;
}

/**
 * The frozen class order, 1..13, with each tuple's head decomposition.
 *
 * Built from the support matrix so the joint class and the three factorized targets
 * are the same fact written three ways. Deriving the head indices anywhere else would
 * let a head learn a target that does not correspond to the class it is composed into.
 */
export function buildClassOrder(): readonly ClassOrderEntry[] {
  return Object.freeze(
    FC008_SUPPORT_MATRIX.map((entry) => {
      const verbIndex = FC008_MATRIX_VERBS.indexOf(entry.tuple.verb);
      const objectIndex = FC008_MATRIX_OBJECT_KINDS.indexOf(entry.tuple.objectKind);
      const transitionPropertyIndex = FC008_MATRIX_TRANSITION_PROPERTIES.indexOf(
        entry.tuple.transition.property,
      );
      return {
        classNumber: entry.classNumber,
        verb: entry.tuple.verb,
        objectKind: entry.tuple.objectKind,
        transitionProperty: entry.tuple.transition.property,
        verbIndex,
        objectIndex,
        transitionPropertyIndex,
      };
    }),
  );
}

/**
 * Projects the development partitions into feature vectors and labels.
 *
 * REFUSES on any sealed partition. The refusal is deliberately not a filter: a
 * caller that asked for test data gets an error, so an over-broad request is visible
 * instead of being quietly narrowed into a request that looks correct.
 *
 * Also refuses records with no resolved class. Every development row must carry all
 * four labels, and a half-labelled row reaching a trainer would either crash it later
 * or, worse, be silently coerced into a class.
 */
export function exportDevelopmentCorpus(input: DevelopmentExportInput): DevelopmentExportResult {
  const sealed = new Set<string>(FC008_SEALED_PARTITIONS);
  const development = new Set<string>(FC008_DEVELOPMENT_PARTITIONS);

  const sealedSeen = new Map<string, number>();
  for (const partition of FC008_SEALED_PARTITIONS) {
    sealedSeen.set(partition, 0);
  }
  for (const record of input.records) {
    if (sealed.has(record.partition)) {
      sealedSeen.set(record.partition, (sealedSeen.get(record.partition) ?? 0) + 1);
    }
  }
  const offered = [...sealedSeen.entries()].filter(([, count]) => count > 0);
  if (offered.length > 0) {
    return {
      ok: false,
      reason: "sealed-partition-offered-to-development-export",
      detail: offered.map(([partition, count]) => `${partition}=${count}`).join(", "),
    };
  }

  const featureOrder = featureOrderOf(input.vocabulary);
  if (featureOrder === null) {
    return {
      ok: false,
      reason: "vocabulary-indices-not-contiguous",
      detail: `size ${input.vocabulary.size}`,
    };
  }

  const classOrder = buildClassOrder();
  const headIndexByClass = new Map(classOrder.map((entry) => [entry.classNumber, entry]));

  const rows: DevelopmentRow[] = [];
  const perPartition = new Map<string, number>();
  for (const partition of FC008_DEVELOPMENT_PARTITIONS) {
    perPartition.set(partition, 0);
  }

  for (const record of input.records) {
    if (!development.has(record.partition)) {
      return {
        ok: false,
        reason: "unknown-partition-offered-to-development-export",
        detail: `${record.recordId} is in ${record.partition}`,
      };
    }
    const classNumber = record.oracle.classNumber;
    if (classNumber === null) {
      return {
        ok: false,
        reason: "unlabelled-record-offered-to-development-export",
        detail: record.recordId,
      };
    }
    const heads = headIndexByClass.get(classNumber);
    if (heads === undefined) {
      return {
        ok: false,
        reason: "class-absent-from-support-matrix",
        detail: `${record.recordId} claims class ${classNumber}`,
      };
    }
    const projection = projectPrimaryFeatures(
      record.observation.semantics,
      input.vocabulary,
      input.policy,
    );
    if (!projection.ok) {
      return {
        ok: false,
        reason: "feature-projection-failed",
        detail: `${record.recordId}: ${projection.reason}`,
      };
    }
    rows.push({
      recordId: record.recordId,
      parentLineageId: record.lineage.parentLineageId,
      partition: record.partition,
      featureIndices: [...projection.projection.vector.indices],
      featureValues: [...projection.projection.vector.values],
      classNumber,
      verbIndex: heads.verbIndex,
      objectIndex: heads.objectIndex,
      transitionPropertyIndex: heads.transitionPropertyIndex,
      unknownTokenCount: projection.projection.unknownTokenCount,
    });
    perPartition.set(record.partition, (perPartition.get(record.partition) ?? 0) + 1);
  }

  // Sorted by record id so the export bytes do not depend on iteration order.
  rows.sort((left, right) => (left.recordId < right.recordId ? -1 : 1));

  return {
    ok: true,
    export: {
      schemaVersion: FC008_DEVELOPMENT_EXPORT_SCHEMA_VERSION,
      datasetHash: input.datasetHash,
      vocabularyHash: input.vocabularyHash,
      manifestHash: input.manifestHash,
      featurePolicyVersion: input.policy.version,
      supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
      projectorVersion: FC008_PROJECTOR_VERSION,
      vocabularyVersion: input.vocabulary.vocabularyVersion,
      featureOrder,
      classOrder,
      verbOrder: [...FC008_MATRIX_VERBS],
      objectOrder: [...FC008_MATRIX_OBJECT_KINDS],
      transitionPropertyOrder: [...FC008_MATRIX_TRANSITION_PROPERTIES],
      developmentPartitions: [...FC008_DEVELOPMENT_PARTITIONS],
      sealedPartitions: [...FC008_SEALED_PARTITIONS],
      rows,
      accessReport: {
        developmentRowsByPartition: FC008_DEVELOPMENT_PARTITIONS.map((partition) => ({
          partition,
          rows: perPartition.get(partition) ?? 0,
        })),
        // Read from the same counter that drove the refusal above, not written as a
        // literal zero. Both are provably zero here, but a literal could never
        // report anything else, which would make the field decorative.
        sealedRowsByPartition: FC008_SEALED_PARTITIONS.map((partition) => ({
          partition,
          rows: sealedSeen.get(partition) ?? 0,
        })),
        sealedTotalRows: [...sealedSeen.values()].reduce((total, count) => total + count, 0),
      },
    },
  };
}
