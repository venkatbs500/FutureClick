/**
 * The six dataset partitions, as inert declared data.
 *
 * WHY THIS LIVES HERE BUT THE FITTER DOES NOT
 *
 * The rule that only `train` may inform a fitted artifact is architecture, so the
 * partition vocabulary and the rule belong in the architecture package. The
 * machinery that actually fits a vocabulary does NOT: it is an offline dataset
 * step, and exporting a fitting function from the package that ships to the
 * browser would put a learning capability in the runtime surface for no reason.
 * AI-12 says the runtime trains nothing, and the cheapest way to honour that is to
 * give the runtime no function that could.
 *
 * WHY FROZEN ARRAYS RATHER THAN MAPS
 *
 * `Object.freeze` does not make a `Map` immutable: `.set` and `.delete` still
 * work. Exporting a `Map` of architectural rules would therefore let any caller
 * rewrite them at runtime. These tables are frozen arrays of frozen entries, read
 * through accessor functions, matching `FC008_SUPPORT_OUTCOME_MAPPING`.
 */

/** The six partitions. Exactly these, in canonical reporting order. */
export const FC008_DATASET_PARTITIONS = Object.freeze([
  "train",
  "calibration",
  "policy-validation",
  "test-id",
  "test-ooa",
  "test-novelty",
] as const);
export type Fc008DatasetPartition = (typeof FC008_DATASET_PARTITIONS)[number];

/** The only partition any fitted artifact may be derived from. */
export const FC008_FITTABLE_PARTITION = "train" as const;

export interface PartitionRule {
  readonly partition: Fc008DatasetPartition;
  /** What this partition is permitted to decide. */
  readonly purpose: string;
  /** Whether a fitted vocabulary or weights may be derived from it. */
  readonly fittable: boolean;
}

/** The frozen partition table. One entry per partition, in canonical order. */
export const FC008_PARTITION_RULES: readonly PartitionRule[] = Object.freeze([
  Object.freeze({
    partition: "train",
    purpose: "feature vocabulary and model weights",
    fittable: true,
  }),
  Object.freeze({
    partition: "calibration",
    purpose: "temperature only, in Sprint 3",
    fittable: false,
  }),
  Object.freeze({
    partition: "policy-validation",
    purpose: "hyperparameters, regularization, and operational thresholds",
    fittable: false,
  }),
  Object.freeze({
    partition: "test-id",
    purpose: "final in-distribution reporting only",
    fittable: false,
  }),
  Object.freeze({
    partition: "test-ooa",
    purpose: "final held-out application-family reporting only",
    fittable: false,
  }),
  Object.freeze({
    partition: "test-novelty",
    purpose: "reporting on novel surfaces where abstention is the correct outcome",
    fittable: false,
  }),
] as const);

/** The rule for one partition. Throws on an unknown name rather than guessing. */
export function partitionRule(partition: Fc008DatasetPartition): PartitionRule {
  const found = FC008_PARTITION_RULES.find((rule) => rule.partition === partition);
  if (found === undefined) {
    throw new Error(`FC-008 partition has no declared rule: ${partition}`);
  }
  return found;
}

/** Whether a fitted artifact may be derived from this partition. */
export function isFittablePartition(partition: Fc008DatasetPartition): boolean {
  return partitionRule(partition).fittable;
}

/**
 * Self-check that the table and the partition list agree.
 *
 * Returns problem descriptions rather than throwing, so a test can report every
 * inconsistency at once. An empty array means the table is coherent.
 */
export function verifyPartitionRules(): readonly string[] {
  const problems: string[] = [];
  if (FC008_PARTITION_RULES.length !== FC008_DATASET_PARTITIONS.length) {
    problems.push("PARTITION_RULE_COUNT_MISMATCH");
  }
  for (const [index, partition] of FC008_DATASET_PARTITIONS.entries()) {
    if (FC008_PARTITION_RULES[index]?.partition !== partition) {
      problems.push(`PARTITION_ORDER_MISMATCH:${partition}`);
    }
  }
  const fittable = FC008_PARTITION_RULES.filter((rule) => rule.fittable).map(
    (rule) => rule.partition,
  );
  if (fittable.length !== 1 || fittable[0] !== FC008_FITTABLE_PARTITION) {
    problems.push("EXACTLY_ONE_FITTABLE_PARTITION_EXPECTED");
  }
  return problems;
}
