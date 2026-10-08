/**
 * Sprint 4B-PreOpen: TypeScript façade never derives sealed rows.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FROZEN_FC008_DATASET_HASH,
  FROZEN_FC008_SPRINT2_MANIFEST_HASH,
  FROZEN_FC008_VOCABULARY_HASH,
  FROZEN_SEALED_PARTITION_COUNTS,
  PRODUCTION_SEALED_PARTITIONS,
  SealedOpeningNotEnabledError,
  openProductionSealedPartitions,
} from "../src/sealed-source.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "src", "sealed-source.ts"), "utf8");
const deriveScript = readFileSync(
  join(here, "..", "scripts", "derive-sealed-partitions.ts"),
  "utf8",
);

describe("production sealed opening façade", () => {
  it("pins the frozen identities without opening rows", () => {
    expect(FROZEN_FC008_DATASET_HASH).toBe(
      "44f01040e479d331920434ed4987ff2d0bdaa85c8bb54d55842c35e697d290fa",
    );
    expect(FROZEN_FC008_VOCABULARY_HASH).toBe(
      "005212cce8104af27cbcb331c2635dd16b3db93ccdbd61841e70be3c0b29cb64",
    );
    expect(FROZEN_FC008_SPRINT2_MANIFEST_HASH).toBe(
      "aa74f73075720326e692c8da0e8ccd13c71f82c51e69d5b933b59ff060c64d77",
    );
    expect([...PRODUCTION_SEALED_PARTITIONS]).toEqual(["test-id", "test-ooa", "test-novelty"]);
    expect({ ...FROZEN_SEALED_PARTITION_COUNTS }).toEqual({
      "test-id": 143,
      "test-ooa": 66,
      "test-novelty": 28,
    });
  });

  it("refuses even with a complete capability and never returns rows", () => {
    expect(() =>
      openProductionSealedPartitions({
        mode: "final-evaluation",
        authorizedFamilies: ["joint-logistic", "factorized-logistic"],
        acknowledgeOneShotHoldout: true,
        enableRealSealedOpening: true,
      }),
    ).toThrow(SealedOpeningNotEnabledError);
  });

  it("refuses a partial family set before any derivation", () => {
    expect(() =>
      openProductionSealedPartitions({
        mode: "final-evaluation",
        authorizedFamilies: ["joint-logistic"],
        acknowledgeOneShotHoldout: true,
        enableRealSealedOpening: true,
      }),
    ).toThrow(/both model families/);
  });

  it("does not import or invoke the dataset generator", () => {
    expect(source).not.toMatch(/from\s+["']\.\/dataset/);
    expect(source).not.toMatch(/\bbuildDataset\s*\(/);
    expect(source).not.toContain("node:fs");
    expect(source).not.toContain("node:child_process");
  });
});

describe("the derivation script stays out of ordinary tests", () => {
  it("requires both runtime flags before buildDataset", () => {
    expect(deriveScript).toContain("buildDataset");
    expect(deriveScript).toContain("--acknowledge-one-shot-holdout");
    expect(deriveScript).toContain("--enable-real-sealed-opening");
    expect(deriveScript).toContain(
      "44f01040e479d331920434ed4987ff2d0bdaa85c8bb54d55842c35e697d290fa",
    );
    const flagCheck = deriveScript.indexOf("acknowledge-one-shot-holdout");
    const buildCall = deriveScript.indexOf("buildDataset(");
    expect(flagCheck).toBeGreaterThan(-1);
    expect(buildCall).toBeGreaterThan(flagCheck);
  });

  it("does not write the rejected physical corpus filename", () => {
    expect(deriveScript).toContain("Never writes");
    expect(deriveScript).not.toMatch(/writeFileSync/);
  });
});
