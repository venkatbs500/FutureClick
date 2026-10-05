/**
 * Writes the development-only feature export the Python trainer consumes.
 *
 * Deliberately a separate entry point rather than a flag on the dataset build. The
 * build produces all six partitions because the benchmark needs all six; this script
 * is the only place that hands any of them to a model, and keeping it separate means
 * the sealed partitions are dropped at a single auditable chokepoint instead of being
 * filtered at whichever call site happens to run next.
 *
 * Writes nothing and exits non-zero if the dataset does not reproduce the hashes
 * frozen in Sprint 2, so a trainer can never silently run against a drifted corpus.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FC008_FEATURE_POLICY } from "@futureclick/action-understanding";
import { FUTUREBENCH_FAMILIES, FUTUREBENCH_HELD_OUT_FAMILY_IDS } from "../src/apps/index.js";
import { canonicalJson, sha256Hex } from "../src/canonical.js";
import {
  FUTUREBENCH_DATASET_VERSION,
  FUTUREBENCH_GENERATOR_VERSION,
  buildDataset,
} from "../src/dataset.js";
import { FC008_DEVELOPMENT_PARTITIONS, exportDevelopmentCorpus } from "../src/export.js";
import { buildManifest, manifestHash } from "../src/manifest.js";

/** The Sprint-2 identities this export is only valid against. */
const FROZEN = {
  dataset: "44f01040e479d331920434ed4987ff2d0bdaa85c8bb54d55842c35e697d290fa",
  vocabulary: "005212cce8104af27cbcb331c2635dd16b3db93ccdbd61841e70be3c0b29cb64",
  manifest: "aa74f73075720326e692c8da0e8ccd13c71f82c51e69d5b933b59ff060c64d77",
} as const;

function fail(message: string): never {
  process.stderr.write(`export-development-corpus: ${message}\n`);
  process.exit(1);
}

/**
 * The repository root, derived from this file's own location.
 *
 * The default output path used to be resolved against the working directory, so running
 * the official export from the repository root instead of the package directory wrote
 * the corpus to a sibling of the repository rather than into it — silently, because the
 * frozen-hash assertions run before the write and passed either way. The path the
 * trainer reads is a fixed repository location, so it is derived from a fixed repository
 * location.
 *
 * An explicit argv path is still honoured, for exporting a copy somewhere scratch.
 */
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

export const CANONICAL_DEVELOPMENT_CORPUS_PATH = resolve(
  REPOSITORY_ROOT,
  "research/futurebench/data/fc008-development-corpus.json",
);

const outputPath = process.argv[2] ? resolve(process.argv[2]) : CANONICAL_DEVELOPMENT_CORPUS_PATH;

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

const development = new Set<string>(FC008_DEVELOPMENT_PARTITIONS);
const result = exportDevelopmentCorpus({
  records: built.records.filter((record) => development.has(record.partition)),
  vocabulary: built.vocabulary,
  policy: FC008_FEATURE_POLICY,
  datasetHash: actual.dataset,
  vocabularyHash: actual.vocabulary,
  manifestHash: actual.manifest,
});
if (!result.ok) {
  fail(`${result.reason}: ${result.detail}`);
}

const bytes = canonicalJson(result.export);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, bytes, "utf8");

process.stdout.write(
  `${JSON.stringify(
    {
      outputPath,
      bytes: Buffer.byteLength(bytes, "utf8"),
      exportSha256: sha256Hex(bytes),
      rows: result.export.rows.length,
      featureCount: result.export.featureOrder.length,
      classes: result.export.classOrder.length,
      accessReport: result.export.accessReport,
    },
    null,
    2,
  )}\n`,
);
