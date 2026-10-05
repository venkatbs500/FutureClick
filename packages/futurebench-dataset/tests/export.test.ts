/**
 * The development-only export bridge.
 *
 * The thing worth testing here is not that the happy path produces rows. It is that
 * the exporter REFUSES when asked for something it must not provide, and that the
 * refusal is visible rather than a quiet narrowing of the request. So most of these
 * tests hand it input it should reject, and the one that checks a real corpus is
 * really checking that nothing from a sealed partition got through.
 */

import { FC008_FEATURE_POLICY, FC008_SUPPORT_MATRIX } from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import { FUTUREBENCH_FAMILIES, FUTUREBENCH_HELD_OUT_FAMILY_IDS } from "../src/apps/index.js";
import {
  FUTUREBENCH_DATASET_VERSION,
  FUTUREBENCH_GENERATOR_VERSION,
  buildDataset,
} from "../src/dataset.js";
import {
  FC008_DEVELOPMENT_EXPORT_SCHEMA_VERSION,
  FC008_DEVELOPMENT_PARTITIONS,
  FC008_SEALED_PARTITIONS,
  buildClassOrder,
  exportDevelopmentCorpus,
} from "../src/export.js";
import { buildManifest, manifestHash } from "../src/manifest.js";
import type { FutureBenchRecord } from "../src/record.js";

function build() {
  const result = buildDataset({
    families: FUTUREBENCH_FAMILIES,
    outOfApplicationFamilyIds: [...FUTUREBENCH_HELD_OUT_FAMILY_IDS],
  });
  if (!result.ok) {
    throw new Error(`dataset refused: ${result.reason} ${result.detail}`);
  }
  return result;
}

const DATASET = build();
const MANIFEST = buildManifest({
  families: FUTUREBENCH_FAMILIES,
  records: DATASET.records,
  vocabulary: DATASET.vocabulary,
  datasetVersion: FUTUREBENCH_DATASET_VERSION,
  generatorVersion: FUTUREBENCH_GENERATOR_VERSION,
});
const MANIFEST_HASH = manifestHash(MANIFEST);

function exportInput(records: readonly FutureBenchRecord[]) {
  return {
    records,
    vocabulary: DATASET.vocabulary,
    policy: FC008_FEATURE_POLICY,
    datasetHash: MANIFEST.datasetHash,
    vocabularyHash: MANIFEST.vocabularyHash,
    manifestHash: MANIFEST_HASH,
  };
}

function developmentRecords(): readonly FutureBenchRecord[] {
  const development = new Set<string>(FC008_DEVELOPMENT_PARTITIONS);
  return DATASET.records.filter((record) => development.has(record.partition));
}

/** One development record, for the tests that corrupt a single field. */
function anyDevelopmentRecord(): FutureBenchRecord {
  const [first] = developmentRecords();
  if (first === undefined) {
    throw new Error("the development partitions are empty");
  }
  return first;
}

