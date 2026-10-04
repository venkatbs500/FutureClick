import { describe, expect, it } from "vitest";
import {
  FC008_DATASET_PARTITIONS,
  FC008_FITTABLE_PARTITION,
  FC008_PARTITION_RULES,
  isFittablePartition,
  partitionRule,
  verifyPartitionRules,
} from "../src/partitions.js";

describe("the partition rule table", () => {
  it("passes its own self-check", () => {
    expect(verifyPartitionRules()).toEqual([]);
  });

  it("declares a rule for every partition, in the canonical order", () => {
    expect(FC008_PARTITION_RULES.map((rule) => rule.partition)).toEqual([
      ...FC008_DATASET_PARTITIONS,
    ]);
  });

  it("is frozen data rather than a mutable map", () => {
    // `Object.freeze` does not prevent `Map.prototype.set` or `delete`, so an
    // architectural rule held in a Map would be editable at runtime by anything
    // that could reach it. A frozen array of frozen records cannot be.
    expect(Object.isFrozen(FC008_PARTITION_RULES)).toBe(true);
    for (const rule of FC008_PARTITION_RULES) {
      expect(Object.isFrozen(rule)).toBe(true);
    }
  });

  it("marks exactly one partition as fittable", () => {
    const fittable = FC008_PARTITION_RULES.filter((rule) => rule.fittable);
    expect(fittable).toHaveLength(1);
    expect(fittable[0]?.partition).toBe(FC008_FITTABLE_PARTITION);
    expect(FC008_FITTABLE_PARTITION).toBe("train");
  });

  it("agrees with the fittability predicate for every partition", () => {
    for (const rule of FC008_PARTITION_RULES) {
      expect(isFittablePartition(rule.partition), rule.partition).toBe(rule.fittable);
    }
  });

  it("states a non-empty purpose for every partition", () => {
    for (const rule of FC008_PARTITION_RULES) {
      expect(rule.purpose.length, rule.partition).toBeGreaterThan(0);
    }
  });

  it("keeps the three test partitions non-fittable", () => {
    // The whole point of the split. A fitted artifact that saw any of these cannot
    // be used to report generalization, and the damage is undetectable afterwards.
    for (const partition of ["test-id", "test-ooa", "test-novelty"] as const) {
      expect(isFittablePartition(partition), partition).toBe(false);
    }
  });

  it("keeps calibration and policy-validation non-fittable for the vocabulary", () => {
    // These two inform a temperature and hyperparameters respectively, in Sprint 3.
    // Neither may contribute to the vocabulary, which is a fitted artifact.
    expect(isFittablePartition("calibration")).toBe(false);
    expect(isFittablePartition("policy-validation")).toBe(false);
  });
});

describe("rule lookup", () => {
  it("returns the rule for a known partition", () => {
    expect(partitionRule("train").fittable).toBe(true);
    expect(partitionRule("test-ooa").fittable).toBe(false);
  });

  it("throws on an unknown partition rather than returning a default", () => {
    // A silent default here would let a typo acquire whatever permissions the
    // default happened to carry.
    expect(() => partitionRule("holdout" as never)).toThrow();
    expect(() => partitionRule("" as never)).toThrow();
  });
});
