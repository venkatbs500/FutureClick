import type { Fc008DatasetPartition } from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import { FAMILY_A } from "../src/apps/family-a.js";
import { FAMILY_C } from "../src/apps/family-c.js";
import { FUTUREBENCH_FAMILIES, FUTUREBENCH_HELD_OUT_FAMILY_IDS } from "../src/apps/index.js";
import {
  FUTUREBENCH_DATASET_VERSION,
  FUTUREBENCH_GENERATOR_VERSION,
  buildDataset,
} from "../src/dataset.js";
import {
  buildManifest,
  canonicalManifestText,
  hashVocabulary,
  manifestHash,
} from "../src/manifest.js";

const FAMILIES = FUTUREBENCH_FAMILIES;

function build() {
  const built = buildDataset({
    families: FAMILIES,
    outOfApplicationFamilyIds: FUTUREBENCH_HELD_OUT_FAMILY_IDS,
  });
  if (!built.ok) {
    throw new Error(`dataset refused: ${built.reason} ${built.detail}`);
  }
  return built;
}

const BUILT = build();

function manifest(records = BUILT.records, vocabulary = BUILT.vocabulary) {
  return buildManifest({
    families: FAMILIES,
    records,
    vocabulary,
    datasetVersion: FUTUREBENCH_DATASET_VERSION,
    generatorVersion: FUTUREBENCH_GENERATOR_VERSION,
  });
}

describe("manifest determinism", () => {
  it("reproduces identically from identical inputs", () => {
    expect(manifestHash(manifest())).toBe(manifestHash(manifest()));
  });

  it("does not depend on record order", () => {
    // Every collection is sorted before hashing. A manifest whose hash depended on
    // iteration order would be a trap waiting for the first refactor.
    const reversed = manifest([...BUILT.records].reverse());
    expect(manifestHash(reversed)).toBe(manifestHash(manifest()));
  });

  it("does not depend on the order families are declared in", () => {
    const swapped = buildManifest({
      families: [...FAMILIES].reverse(),
      records: BUILT.records,
      vocabulary: BUILT.vocabulary,
      datasetVersion: FUTUREBENCH_DATASET_VERSION,
      generatorVersion: FUTUREBENCH_GENERATOR_VERSION,
    });
    expect(manifestHash(swapped)).toBe(manifestHash(manifest()));
  });

  it("reproduces across a full dataset rebuild", () => {
    // The strongest form: the generator runs again from the scenario definitions and
    // lands on the same bytes. This is what makes "which data produced this result"
    // an answerable question.
    const rebuilt = build();
    expect(manifestHash(manifest(rebuilt.records, rebuilt.vocabulary))).toBe(
      manifestHash(manifest()),
    );
  });

  it("contains no timestamp in its canonical content", () => {
    // Rather than hashing a build time and excluding it by convention, no build time
    // is recorded at all. Convention-based exclusions do not survive refactors.
    const text = canonicalManifestText(manifest());
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(text).not.toContain("generatedAt");
    expect(text).not.toContain("createdAt");
    expect(text).not.toContain("buildTime");
  });
});