describe("sealed-partition refusal", () => {
  it.each([...FC008_SEALED_PARTITIONS])("refuses an export containing %s", (partition) => {
    const sealed = DATASET.records.find((record) => record.partition === partition);
    if (sealed === undefined) {
      throw new Error(`no record found in ${partition}`);
    }
    const result = exportDevelopmentCorpus(exportInput([...developmentRecords(), sealed]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("sealed-partition-offered-to-development-export");
      expect(result.detail).toContain(partition);
    }
  });

  it("refuses the whole corpus rather than exporting the part it may read", () => {
    // A filter here would be the dangerous behaviour: the caller asked for the full
    // corpus, got a valid-looking export, and would never learn it had been narrowed.
    const result = exportDevelopmentCorpus(exportInput(DATASET.records));
    expect(result.ok).toBe(false);
  });

  it("reports which sealed partitions were offered and how many rows", () => {
    const result = exportDevelopmentCorpus(exportInput(DATASET.records));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const partition of FC008_SEALED_PARTITIONS) {
        expect(result.detail).toContain(partition);
      }
      expect(result.detail).toMatch(/test-ooa=66/);
      expect(result.detail).toMatch(/test-novelty=28/);
    }
  });

  it("refuses a single sealed row with no development rows at all", () => {
    const sealed = DATASET.records.filter((record) => record.partition === "test-id").slice(0, 1);
    const result = exportDevelopmentCorpus(exportInput(sealed));
    expect(result.ok).toBe(false);
  });

  it("refuses a partition name it does not recognise", () => {
    // A seal expressed as "everything except the development set" would admit any
    // partition added later. This one rejects what it does not know.
    const relabelled = {
      ...anyDevelopmentRecord(),
      partition: "test-future",
    } as unknown as FutureBenchRecord;
    const result = exportDevelopmentCorpus(exportInput([relabelled]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unknown-partition-offered-to-development-export");
    }
  });

  it("refuses a record whose oracle declined to assign a class", () => {
    const record = anyDevelopmentRecord();
    const unlabelled = {
      ...record,
      oracle: { ...record.oracle, classNumber: null },
    } as unknown as FutureBenchRecord;
    const result = exportDevelopmentCorpus(exportInput([unlabelled]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unlabelled-record-offered-to-development-export");
    }
  });

  it("refuses a class number outside the frozen support matrix", () => {
    const record = anyDevelopmentRecord();
    const impossible = {
      ...record,
      oracle: { ...record.oracle, classNumber: 14 },
    } as unknown as FutureBenchRecord;
    const result = exportDevelopmentCorpus(exportInput([impossible]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("class-absent-from-support-matrix");
    }
  });
});

describe("development export", () => {
  const result = exportDevelopmentCorpus(exportInput(developmentRecords()));

  it("succeeds on the development partitions", () => {
    expect(result.ok).toBe(true);
  });

  it("carries exactly the 429 development rows", () => {
    if (!result.ok) throw new Error("export refused");
    expect(result.export.rows).toHaveLength(429);
    expect(result.export.schemaVersion).toBe(FC008_DEVELOPMENT_EXPORT_SCHEMA_VERSION);
  });

  it("contains no row from any sealed partition", () => {
    if (!result.ok) throw new Error("export refused");
    const partitions = new Set(result.export.rows.map((row) => row.partition));
    expect([...partitions].sort()).toEqual([...FC008_DEVELOPMENT_PARTITIONS].sort());
    for (const sealed of FC008_SEALED_PARTITIONS) {
      expect(partitions.has(sealed)).toBe(false);
    }
  });

  it("splits 143 rows into each development partition", () => {
    if (!result.ok) throw new Error("export refused");
    for (const entry of result.export.accessReport.developmentRowsByPartition) {
      expect(entry.rows).toBe(143);
    }
  });

  it("reports zero sealed rows from the counter that drives the refusal", () => {
    if (!result.ok) throw new Error("export refused");
    const report = result.export.accessReport;
    expect(report.sealedTotalRows).toBe(0);
    for (const entry of report.sealedRowsByPartition) {
      expect(entry.rows).toBe(0);
    }
    // The zero above is only meaningful because the same counter refuses when it is
    // non-zero, which the sealed-partition tests above exercise directly.
    expect(report.sealedRowsByPartition.map((entry) => entry.partition)).toEqual([
      ...FC008_SEALED_PARTITIONS,
    ]);
  });

  it("orders rows by record id so the bytes do not depend on iteration order", () => {
    if (!result.ok) throw new Error("export refused");
    const ids = result.export.rows.map((row) => row.recordId);
    expect(ids).toEqual([...ids].sort());
  });

  it("exports the frozen 370-feature vocabulary in index order", () => {
    if (!result.ok) throw new Error("export refused");
    expect(result.export.featureOrder).toHaveLength(370);
    expect(new Set(result.export.featureOrder).size).toBe(370);
    for (const row of result.export.rows) {
      for (const index of row.featureIndices) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(370);
      }
      expect(row.featureIndices).toHaveLength(row.featureValues.length);
      expect([...row.featureIndices]).toEqual([...row.featureIndices].sort((a, b) => a - b));
    }
  });

  it("carries both the joint class and its three head targets per row", () => {
    if (!result.ok) throw new Error("export refused");
    const byClass = new Map(result.export.classOrder.map((entry) => [entry.classNumber, entry]));
    for (const row of result.export.rows) {
      const entry = byClass.get(row.classNumber);
      if (entry === undefined) {
        throw new Error(`${row.recordId} claims class ${row.classNumber}, which is absent`);
      }
      // Derived from the one support matrix, so a head cannot learn a target that
      // does not correspond to the class it composes into.
      expect(row.verbIndex).toBe(entry.verbIndex);
      expect(row.objectIndex).toBe(entry.objectIndex);
      expect(row.transitionPropertyIndex).toBe(entry.transitionPropertyIndex);
    }
  });

  it("exports no raw surface text and no application-family identity", () => {
    if (!result.ok) throw new Error("export refused");
    const serialized = JSON.stringify(result.export);
    for (const forbidden of [
      "surfaceText",
      "rawText",
      "semantics",
      "applicationFamilyId",
      "ariaLabel",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("is reproducible: the same records export to the same bytes", () => {
    const again = exportDevelopmentCorpus(exportInput(developmentRecords()));
    if (!result.ok || !again.ok) throw new Error("export refused");
    expect(JSON.stringify(again.export)).toBe(JSON.stringify(result.export));
  });

  it("does not depend on the order records were offered in", () => {
    if (!result.ok) throw new Error("export refused");
    const reversed = exportDevelopmentCorpus(exportInput([...developmentRecords()].reverse()));
    if (!reversed.ok) throw new Error("export refused");
    expect(JSON.stringify(reversed.export)).toBe(JSON.stringify(result.export));
  });
});

describe("frozen class order", () => {
  const order = buildClassOrder();

  it("is the canonical 1..13 support-matrix order", () => {
    expect(order.map((entry) => entry.classNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it("resolves every head index inside its own vocabulary", () => {
    if (order.length !== FC008_SUPPORT_MATRIX.length) {
      throw new Error("class order and support matrix disagree on size");
    }
    for (const entry of order) {
      expect(entry.verbIndex).toBeGreaterThanOrEqual(0);
      expect(entry.verbIndex).toBeLessThan(10);
      expect(entry.objectIndex).toBeGreaterThanOrEqual(0);
      expect(entry.objectIndex).toBeLessThan(9);
      expect(entry.transitionPropertyIndex).toBeGreaterThanOrEqual(0);
      expect(entry.transitionPropertyIndex).toBeLessThan(10);
    }
  });

  it("has a unique verb/object pair for every class", () => {
    // This is the RQ1 disclosure as an executable statement: because the pairs are
    // unique, transition property adds no discrimination once verb and object are
    // known. If the support matrix ever changes, this test is what notices.
    const pairs = order.map((entry) => `${entry.verbIndex}:${entry.objectIndex}`);
    expect(new Set(pairs).size).toBe(13);
  });

  it("agrees with the support matrix it is derived from", () => {
    for (const [index, entry] of order.entries()) {
      const row = FC008_SUPPORT_MATRIX[index];
      if (row === undefined) {
        throw new Error(`support matrix has no row ${index}`);
      }
      expect(entry.verb).toBe(row.tuple.verb);
      expect(entry.objectKind).toBe(row.tuple.objectKind);
      expect(entry.transitionProperty).toBe(row.tuple.transition.property);
    }
  });
});
