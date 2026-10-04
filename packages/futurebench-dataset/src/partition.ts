/**
 * Six-way dataset partitioning.
 *
 * THE UNIT OF ASSIGNMENT IS THE LINEAGE, NOT THE SCENARIO
 *
 * Every scenario descending from one template lineage — the canonical scenario and
 * all of its wording, layout, distractor, and reordering variants — is assigned
 * together. Splitting a paraphrase from its parent would put near-identical
 * material on both sides of the boundary, and the resulting generalization number
 * would measure memorization. Assigning by `parentLineageId` makes sibling leakage
 * structurally impossible rather than something an audit has to catch afterwards.
 *
 * PARTITIONING PRECEDES VOCABULARY FITTING
 *
 * The split is computed first and the vocabulary is fitted from the train partition
 * afterwards. The reverse order would let test material influence the feature space
 * before anyone looked at a label.
 *
 * WHY ASSIGNMENT IS COVERAGE-AWARE RATHER THAN HASH-BASED
 *
 * Hashing a lineage id into a bucket is the usual trick and it is wrong at this
 * scale: with a handful of lineages per class, a hash can easily leave a class
 * absent from train, and a class the model never saw is not a held-out measurement,
 * it is a missing one. Assignment is therefore a deterministic balanced walk over
 * authored metadata — class number, application family, lineage id — and nothing
 * else. No model result, test metric, or learned vocabulary participates.
 *
 * WHY THE WALK INTERLEAVES FAMILIES AND OFFSETS PER CLASS
 *
 * An earlier version walked each class's lineages in plain sorted order. Lineage
 * ids are family-prefixed, so sorting grouped every Family-A lineage ahead of every
 * Family-B one, and a four-slot rotation then handed A the first two partitions and
 * B the last two for every class. The result was that `applicationFamilyId`
 * perfectly predicted the partition: train and calibration were entirely Family A,
 * policy-validation and test-ID entirely Family B.
 *
 * That is a serious defect rather than an aesthetic one. test-ID is supposed to
 * measure in-distribution performance, but a test-ID partition made of one whole
 * application family absent from train is a second out-of-application test wearing
 * the wrong name, and it would have been reported as an in-distribution number. It
 * also starved the vocabulary: `fm:other` existed on eleven records that all
 * happened to be Family-B policy-validation, so the train-fitted vocabulary never
 * saw the value at all.
 *
 * Two changes fix it. Each class's lineages are INTERLEAVED across families, so
 * consecutive rotation slots alternate between A and B instead of running out one
 * family before starting the next. And each class's cycle starts at a chosen OFFSET,
 * so the family-to-partition pairing varies from class to class rather than being
 * fixed corpus-wide. With four lineages per class (two per family) every class lands
 * exactly one lineage in each of the four in-distribution partitions, and both
 * families appear in all four.
 *
 * WHY THE OFFSET IS CHOSEN RATHER THAN COMPUTED
 *
 * Rotating a class's four lineages by any of the four offsets satisfies every
 * structural requirement equally: each produces one lineage per in-distribution
 * partition. The offset is therefore a free parameter, and a formula like
 * `classIndex % 4` picks one arbitrarily.
 *
 * Arbitrary turned out to be a bad choice. Lineage position within a class is not
 * random — the authored families place menu-driven and select-driven surfaces at
 * consistent positions — so a LINEAR offset made position correlate with partition,
 * and whole categorical values vanished from train. `sk:menu` sat on six lineages and
 * `ik:select` on four, with not one of them in train, which no reasonable reading of
 * chance explains. The feature space the model would be fitted on simply lacked those
 * values, and nothing in the record counts showed it.
 *
 * So the offset is selected by a short deterministic greedy pass instead: for each
 * class in ascending order, take the offset whose train lineage contributes the most
 * authored categorical values not yet covered by train, breaking ties toward the
 * offset that newly covers the most (family, partition) pairs, and then toward the
 * lowest offset. Stating the objective in code is better than encoding it in a
 * modular-arithmetic constant chosen because it happened to score well — the constant
 * would silently stop working the first time a lineage was added, and nothing would
 * say why it was that constant.
 *
 * This is NOT tuning in the prohibited sense. The inputs are authored metadata only:
 * class number, application family, lineage id, and the categorical fields the
 * scenario author wrote on the surface. No model, no prediction, no test metric, and
 * no learned vocabulary participates, and the pass runs before any vocabulary exists.
 */

import {
  FC008_DATASET_PARTITIONS,
  type Fc008DatasetPartition,
} from "@futureclick/action-understanding";
import type { ApplicationFamily, PartitionedScenario, ScenarioSpecification } from "./scenario.js";
import { resolveOracleLabel } from "./oracle.js";

