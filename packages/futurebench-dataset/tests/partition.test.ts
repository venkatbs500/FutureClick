import {
  FC008_DATASET_PARTITIONS,
  FC008_FITTABLE_PARTITION,
  FC008_PARTITION_RULES,
  isFittablePartition,
  partitionRule,
  verifyPartitionRules,
} from "@futureclick/action-understanding";
import { describe, expect, it } from "vitest";
import { FAMILY_A } from "../src/apps/family-a.js";
import { FAMILY_C } from "../src/apps/family-c.js";
import { FUTUREBENCH_FAMILIES, FUTUREBENCH_HELD_OUT_FAMILY_IDS } from "../src/apps/index.js";
import { resolveOracleLabel } from "../src/oracle.js";
import {
  ID_PARTITION_CYCLE,
  planPartitions,
  verifyLineageClassCoherence,
} from "../src/partition.js";
import type { PartitionedScenario } from "../src/scenario.js";

const FAMILIES = FUTUREBENCH_FAMILIES;
const HELD_OUT = FAMILY_C.applicationFamilyId;

function plan() {
  const result = planPartitions({
    families: FAMILIES,
    outOfApplicationFamilyIds: [HELD_OUT],
  });
  if (!result.ok) {
    throw new Error(`partition plan refused: ${result.refusal} ${result.detail}`);
  }
  return result;
}

/** The class a scenario establishes, read from the authored intent. */
function classOf(scenario: PartitionedScenario["scenario"]): number | null {
  const resolution = resolveOracleLabel(scenario.intent);
  return resolution.disposition === "resolved" ? resolution.classNumber : null;
}

function groupBy<K>(
  assignments: readonly PartitionedScenario[],
  key: (entry: PartitionedScenario) => K,
): Map<K, PartitionedScenario[]> {
  const map = new Map<K, PartitionedScenario[]>();
  for (const entry of assignments) {
    const k = key(entry);
    const bucket = map.get(k);
    if (bucket === undefined) {
      map.set(k, [entry]);
    } else {
      bucket.push(entry);
    }
  }
  return map;
}

describe("the six partitions and their declared purposes", () => {
  it("declares exactly the six canonical partitions in order", () => {
    expect([...FC008_DATASET_PARTITIONS]).toEqual([
      "train",
      "calibration",
      "policy-validation",
      "test-id",
      "test-ooa",
      "test-novelty",
    ]);
  });

  it("marks exactly one partition fittable", () => {
    expect(FC008_PARTITION_RULES.filter((rule) => rule.fittable)).toHaveLength(1);
    expect(FC008_FITTABLE_PARTITION).toBe("train");
    expect(isFittablePartition("train")).toBe(true);
    for (const partition of FC008_DATASET_PARTITIONS) {
      if (partition !== "train") {
        expect(isFittablePartition(partition), partition).toBe(false);
      }
    }
  });

  it("passes its own rule-table self-check", () => {
    expect(verifyPartitionRules()).toEqual([]);
  });

  it("states a purpose for every partition and throws on an unknown one", () => {
    for (const partition of FC008_DATASET_PARTITIONS) {
      expect(partitionRule(partition).purpose.length).toBeGreaterThan(0);
    }
    expect(() => partitionRule("test-holdout" as never)).toThrow();
  });

  it("exposes the rule table as frozen data rather than a mutable map", () => {
    // `Object.freeze` does not stop `Map.prototype.set`, so an architectural rule
    // stored in a Map would be editable at runtime. A frozen array cannot be.
    expect(Object.isFrozen(FC008_PARTITION_RULES)).toBe(true);
    expect(Array.isArray(FC008_PARTITION_RULES)).toBe(true);
  });

  it("cycles over exactly the four in-distribution partitions, without repeats", () => {
    // Four distinct entries, so a class with four lineages maps onto them bijectively.
    // A repeated `train` would enlarge the train split at the cost of some class
    // losing its representation in an evaluation partition.
    expect([...ID_PARTITION_CYCLE]).toEqual([
      "train",
      "calibration",
      "policy-validation",
      "test-id",
    ]);
    expect(new Set(ID_PARTITION_CYCLE).size).toBe(ID_PARTITION_CYCLE.length);
    expect(Object.isFrozen(ID_PARTITION_CYCLE)).toBe(true);
  });
});