describe("manifest sensitivity", () => {
  it("changes when a single record changes", () => {
    const mutated = [...BUILT.records];
    const first = mutated[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    // Replacing the last character with a FIXED value would be a no-op whenever it
    // already held that value, which makes the test pass or fail on the luck of the
    // hash. Flipping it to a guaranteed-different character instead.
    const lastCharacter = first.recordHash.slice(-1);
    mutated[0] = {
      ...first,
      recordHash: `${first.recordHash.slice(0, 63)}${lastCharacter === "0" ? "1" : "0"}`,
    };
    expect(manifestHash(manifest(mutated))).not.toBe(manifestHash(manifest()));
  });

  it("changes when a lineage moves partition", () => {
    // A whole lineage, not a single record. Moving one record of a lineage is not a
    // repartitioning, it is the leakage `buildManifest` now refuses outright, so it
    // cannot be used to probe hash sensitivity.
    const first = BUILT.records[0];
    if (first === undefined) {
      return;
    }
    const target = first.lineage.parentLineageId;
    const destination: Fc008DatasetPartition = first.partition === "train" ? "test-id" : "train";
    const mutated = BUILT.records.map((record) =>
      record.lineage.parentLineageId === target ? { ...record, partition: destination } : record,
    );
    expect(manifestHash(manifest(mutated))).not.toBe(manifestHash(manifest()));
  });

  it("changes when a record is removed", () => {
    expect(manifestHash(manifest(BUILT.records.slice(1)))).not.toBe(manifestHash(manifest()));
  });

  it("changes when the vocabulary changes", () => {
    const polluted = new Map(BUILT.vocabulary.entries);
    polluted.set("tok:ctl:added", polluted.size);
    expect(
      manifestHash(
        manifest(BUILT.records, {
          ...BUILT.vocabulary,
          entries: polluted,
          size: polluted.size,
        }),
      ),
    ).not.toBe(manifestHash(manifest()));
  });

  it("distinguishes two vocabularies with the same names but different indices", () => {
    // The indices ARE the artifact. Two feature spaces that agree on names but not
    // on positions are different models' inputs and must not share a hash.
    const names = [...BUILT.vocabulary.entries.keys()];
    const shifted = new Map<string, number>();
    for (const [index, name] of names.entries()) {
      shifted.set(name, (index + 1) % names.length);
    }
    expect(hashVocabulary({ ...BUILT.vocabulary, entries: shifted })).not.toBe(
      hashVocabulary(BUILT.vocabulary),
    );
  });
});

describe("manifest content", () => {
  const built = manifest();

  it("pins every version the dataset depends on", () => {
    expect(built.datasetVersion).toBe(FUTUREBENCH_DATASET_VERSION);
    expect(built.generatorVersion).toBe(FUTUREBENCH_GENERATOR_VERSION);
    expect(built.supportMatrixVersion.length).toBeGreaterThan(0);
    expect(built.featurePolicyVersion.length).toBeGreaterThan(0);
    expect(built.vocabularyVersion.length).toBeGreaterThan(0);
    expect(built.vocabularyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(built.datasetHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records every application family with its independence basis", () => {
    expect(built.applicationFamilies).toHaveLength(FAMILIES.length);
    for (const family of built.applicationFamilies) {
      expect(family.independenceBasis.length).toBeGreaterThan(0);
      expect(family.scenarioCount).toBeGreaterThan(0);
      expect(family.parentLineageIds.length).toBeGreaterThan(0);
    }
  });

  it("counts authored parent lineages, not variants, per family", () => {
    // The distinction that matters: `templateLineageId` is unique per variant, so using
    // it here reported 310 lineages for a family with 26 authored ones. A reviewer would
    // have read that as an order of magnitude more independent material than exists.
    for (const family of built.applicationFamilies) {
      const source = FAMILIES.find(
        (candidate) => candidate.applicationFamilyId === family.applicationFamilyId,
      );
      expect(source).toBeDefined();
      if (source === undefined) {
        continue;
      }
      const authored = new Set(source.scenarios.map((scenario) => scenario.parentLineageId));
      expect(family.parentLineageIds).toHaveLength(authored.size);
      expect([...family.parentLineageIds].sort()).toEqual([...authored].sort());
      // Variants are recorded, but separately and never as independent lineages.
      expect(family.templateInstanceIds.length).toBeGreaterThan(family.parentLineageIds.length);
      expect(family.scenarioCount).toBeGreaterThan(family.parentLineageIds.length);
    }
  });

  it("matches the authored source for each family", () => {
    const counts = new Map(
      built.applicationFamilies.map((family) => [
        family.applicationFamilyId,
        family.parentLineageIds.length,
      ]),
    );
    // Derived from the authored source rather than hard-coded, so adding a lineage
    // cannot leave this test asserting a stale number.
    for (const family of FAMILIES) {
      const authored = new Set(family.scenarios.map((scenario) => scenario.parentLineageId)).size;
      expect(counts.get(family.applicationFamilyId)).toBe(authored);
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    expect(total).toBe(built.lineages.length);
  });

  it("accounts for all six partitions and every record", () => {
    expect(built.partitions).toHaveLength(6);
    const total = built.partitions.reduce((sum, entry) => sum + entry.recordCount, 0);
    expect(total).toBe(BUILT.records.length);
    expect(built.records).toHaveLength(BUILT.records.length);
  });

  it("gives every populated partition its own hash chain", () => {
    // Empty partitions legitimately share the hash of the empty chain: there is only
    // one way to hash nothing. Only populated partitions must be distinguishable.
    const populated = built.partitions.filter((entry) => entry.recordCount > 0);
    const hashes = populated.map((entry) => entry.partitionHash);
    expect(hashes.length).toBeGreaterThan(1);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("lists authored lineages, not one entry per record", () => {
    // Keying on the per-variant id would make this section a second copy of the
    // records section. There must be strictly fewer lineages than records, and every
    // record's parent must appear exactly once.
    const parents = new Set(BUILT.records.map((record) => record.lineage.parentLineageId));
    expect(built.lineages.length).toBe(parents.size);
    expect(built.lineages.length).toBeLessThan(BUILT.records.length);
    const ids = built.lineages.map((lineage) => lineage.parentLineageId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const parent of parents) {
      expect(ids).toContain(parent);
    }
  });

  it("accounts for every record exactly once across lineages", () => {
    const total = built.lineages.reduce((sum, lineage) => sum + lineage.scenarioCount, 0);
    expect(total).toBe(BUILT.records.length);
  });

  it("refuses to describe a lineage that spans partitions", () => {
    // A manifest naming one of two partitions would assert soundness while
    // describing a dataset that lacks it.
    const first = BUILT.records[0];
    const other = BUILT.records.find(
      (record) =>
        record.lineage.parentLineageId === first?.lineage.parentLineageId &&
        record.recordId !== first.recordId,
    );
    expect(first).toBeDefined();
    expect(other).toBeDefined();
    if (first === undefined || other === undefined) {
      return;
    }
    const moved = BUILT.records.map((record) =>
      record.recordId === other.recordId
        ? { ...record, partition: "test-id" as const }
        : { ...record },
    );
    const conflicting = moved.some(
      (record) =>
        record.lineage.parentLineageId === first.lineage.parentLineageId &&
        record.partition !== first.partition,
    );
    expect(conflicting).toBe(true);
    expect(() => manifest(moved)).toThrow(/spans partitions/);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(built)).toBe(true);
  });
});