/**
 * The four in-distribution partitions, in the order the balanced walk visits them.
 *
 * Exactly four, with no repeats: a cycle of length four over four lineages per class
 * is a bijection, which is what makes "every class appears in every in-distribution
 * partition" true by construction rather than by luck. Repeating `train` to give it
 * a larger share — the earlier design — breaks the bijection and costs a class its
 * representation in one of the evaluation partitions, which is a worse trade than a
 * smaller train split.
 *
 * Surplus lineages beyond the fourth wrap around and continue round-robin, so an
 * unevenly authored class degrades into balance rather than into a pile-up.
 */
export const ID_PARTITION_CYCLE: readonly Fc008DatasetPartition[] = Object.freeze([
  "train",
  "calibration",
  "policy-validation",
  "test-id",
] as const);

export interface PartitionPlanInput {
  readonly families: readonly ApplicationFamily[];
  /**
   * Application families held out WHOLE for out-of-application testing.
   *
   * Held out at family granularity because that is the generalization claim being
   * measured: performance on an application whose UI conventions were never seen.
   */
  readonly outOfApplicationFamilyIds: readonly string[];
}

export const PARTITION_REFUSALS = Object.freeze([
  "ooa-family-not-found",
  "all-families-held-out",
  "ooa-class-absent-from-train",
  "empty-partition",
] as const);
export type PartitionRefusal = (typeof PARTITION_REFUSALS)[number];

export interface PartitionPlanDiagnostics {
  readonly scenarioCount: number;
  readonly lineageCount: number;
  readonly perPartitionCounts: readonly { partition: Fc008DatasetPartition; count: number }[];
  /** Classes present in test-ooa, each confirmed present in train elsewhere. */
  readonly outOfApplicationClasses: readonly number[];
  readonly noveltyScenarioCount: number;
}

export type PartitionPlanResult =
  | {
      readonly ok: true;
      readonly assignments: readonly PartitionedScenario[];
      readonly diagnostics: PartitionPlanDiagnostics;
    }
  | { readonly ok: false; readonly refusal: PartitionRefusal; readonly detail: string };

/**
 * Orders one class's lineages so consecutive entries alternate between families.
 *
 * Round-robin over families rather than a plain sort. A plain sort groups by family,
 * because lineage ids are family-prefixed, and feeding that order into a four-slot
 * cycle is what made application family alias the partition. Interleaving means slot
 * 0 and slot 1 belong to different families, so no contiguous run of slots can be
 * filled by one family alone.
 *
 * Deterministic: families are visited in sorted id order and each family's lineages
 * in sorted order, so the result depends only on authored metadata.
 */
function interleaveByFamily(
  lineageIds: readonly string[],
  lineageFamily: ReadonlyMap<string, string>,
): readonly string[] {
  const byFamily = new Map<string, string[]>();
  for (const lineageId of [...lineageIds].sort()) {
    const familyId = lineageFamily.get(lineageId) ?? "";
    const bucket = byFamily.get(familyId);
    if (bucket === undefined) {
      byFamily.set(familyId, [lineageId]);
    } else {
      bucket.push(lineageId);
    }
  }
  const families = [...byFamily.keys()].sort();
  const interleaved: string[] = [];
  const deepest = Math.max(0, ...families.map((familyId) => (byFamily.get(familyId) ?? []).length));
  for (let depth = 0; depth < deepest; depth += 1) {
    for (const familyId of families) {
      const candidate = (byFamily.get(familyId) ?? [])[depth];
      if (candidate !== undefined) {
        interleaved.push(candidate);
      }
    }
  }
  return interleaved;
}

/**
 * The authored categorical values a lineage's scenarios carry.
 *
 * Read from the SURFACE the scenario author wrote, not from extracted semantics,
 * because partitioning happens before extraction. These are the closed-vocabulary
 * fields that become `fm:`, `ck:`, `cr:`, `ik:`, and `sk:` features, so a value absent
 * from train is a value the fitted vocabulary cannot contain.
 *
 * Only the target control is read. A non-target candidate's kind does not become a
 * feature of this observation, so counting it would claim coverage that the projector
 * never produces.
 */
function authoredCategoricalValues(scenarios: readonly ScenarioSpecification[]): readonly string[] {
  const values = new Set<string>();
  for (const scenario of scenarios) {
    const surface = scenario.surface;
    const target = surface.candidates[surface.targetIndex];
    if (target === undefined) {
      continue;
    }
    values.add(`fm:${target.formMethod}`);
    values.add(`ck:${target.controlKind}`);
    values.add(`cr:${target.controlRole}`);
    values.add(`ik:${target.interactionKind}`);
    values.add(`sk:${surface.surfaceKind}`);
  }
  return [...values].sort();
}