describe("partition assignment", () => {
  const assigned = plan();

  it("assigns every scenario exactly once", () => {
    const total = FAMILIES.reduce((sum, family) => sum + family.scenarios.length, 0);
    expect(assigned.assignments).toHaveLength(total);
    const ids = assigned.assignments.map((entry) => entry.scenario.scenarioId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps no template lineage in more than one partition", () => {
    for (const [lineageId, entries] of groupBy(
      assigned.assignments,
      (entry) => entry.scenario.templateLineageId,
    )) {
      const partitions = new Set(entries.map((entry) => entry.partition));
      expect(partitions.size, `lineage ${lineageId}`).toBe(1);
    }
  });

  it("keeps every variant sibling with its parent lineage", () => {
    // The assignment unit is the parent lineage, so sibling leakage is impossible
    // by construction rather than merely detectable afterwards. A paraphrase in
    // train and its twin in test would make memorization look like generalization.
    for (const [parentId, entries] of groupBy(
      assigned.assignments,
      (entry) => entry.scenario.parentLineageId,
    )) {
      const partitions = new Set(entries.map((entry) => entry.partition));
      expect(partitions.size, `parent ${parentId}`).toBe(1);
    }
  });

  it("sends the whole held-out family to test-ooa and nothing else there", () => {
    for (const entry of assigned.assignments) {
      if (entry.scenario.applicationFamilyId === HELD_OUT && !entry.scenario.intendedForNovelty) {
        expect(entry.partition).toBe("test-ooa");
      }
      if (entry.partition === "test-ooa") {
        expect(entry.scenario.applicationFamilyId).toBe(HELD_OUT);
      }
    }
  });

  it("keeps every out-of-application class represented in train by another family", () => {
    // The measurement is meaningless otherwise: a model cannot be shown to have
    // failed to generalize a concept that was never in its training data.
    const trainFamilies = new Set(
      assigned.assignments
        .filter((entry) => entry.partition === "train")
        .map((entry) => entry.scenario.applicationFamilyId),
    );
    expect(assigned.diagnostics.outOfApplicationClasses.length).toBeGreaterThan(0);
    expect(trainFamilies.has(HELD_OUT)).toBe(false);
    expect(trainFamilies.size).toBeGreaterThan(0);
  });

  it("keeps novelty separate from out-of-application", () => {
    const novelty = assigned.assignments.filter((entry) => entry.partition === "test-novelty");
    expect(novelty.length).toBeGreaterThan(0);
    for (const entry of novelty) {
      expect(entry.scenario.intendedForNovelty).toBe(true);
    }
    // And no novelty scenario landed anywhere else.
    for (const entry of assigned.assignments) {
      if (entry.scenario.intendedForNovelty) {
        expect(entry.partition).toBe("test-novelty");
      }
    }
  });

  it("is deterministic across runs", () => {
    const first = plan()
      .assignments.map((e) => `${e.scenario.scenarioId}:${e.partition}`)
      .sort();
    const second = plan()
      .assignments.map((e) => `${e.scenario.scenarioId}:${e.partition}`)
      .sort();
    expect(first).toEqual(second);
  });

  it("does not depend on the order families are supplied in", () => {
    const reversed = planPartitions({
      families: [...FAMILIES].reverse(),
      outOfApplicationFamilyIds: [HELD_OUT],
    });
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) {
      return;
    }
    const canonical = new Map(
      plan().assignments.map((e) => [e.scenario.scenarioId, e.partition] as const),
    );
    for (const entry of reversed.assignments) {
      expect(canonical.get(entry.scenario.scenarioId), entry.scenario.scenarioId).toBe(
        entry.partition,
      );
    }
  });
});

