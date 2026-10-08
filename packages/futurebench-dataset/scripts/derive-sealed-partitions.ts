/**
 * Authoritative sealed-partition derivation for the FC-008 one-shot evaluator.
 *
 * Invoked only by the Python production builder after a RealOpeningPermit exists.
 * Ordinary tests, quality, and the development exporter do not run this file.
 *
 * Requires BOTH:
 *   --acknowledge-one-shot-holdout
 *   --enable-real-sealed-opening
 *
 * before `buildDataset` is called. Writes canonical JSON to stdout. Never writes
 * `fc008-final-test-corpus.json`.
 */

import {
  FC008_FEATURE_POLICY,
  FC008_FEATURE_POLICY_VERSION,
  FC008_SUPPORT_MATRIX_VERSION,
  projectPrimaryFeatures,
} from "@futureclick/action-understanding";
import { FUTUREBENCH_FAMILIES, FUTUREBENCH_HELD_OUT_FAMILY_IDS } from "../src/apps/index.js";
import {
  FUTUREBENCH_DATASET_VERSION,
  FUTUREBENCH_GENERATOR_VERSION,
  buildDataset,
} from "../src/dataset.js";
import { FC008_SEALED_PARTITIONS, buildClassOrder } from "../src/export.js";
import { buildManifest, manifestHash } from "../src/manifest.js";

const FROZEN = {
  dataset: "44f01040e479d331920434ed4987ff2d0bdaa85c8bb54d55842c35e697d290fa",
  vocabulary: "005212cce8104af27cbcb331c2635dd16b3db93ccdbd61841e70be3c0b29cb64",
  manifest: "aa74f73075720326e692c8da0e8ccd13c71f82c51e69d5b933b59ff060c64d77",
} as const;

const EXPECTED_COUNTS: Readonly<Record<string, number>> = {
  "test-id": 143,
  "test-ooa": 66,
  "test-novelty": 28,
};

function fail(message: string): never {
  process.stderr.write(`derive-sealed-partitions: ${message}\n`);
  process.exit(1);
}

function main(): void {
  const flags = new Set(process.argv.slice(2));
  if (!flags.has("--acknowledge-one-shot-holdout") || !flags.has("--enable-real-sealed-opening")) {
    fail("requires --acknowledge-one-shot-holdout and --enable-real-sealed-opening");
  }

  const built = buildDataset({
    families: FUTUREBENCH_FAMILIES,
    outOfApplicationFamilyIds: FUTUREBENCH_HELD_OUT_FAMILY_IDS,
  });
  if (!built.ok) {
    fail(`dataset refused: ${built.reason} ${built.detail}`);
  }

  const manifest = buildManifest({
    families: FUTUREBENCH_FAMILIES,
    records: built.records,
    vocabulary: built.vocabulary,
    datasetVersion: FUTUREBENCH_DATASET_VERSION,
    generatorVersion: FUTUREBENCH_GENERATOR_VERSION,
  });
  const actual = {
    dataset: manifest.datasetHash,
    vocabulary: manifest.vocabularyHash,
    manifest: manifestHash(manifest),
  };
  for (const key of ["dataset", "vocabulary", "manifest"] as const) {
    if (actual[key] !== FROZEN[key]) {
      fail(`${key} hash drifted: expected ${FROZEN[key]}, got ${actual[key]}`);
    }
  }

  const heads = new Map(buildClassOrder().map((entry) => [entry.classNumber, entry]));
  const sealed = new Set<string>(FC008_SEALED_PARTITIONS);
  const counts: Record<string, number> = { "test-id": 0, "test-ooa": 0, "test-novelty": 0 };
  const rows: object[] = [];

  for (const record of built.records) {
    if (!sealed.has(record.partition)) {
      continue;
    }
    const projection = projectPrimaryFeatures(
      record.observation.semantics,
      built.vocabulary,
      FC008_FEATURE_POLICY,
    );
    if (!projection.ok) {
      fail(`projection failed for a sealed record: ${projection.reason}`);
    }
    const classNumber = record.oracle.classNumber;
    const supported = classNumber !== null && record.oracle.disposition === "resolved";
    const isNovel = record.partition === "test-novelty" && !supported;
    const head = classNumber === null ? undefined : heads.get(classNumber);
    rows.push({
      recordId: record.recordId,
      parentLineageId: record.lineage.parentLineageId,
      partition: record.partition,
      applicationFamilyId: record.lineage.applicationFamilyId,
      featureIndices: [...projection.projection.vector.indices],
      featureValues: [...projection.projection.vector.values],
      classNumber,
      isNovel,
      supported,
      verbIndex: head?.verbIndex ?? null,
      objectIndex: head?.objectIndex ?? null,
      transitionPropertyIndex: head?.transitionPropertyIndex ?? null,
    });
    counts[record.partition] = (counts[record.partition] ?? 0) + 1;
  }

  for (const partition of FC008_SEALED_PARTITIONS) {
    if (counts[partition] !== EXPECTED_COUNTS[partition]) {
      fail(`count mismatch for ${partition}`);
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      datasetHash: actual.dataset,
      vocabularyHash: actual.vocabulary,
      sprint2ManifestHash: actual.manifest,
      supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
      featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
      rows,
    })}\n`,
  );
}

main();
