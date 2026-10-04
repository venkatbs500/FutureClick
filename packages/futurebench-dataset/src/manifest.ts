/**
 * Immutable hashed dataset manifests.
 *
 * A manifest is the answer to "which data was this result computed on". For that to
 * mean anything it has to reproduce: given the same scenarios, the same manifest
 * bytes and the same hashes, on any machine and in any order.
 *
 * TWO RULES MAKE THAT TRUE
 *
 * No build time anywhere in canonical content. A manifest carrying the instant it
 * was generated could never reproduce, so rather than hashing a timestamp and
 * excluding it by convention, no timestamp is recorded at all.
 *
 * Every collection sorted by a stable key before hashing. Record order out of the
 * generator is deterministic today, but a manifest whose hash depends on iteration
 * order is a trap waiting for the first refactor.
 */

import {
  FC008_DATASET_PARTITIONS,
  FC008_FEATURE_POLICY_VERSION,
  FC008_SUPPORT_MATRIX_VERSION,
  type Fc008DatasetPartition,
  type FeatureVocabulary,
} from "@futureclick/action-understanding";
import { canonicalJson, canonicalSha256, hashChain, sha256Hex } from "./canonical.js";
import type { FutureBenchRecord } from "./record.js";
import type { ApplicationFamily } from "./scenario.js";

export const FUTUREBENCH_MANIFEST_SCHEMA_VERSION = "1.0";

/**
 * One application family.
 *
 * LINEAGE, VARIANT, AND RECORD ARE THREE DIFFERENT THINGS
 *
 * `parentLineageIds` holds AUTHORED lineages — the independently written scenario
 * implementations, which are the unit of independence and of partition assignment.
 * `templateInstanceIds` holds the per-variant template ids, and `recordCount` counts
 * records. Conflating them is how a manifest comes to overstate how much independent
 * material a family contains.
 *
 * This field previously held `templateLineageId`, which is unique per variant, so
 * Family A reported 314 lineages when it has 33 authored ones and the rest are its
 * own paraphrases and relayouts. A reviewer reading that number would have concluded
 * the corpus had an order of magnitude more independent material than it does, which
 * is the single most misleading thing a dataset manifest can say.
 */
export interface ApplicationFamilyManifestEntry {
  readonly applicationFamilyId: string;
  readonly independenceBasis: string;
  /** Authored parent lineages. The unit of independence. */
  readonly parentLineageIds: readonly string[];
  /** Per-variant template instance ids. Derived material, not independent. */
  readonly templateInstanceIds: readonly string[];
  /** Scenarios the family declares, canonical and derived together. */
  readonly scenarioCount: number;
  /** Records actually built from this family. */
  readonly recordCount: number;
  /** Classes this family provides scenarios for. */
  readonly classNumbers: readonly number[];
}

/**
 * One AUTHORED lineage, with every scenario derived from it folded in.
 *
 * Keyed on `parentLineageId`, not `templateLineageId`. The latter is unique per
 * variant, so keying on it would produce one entry per record — a second copy of
 * the records section carrying no information it does not already hold, and
 * obscuring the fact a reviewer actually comes here for: which authored lineage
 * landed in which partition. The authored lineage is also the unit partitioning
 * works on, so it is the unit whose partition is worth pinning.
 */
export interface LineageManifestEntry {
  readonly parentLineageId: string;
  readonly applicationFamilyId: string;
  readonly partition: Fc008DatasetPartition;
  readonly classNumber: number | null;
  readonly scenarioCount: number;
  readonly variantKinds: readonly string[];
}

export interface RecordManifestEntry {
  readonly recordId: string;
  readonly recordHash: string;
  readonly partition: Fc008DatasetPartition;
  readonly classNumber: number | null;
}

export interface PartitionManifestEntry {
  readonly partition: Fc008DatasetPartition;
  readonly recordCount: number;
  readonly classNumbers: readonly number[];
  /** Hash chain over this partition's record hashes, in sorted record order. */
  readonly partitionHash: string;
}

export interface FutureBenchManifest {
  readonly schemaVersion: string;
  readonly datasetVersion: string;
  readonly generatorVersion: string;
  readonly supportMatrixVersion: string;
  readonly featurePolicyVersion: string;
  readonly vocabularyVersion: string;
  readonly vocabularySize: number;
  /** Hash over the vocabulary's names and indices, in index order. */
  readonly vocabularyHash: string;
  readonly applicationFamilies: readonly ApplicationFamilyManifestEntry[];
  readonly lineages: readonly LineageManifestEntry[];
  readonly partitions: readonly PartitionManifestEntry[];
  readonly records: readonly RecordManifestEntry[];
  /** Hash chain over every record hash, in sorted record-id order. */
  readonly datasetHash: string;
}

/**
 * Hashes a vocabulary by its name/index pairs in index order.
 *
 * Index order rather than insertion order: the indices are the artifact, and two
 * vocabularies with the same names but different indices are different feature
 * spaces and must hash differently.
 */