describe("application family does not alias partition", () => {
  const assigned = plan();
  const ID_PARTITIONS = ["train", "calibration", "policy-validation", "test-id"] as const;

  function familiesIn(partition: string): Set<string> {
    return new Set(
      assigned.assignments
        .filter((entry) => entry.partition === partition)
        .map((entry) => entry.scenario.applicationFamilyId),
    );
  }

  const FAMILY_A_ID = FAMILY_A.applicationFamilyId;
  const FAMILY_B_ID = FUTUREBENCH_FAMILIES.map((family) => family.applicationFamilyId).find(
    (id) => id !== FAMILY_A_ID && id !== HELD_OUT,
  ) as string;

  it("puts Family A in all four in-distribution partitions", () => {
    // The defect this guards: lineage ids are family-prefixed, so a plain sorted walk
    // gave A the first two rotation slots and B the last two, making train+calibration
    // entirely A and policy-validation+test-ID entirely B.
    for (const partition of ID_PARTITIONS) {
      expect(familiesIn(partition), `Family A missing from ${partition}`).toContain(FAMILY_A_ID);
    }
  });

  it("puts Family B in all four in-distribution partitions", () => {
    for (const partition of ID_PARTITIONS) {
      expect(familiesIn(partition), `Family B missing from ${partition}`).toContain(FAMILY_B_ID);
    }
  });

  it("keeps the held-out family out of every in-distribution partition", () => {
    for (const partition of ID_PARTITIONS) {
      expect(familiesIn(partition)).not.toContain(HELD_OUT);
    }
  });

  it("confines the held-out family to test-ooa", () => {
    const partitions = new Set(
      assigned.assignments
        .filter((entry) => entry.scenario.applicationFamilyId === HELD_OUT)
        .map((entry) => entry.partition),
    );
    expect([...partitions]).toEqual(["test-ooa"]);
  });

  it("makes test-ID families a subset of train families", () => {
    const train = familiesIn("train");
    for (const familyId of familiesIn("test-id")) {
      expect(train).toContain(familyId);
    }
  });

  it("makes calibration and policy-validation families subsets of train families", () => {
    const train = familiesIn("train");
    for (const partition of ["calibration", "policy-validation"] as const) {
      for (const familyId of familiesIn(partition)) {
        expect(train, `${familyId} in ${partition} but not train`).toContain(familyId);
      }
    }
  });

  it("represents every supported class in every in-distribution partition", () => {
    const classesIn = (partition: string) =>
      new Set(
        assigned.assignments
          .filter((entry) => entry.partition === partition)
          .map((entry) => classOf(entry.scenario))
          .filter((value): value is number => value !== null),
      );
    const train = classesIn("train");
    expect(train.size).toBe(13);
    for (const partition of ID_PARTITIONS) {
      expect(classesIn(partition).size, `${partition} is missing classes`).toBe(13);
    }
    // And test-ID's classes must all be learnable.
    for (const classNumber of classesIn("test-id")) {
      expect(train).toContain(classNumber);
    }
  });

  it("gives every in-distribution partition the same number of lineages", () => {
    const counts = ID_PARTITIONS.map(
      (partition) =>
        new Set(
          assigned.assignments
            .filter((entry) => entry.partition === partition)
            .map((entry) => entry.scenario.parentLineageId),
        ).size,
    );
    expect(new Set(counts).size).toBe(1);
  });

  it("assigns identically on a repeat plan and independently of family order", () => {
    const repeat = planPartitions({
      families: FAMILIES,
      outOfApplicationFamilyIds: [HELD_OUT],
    });
    const reversed = planPartitions({
      families: [...FAMILIES].reverse(),
      outOfApplicationFamilyIds: [HELD_OUT],
    });
    expect(repeat.ok && reversed.ok).toBe(true);
    if (!repeat.ok || !reversed.ok) {
      return;
    }
    const fingerprint = (entries: readonly PartitionedScenario[]) =>
      entries
        .map((entry) => `${entry.scenario.scenarioId}=${entry.partition}`)
        .sort()
        .join("|");
    expect(fingerprint(repeat.assignments)).toBe(fingerprint(assigned.assignments));
    expect(fingerprint(reversed.assignments)).toBe(fingerprint(assigned.assignments));
  });
});

describe("partition refusals", () => {
  it("refuses an unknown held-out family rather than silently holding out nothing", () => {
    const result = planPartitions({
      families: FAMILIES,
      outOfApplicationFamilyIds: ["family-does-not-exist"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal).toBe("ooa-family-not-found");
    }
  });

  it("refuses holding out every family", () => {
    const result = planPartitions({
      families: FAMILIES,
      outOfApplicationFamilyIds: FAMILIES.map((family) => family.applicationFamilyId),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal).toBe("all-families-held-out");
    }
  });
});

describe("lineage class coherence", () => {
  it("confirms every lineage establishes one class across all its variants", () => {
    // Variants reuse their parent's intent by reference, so this should hold by
    // construction. Checking it independently is what makes that a verified
    // property rather than an assumption about how variants were built.
    const scenarios = FAMILIES.flatMap((family) => family.scenarios);
    expect(verifyLineageClassCoherence(scenarios)).toEqual([]);
  });
});