/** The class a lineage establishes, or null when the oracle declines. */
function lineageClassNumber(scenario: ScenarioSpecification): number | null {
  const resolution = resolveOracleLabel(scenario.intent);
  return resolution.disposition === "resolved" ? resolution.classNumber : null;
}

/**
 * Assigns every scenario to exactly one of the six partitions.
 *
 * Order of precedence: novelty first (those scenarios depict unsupported surfaces
 * and belong nowhere else), then whole held-out application families, then the
 * lineage rotation across the remaining four partitions.
 */
export function planPartitions(input: PartitionPlanInput): PartitionPlanResult {
  const familyIds = new Set(input.families.map((family) => family.applicationFamilyId));
  for (const held of input.outOfApplicationFamilyIds) {
    if (!familyIds.has(held)) {
      return { ok: false, refusal: "ooa-family-not-found", detail: held };
    }
  }
  const heldOut = new Set(input.outOfApplicationFamilyIds);
  if (heldOut.size >= familyIds.size) {
    return {
      ok: false,
      refusal: "all-families-held-out",
      detail: `${heldOut.size} of ${familyIds.size} families held out`,
    };
  }

  const assignments: PartitionedScenario[] = [];
  let noveltyCount = 0;

  // ---- NOVELTY ------------------------------------------------------------
  // Separate from out-of-application: novelty is about surfaces outside the
  // supported matrix, where abstention is the correct answer. Conflating the two
  // would make an abstention look like a generalization failure.
  const remaining: ScenarioSpecification[] = [];
  for (const family of input.families) {
    for (const scenario of family.scenarios) {
      if (scenario.intendedForNovelty) {
        assignments.push({ scenario, partition: "test-novelty" });
        noveltyCount += 1;
        continue;
      }
      remaining.push(scenario);
    }
  }

  // ---- OUT-OF-APPLICATION -------------------------------------------------
  const inDistribution: ScenarioSpecification[] = [];
  const ooaClasses = new Set<number>();
  for (const scenario of remaining) {
    if (heldOut.has(scenario.applicationFamilyId)) {
      assignments.push({ scenario, partition: "test-ooa" });
      const classNumber = lineageClassNumber(scenario);
      if (classNumber !== null) {
        ooaClasses.add(classNumber);
      }
      continue;
    }
    inDistribution.push(scenario);
  }

  // ---- LINEAGE ROTATION ---------------------------------------------------
  // Group by the lineage a scenario descends from, so variants travel with their
  // parent. Then walk each class's lineages in sorted order against the rotation.
  const lineages = new Map<string, ScenarioSpecification[]>();
  for (const scenario of inDistribution) {
    const bucket = lineages.get(scenario.parentLineageId);
    if (bucket === undefined) {
      lineages.set(scenario.parentLineageId, [scenario]);
    } else {
      bucket.push(scenario);
    }
  }

  const lineageFamily = new Map<string, string>();
  const lineagesByClass = new Map<number, string[]>();
  const unlabelledLineages: string[] = [];
  for (const [lineageId, scenarios] of lineages) {
    // A lineage's class is taken from its canonical scenario where present, and
    // otherwise from its first member; every member shares one intent class by
    // construction, which `verifyLineageClassCoherence` checks independently.
    const representative =
      scenarios.find((scenario) => scenario.variantKind === "canonical") ??
      (scenarios[0] as ScenarioSpecification);
    lineageFamily.set(lineageId, representative.applicationFamilyId);
    const classNumber = lineageClassNumber(representative);
    if (classNumber === null) {
      unlabelledLineages.push(lineageId);
      continue;
    }
    const bucket = lineagesByClass.get(classNumber);
    if (bucket === undefined) {
      lineagesByClass.set(classNumber, [lineageId]);
    } else {
      bucket.push(lineageId);
    }
  }

  const lineagePartition = new Map<string, Fc008DatasetPartition>();
  const sortedClasses = [...lineagesByClass.keys()].sort((a, b) => a - b);
  const cycleLength = ID_PARTITION_CYCLE.length;
  // Running state for the greedy pass. Both are "what train has seen so far", which is
  // what makes a later class's choice depend on earlier ones and the whole pass
  // order-sensitive — hence the fixed ascending class order above.
  const trainCategoricals = new Set<string>();
  const familyPartitionPairs = new Set<string>();

  for (const classNumber of sortedClasses) {
    const ids = (lineagesByClass.get(classNumber) as string[]).slice().sort();
    const ordered = interleaveByFamily(ids, lineageFamily);
    const slotFor = (index: number, offset: number): Fc008DatasetPartition =>
      ID_PARTITION_CYCLE[(index + offset) % cycleLength] as Fc008DatasetPartition;

    let chosenOffset = 0;
    let bestCoverageGain = -1;
    let bestFamilyGain = -1;
    for (let offset = 0; offset < cycleLength; offset += 1) {
      const newValues = new Set<string>();
      const newPairs = new Set<string>();
      for (const [index, lineageId] of ordered.entries()) {
        const slot = slotFor(index, offset);
        const pair = `${lineageFamily.get(lineageId) ?? ""}|${slot}`;
        if (!familyPartitionPairs.has(pair)) {
          newPairs.add(pair);
        }
        if (slot !== "train") {
          continue;
        }
        for (const value of authoredCategoricalValues(lineages.get(lineageId) ?? [])) {
          if (!trainCategoricals.has(value)) {
            newValues.add(value);
          }
        }
      }
      // Strict improvement only, so the lowest offset wins any remaining tie and the
      // whole selection is deterministic.
      const better =
        newValues.size > bestCoverageGain ||
        (newValues.size === bestCoverageGain && newPairs.size > bestFamilyGain);
      if (better) {
        chosenOffset = offset;
        bestCoverageGain = newValues.size;
        bestFamilyGain = newPairs.size;
      }
    }

    for (const [index, lineageId] of ordered.entries()) {
      const slot = slotFor(index, chosenOffset);
      lineagePartition.set(lineageId, slot);
      familyPartitionPairs.add(`${lineageFamily.get(lineageId) ?? ""}|${slot}`);
      if (slot === "train") {
        for (const value of authoredCategoricalValues(lineages.get(lineageId) ?? [])) {
          trainCategoricals.add(value);
        }
      }
    }
  }
  // A lineage the oracle could not label cannot be reported on, but it still must
  // not contaminate a fitted artifact, so it goes to policy-validation rather than
  // train or any test partition.
  for (const lineageId of unlabelledLineages.slice().sort()) {
    lineagePartition.set(lineageId, "policy-validation");
  }

  for (const [lineageId, scenarios] of [...lineages.entries()].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    const partition = lineagePartition.get(lineageId) as Fc008DatasetPartition;
    for (const scenario of scenarios) {
      assignments.push({ scenario, partition });
    }
  }

  // ---- COVERAGE CHECK -----------------------------------------------------
  // Every class measured out-of-application must be learnable in train from a
  // DIFFERENT application family, otherwise the measurement conflates "did not
  // generalize" with "never taught".
  const trainClasses = new Set<number>();
  for (const assignment of assignments) {
    if (assignment.partition !== "train") {
      continue;
    }
    const classNumber = lineageClassNumber(assignment.scenario);
    if (classNumber !== null) {
      trainClasses.add(classNumber);
    }
  }
  for (const classNumber of [...ooaClasses].sort((a, b) => a - b)) {
    if (!trainClasses.has(classNumber)) {
      return {
        ok: false,
        refusal: "ooa-class-absent-from-train",
        detail: `class ${classNumber} appears in test-ooa but not in train`,
      };
    }
  }

  const perPartitionCounts = FC008_DATASET_PARTITIONS.map((partition) => ({
    partition,
    count: assignments.filter((assignment) => assignment.partition === partition).length,
  }));

  return {
    ok: true,
    assignments: Object.freeze(assignments),
    diagnostics: {
      scenarioCount: assignments.length,
      lineageCount: lineages.size,
      perPartitionCounts: Object.freeze(perPartitionCounts),
      outOfApplicationClasses: Object.freeze([...ooaClasses].sort((a, b) => a - b)),
      noveltyScenarioCount: noveltyCount,
    },
  };
}

/**
 * Checks that every scenario in a lineage establishes the same class.
 *
 * A variant is supposed to change wording or layout, never meaning. If a paraphrase
 * silently changed the established transition, the lineage would carry two labels
 * and the whole-lineage assignment above would be assigning two different problems
 * to one partition.
 */
export function verifyLineageClassCoherence(
  scenarios: readonly ScenarioSpecification[],
): readonly string[] {
  const byLineage = new Map<string, Set<string>>();
  for (const scenario of scenarios) {
    const resolution = resolveOracleLabel(scenario.intent);
    const label =
      resolution.disposition === "resolved" ? String(resolution.classNumber) : "rejected";
    const bucket = byLineage.get(scenario.parentLineageId);
    if (bucket === undefined) {
      byLineage.set(scenario.parentLineageId, new Set([label]));
    } else {
      bucket.add(label);
    }
  }
  const problems: string[] = [];
  for (const [lineageId, labels] of [...byLineage.entries()].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    if (labels.size > 1) {
      problems.push(`LINEAGE_SPANS_MULTIPLE_CLASSES:${lineageId}`);
    }
  }
  return problems;
}