export function hashVocabulary(vocabulary: FeatureVocabulary): string {
  const pairs = [...vocabulary.entries.entries()]
    .sort(([, a], [, b]) => a - b)
    .map(([name, index]) => [index, name] as const);
  return canonicalSha256({
    vocabularyVersion: vocabulary.vocabularyVersion,
    featurePolicyVersion: vocabulary.featurePolicyVersion,
    size: vocabulary.size,
    entries: pairs.map(([index, name]) => ({ index, name })),
  });
}

export interface ManifestInput {
  readonly families: readonly ApplicationFamily[];
  readonly records: readonly FutureBenchRecord[];
  readonly vocabulary: FeatureVocabulary;
  readonly datasetVersion: string;
  readonly generatorVersion: string;
}

/** Builds the manifest. Pure: identical input yields identical output. */
export function buildManifest(input: ManifestInput): FutureBenchManifest {
  const recordsSorted = [...input.records].sort((a, b) =>
    a.recordId.localeCompare(b.recordId, "en"),
  );

  const recordEntries: RecordManifestEntry[] = recordsSorted.map((record) => ({
    recordId: record.recordId,
    recordHash: record.recordHash,
    partition: record.partition,
    classNumber: record.oracle.classNumber,
  }));

  const familyEntries: ApplicationFamilyManifestEntry[] = [...input.families]
    .sort((a, b) => a.applicationFamilyId.localeCompare(b.applicationFamilyId, "en"))
    .map((family) => {
      const familyRecords = recordsSorted.filter(
        (record) => record.lineage.applicationFamilyId === family.applicationFamilyId,
      );
      const classNumbers = [
        ...new Set(
          familyRecords
            .map((record) => record.oracle.classNumber)
            .filter((value): value is number => value !== null),
        ),
      ].sort((a, b) => a - b);
      return {
        applicationFamilyId: family.applicationFamilyId,
        independenceBasis: family.independenceBasis,
        parentLineageIds: [
          ...new Set(family.scenarios.map((scenario) => scenario.parentLineageId)),
        ].sort(),
        templateInstanceIds: [
          ...new Set(family.scenarios.map((scenario) => scenario.templateLineageId)),
        ].sort(),
        scenarioCount: family.scenarios.length,
        recordCount: familyRecords.length,
        classNumbers,
      };
    });

  const lineageMap = new Map<string, LineageManifestEntry>();
  for (const record of recordsSorted) {
    const key = record.lineage.parentLineageId;
    const existing = lineageMap.get(key);
    if (existing === undefined) {
      lineageMap.set(key, {
        parentLineageId: key,
        applicationFamilyId: record.lineage.applicationFamilyId,
        partition: record.partition,
        classNumber: record.oracle.classNumber,
        scenarioCount: 1,
        variantKinds: [record.lineage.variantKind],
      });
      continue;
    }
    if (existing.partition !== record.partition) {
      // Refuse rather than record the first partition seen. A lineage split across
      // partitions is the leakage the audit exists to block, and a manifest that
      // quietly named one of the two would be a document asserting the dataset is
      // sound while describing one that is not.
      throw new Error(
        `lineage ${key} spans partitions ${existing.partition} and ${record.partition}`,
      );
    }
    lineageMap.set(key, {
      ...existing,
      scenarioCount: existing.scenarioCount + 1,
      variantKinds: [...new Set([...existing.variantKinds, record.lineage.variantKind])].sort(),
    });
  }
  const lineageEntries = [...lineageMap.values()].sort((a, b) =>
    a.parentLineageId.localeCompare(b.parentLineageId, "en"),
  );

  const partitionEntries: PartitionManifestEntry[] = FC008_DATASET_PARTITIONS.map((partition) => {
    const inPartition = recordsSorted.filter((record) => record.partition === partition);
    return {
      partition,
      recordCount: inPartition.length,
      classNumbers: [
        ...new Set(
          inPartition
            .map((record) => record.oracle.classNumber)
            .filter((value): value is number => value !== null),
        ),
      ].sort((a, b) => a - b),
      partitionHash: hashChain(inPartition.map((record) => record.recordHash)),
    };
  });

  return Object.freeze({
    schemaVersion: FUTUREBENCH_MANIFEST_SCHEMA_VERSION,
    datasetVersion: input.datasetVersion,
    generatorVersion: input.generatorVersion,
    supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
    featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
    vocabularyVersion: input.vocabulary.vocabularyVersion,
    vocabularySize: input.vocabulary.size,
    vocabularyHash: hashVocabulary(input.vocabulary),
    applicationFamilies: Object.freeze(familyEntries),
    lineages: Object.freeze(lineageEntries),
    partitions: Object.freeze(partitionEntries),
    records: Object.freeze(recordEntries),
    datasetHash: hashChain(recordEntries.map((entry) => entry.recordHash)),
  });
}

/** Canonical text of a manifest. The bytes a reviewer should hash. */
export function canonicalManifestText(manifest: FutureBenchManifest): string {
  return canonicalJson(JSON.parse(JSON.stringify(manifest)) as unknown);
}

/** SHA-256 over the whole canonical manifest. */
export function manifestHash(manifest: FutureBenchManifest): string {
  return sha256Hex(canonicalManifestText(manifest));
}
