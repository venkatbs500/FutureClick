/**
 * Leakage, duplication, and circularity audits.
 *
 * WHAT COUNTS AS A BLOCKER VERSUS A DIAGNOSTIC
 *
 * Some findings are unambiguous defects: the same lineage in two partitions, a
 * canonical record duplicated across the train/test boundary, an oracle label
 * literally rendered into button text. Those are BLOCKERS.
 *
 * Feature-label association is NOT one of them. In a corpus about deleting things,
 * the token "delete" will predict the delete class almost perfectly, and that is
 * the task rather than a defect. Reporting it as leakage would be a category error.
 * So mutual information is computed and reported as a DIAGNOSTIC, and only one
 * specific cause — the generator having inserted the canonical label text itself —
 * is treated as a blocker. That distinction is the difference between an audit that
 * is useful and one that cries wolf.
 */

import {
  FC008_SUPPORT_MATRIX,
  type FeaturePolicy,
  type FeatureVocabulary,
  type Fc008DatasetPartition,
  PROHIBITED_PRIMARY_FEATURE_INPUTS,
  projectPrimaryFeatures,
} from "@futureclick/action-understanding";
import type { FutureBenchRecord } from "./record.js";
import { canonicalJson, sha256Hex } from "./canonical.js";

/** Audit identifiers, so a report names findings from a closed set. */
export const AUDIT_CODES = Object.freeze([
  "EXACT_RECORD_DUPLICATE_ACROSS_PARTITIONS",
  "EXACT_RECORD_DUPLICATE_WITHIN_PARTITION",
  "NORMALIZED_OBSERVATION_DUPLICATE_ACROSS_PARTITIONS",
  "FEATURE_VECTOR_DUPLICATE_ACROSS_PARTITIONS",
  "LINEAGE_SPANS_PARTITIONS",
  "VARIANT_SIBLING_SPANS_PARTITIONS",
  "APPLICATION_FAMILY_LEAKS_INTO_OOA",
  "OOA_CLASS_ABSENT_FROM_TRAIN",
  "ORACLE_PROXY_REACHABLE_IN_FEATURES",
  "CANONICAL_LABEL_TEXT_INJECTED",
  "ORACLE_PROXY_TEXT_INJECTED",
  "PROHIBITED_FEATURE_NAME_PRESENT",
  "TRAIN_VOCABULARY_CONTAMINATED",
  "LINEAGE_SPANS_MULTIPLE_CLASSES",
  "FEATURE_PROJECTION_FAILED",
  "ID_PARTITION_FAMILY_ABSENT_FROM_TRAIN",
  "APPLICATION_FAMILY_ALIASES_PARTITION",
  "CLASS_ABSENT_FROM_TRAIN",
  "PARTITION_EMPTY",
  "CATEGORICAL_VALUE_ABSENT_FROM_TRAIN",
] as const);
export type AuditCode = (typeof AUDIT_CODES)[number];

export interface AuditFinding {
  readonly code: AuditCode;
  readonly severity: "blocker" | "diagnostic";
  /** Bounded detail. Identifiers and counts only; never observation text. */
  readonly detail: string;
}

export interface MutualInformationFinding {
  readonly featureName: string;
  /** Mutual information with the label, in bits. */
  readonly bits: number;
  /** Classes in which the feature appears. */
  readonly classNumbers: readonly number[];
  /** True when the feature appears in exactly one class across the corpus. */
  readonly perfectlyPredictive: boolean;
}

export interface AuditReport {
  readonly findings: readonly AuditFinding[];
  readonly blockerCount: number;
  readonly diagnosticCount: number;
  /** Highest-association features, for human review. Not a leakage claim. */
  readonly topAssociatedFeatures: readonly MutualInformationFinding[];
}

/** Records grouped by partition, the shape every audit consumes. */
export interface AuditInput {
  readonly records: readonly FutureBenchRecord[];
  readonly vocabulary: FeatureVocabulary;
  readonly policy: FeaturePolicy;
}

function finding(
  code: AuditCode,
  severity: "blocker" | "diagnostic",
  detail: string,
): AuditFinding {
  return { code, severity, detail };
}

// ============================================================================
// DUPLICATION
// ============================================================================

/**
 * The normalized observation key: the semantics only.
 *
 * Two records whose sanitized Layer B is identical present the model with the same
 * problem, whatever their identifiers say. Ids, partition, and lineage are excluded
 * deliberately — including them would make every record unique and the audit
 * vacuous.
 */
export function normalizedObservationKey(record: FutureBenchRecord): string {
  return sha256Hex(canonicalJson(JSON.parse(JSON.stringify(record.observation.semantics))));
}

/**
 * The content key for exact-duplicate detection.
 *
 * `partition`, `recordId`, and `recordHash` are excluded deliberately. All three are
 * part of the canonical record — correctly, since the manifest must pin them — but
 * including them here would make the audit unable to fire. Two copies of the same
 * record in train and test differ in exactly the `partition` field, so hashing the
 * full canonical text would give them different hashes and report no duplicate,
 * which is precisely the case the audit exists to catch.
 *
 * Everything else is in: observation, oracle, benchmark metadata, lineage, and the
 * consequence annotation. Variants therefore remain distinct records rather than
 * being collapsed into duplicates of their parent.
 */
function recordContentKey(record: FutureBenchRecord): string {
  const {
    partition: _partition,
    recordId: _recordId,
    recordHash: _recordHash,
    ...content
  } = record;
  return sha256Hex(canonicalJson(JSON.parse(JSON.stringify(content)) as unknown));
}

function auditDuplicates(records: readonly FutureBenchRecord[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const byExact = new Map<string, FutureBenchRecord[]>();
  for (const record of records) {
    const key = recordContentKey(record);
    const bucket = byExact.get(key);
    if (bucket === undefined) {
      byExact.set(key, [record]);
    } else {
      bucket.push(record);
    }
  }
  for (const [key, group] of byExact) {
    if (group.length < 2) {
      continue;
    }
    const partitions = new Set(group.map((record) => record.partition));
    const code: AuditCode =
      partitions.size > 1
        ? "EXACT_RECORD_DUPLICATE_ACROSS_PARTITIONS"
        : "EXACT_RECORD_DUPLICATE_WITHIN_PARTITION";
    findings.push(
      finding(code, "blocker", `${group.length} records share canonical hash ${key.slice(0, 12)}`),
    );
  }

  const byNormalized = new Map<string, Set<Fc008DatasetPartition>>();
  for (const record of records) {
    const key = normalizedObservationKey(record);
    const bucket = byNormalized.get(key);
    if (bucket === undefined) {
      byNormalized.set(key, new Set([record.partition]));
    } else {
      bucket.add(record.partition);
    }
  }
  for (const [key, partitions] of byNormalized) {
    if (partitions.size > 1) {
      findings.push(
        finding(
          "NORMALIZED_OBSERVATION_DUPLICATE_ACROSS_PARTITIONS",
          "blocker",
          `semantics ${key.slice(0, 12)} appears in ${[...partitions].sort().join(", ")}`,
        ),
      );
    }
  }

  return findings;
}

/**
 * Feature-vector duplicates across partitions.
 *
 * Stricter than observation duplication: two different observations can project to
 * the same vector, and if they sit on opposite sides of the train/test boundary the
 * model has effectively already seen the test input.
 */
function auditFeatureVectorDuplicates(input: AuditInput): AuditFinding[] {
  const byVector = new Map<string, Set<Fc008DatasetPartition>>();
  const findings: AuditFinding[] = [];
  for (const record of input.records) {
    const projection = projectPrimaryFeatures(
      record.observation.semantics,
      input.vocabulary,
      input.policy,
    );
    if (!projection.ok) {
      // Never a silent `continue`. A record that cannot be projected is a record this
      // audit did not actually examine, so skipping it quietly would let the duplicate
      // check report "clean" over a corpus it had only partially read — the one failure
      // mode an audit must not have.
      //
      // This is a blocker for every partition, novelty included. test-novelty records
      // are unsupported SEMANTICALLY, meaning the oracle declines to label them, but
      // they are still well-formed observations and the model must be able to project
      // them in order to abstain. A novelty record that cannot be projected is broken,
      // not unsupported.
      findings.push(
        finding(
          "FEATURE_PROJECTION_FAILED",
          "blocker",
          `${record.recordId} (${record.partition}) could not be projected: ${projection.reason}`,
        ),
      );
      continue;
    }
    const key = projection.projection.vector.indices.join(",");
    const bucket = byVector.get(key);
    if (bucket === undefined) {
      byVector.set(key, new Set([record.partition]));
    } else {
      bucket.add(record.partition);
    }
  }
  for (const [key, partitions] of byVector) {
    if (partitions.size > 1) {
      findings.push(
        finding(
          "FEATURE_VECTOR_DUPLICATE_ACROSS_PARTITIONS",
          "blocker",
          `vector ${sha256Hex(key).slice(0, 12)} appears in ${[...partitions].sort().join(", ")}`,
        ),
      );
    }
  }
  return findings;
}

// ============================================================================
// PARTITION INTEGRITY
// ============================================================================

function auditPartitionIntegrity(records: readonly FutureBenchRecord[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const lineagePartitions = new Map<string, Set<Fc008DatasetPartition>>();
  const parentPartitions = new Map<string, Set<Fc008DatasetPartition>>();
  const familyPartitions = new Map<string, Set<Fc008DatasetPartition>>();
  for (const record of records) {
    for (const [map, key] of [
      [lineagePartitions, record.lineage.templateLineageId],
      [parentPartitions, record.lineage.parentLineageId],
      [familyPartitions, record.lineage.applicationFamilyId],
    ] as const) {
      const bucket = map.get(key);
      if (bucket === undefined) {
        map.set(key, new Set([record.partition]));
      } else {
        bucket.add(record.partition);
      }
    }
  }

  for (const [lineageId, partitions] of [...lineagePartitions].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    if (partitions.size > 1) {
      findings.push(
        finding(
          "LINEAGE_SPANS_PARTITIONS",
          "blocker",
          `${lineageId} in ${[...partitions].sort().join(", ")}`,
        ),
      );
    }
  }
  for (const [parentId, partitions] of [...parentPartitions].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    if (partitions.size > 1) {
      findings.push(
        finding(
          "VARIANT_SIBLING_SPANS_PARTITIONS",
          "blocker",
          `variants of ${parentId} in ${[...partitions].sort().join(", ")}`,
        ),
      );
    }
  }

  // An out-of-application family must appear ONLY in test-ooa. Any other partition
  // containing it means the family was not actually held out.
  for (const [familyId, partitions] of [...familyPartitions].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    if (partitions.has("test-ooa") && partitions.size > 1) {
      const others = [...partitions].filter((p) => p !== "test-ooa" && p !== "test-novelty");
      if (others.length > 0) {
        findings.push(
          finding(
            "APPLICATION_FAMILY_LEAKS_INTO_OOA",
            "blocker",
            `${familyId} is held out yet also appears in ${others.sort().join(", ")}`,
          ),
        );
      }
    }
  }

  // Every class measured out-of-application must be learnable in train.
  const trainClasses = new Set<number>();
  const ooaClasses = new Set<number>();
  for (const record of records) {
    if (record.oracle.classNumber === null) {
      continue;
    }
    if (record.partition === "train") {
      trainClasses.add(record.oracle.classNumber);
    }
    if (record.partition === "test-ooa") {
      ooaClasses.add(record.oracle.classNumber);
    }
  }
  for (const classNumber of [...ooaClasses].sort((a, b) => a - b)) {
    if (!trainClasses.has(classNumber)) {
      findings.push(
        finding(
          "OOA_CLASS_ABSENT_FROM_TRAIN",
          "blocker",
          `class ${classNumber} measured out-of-application but never trained`,
        ),
      );
    }
  }

  return findings;
}

/**
 * Every record descending from one authored lineage must carry one class.
 *
 * A variant is supposed to change wording or layout, never meaning. If a paraphrase
 * silently established a different transition, the lineage would carry two labels
 * while being assigned to one partition as a unit, so the partition would hold two
 * different problems under one identity — and the oracle would look inconsistent for
 * reasons that are really an authoring error.
 *
 * `verifyLineageClassCoherence` in the partitioner checks the same property over
 * SCENARIO specifications, before records exist. This checks the built RECORDS. Both
 * are wanted: the scenario check catches an authoring mistake at its source with a
 * useful message, and the record check catches anything that corrupted a label
 * between specification and record, which the scenario check cannot see.
 */
function auditLineageClassCoherence(records: readonly FutureBenchRecord[]): AuditFinding[] {
  const labelsByLineage = new Map<string, Set<string>>();
  for (const record of records) {
    const label =
      record.oracle.classNumber === null ? "unlabelled" : String(record.oracle.classNumber);
    const bucket = labelsByLineage.get(record.lineage.parentLineageId);
    if (bucket === undefined) {
      labelsByLineage.set(record.lineage.parentLineageId, new Set([label]));
    } else {
      bucket.add(label);
    }
  }
  const findings: AuditFinding[] = [];
  for (const [lineageId, labels] of [...labelsByLineage].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    if (labels.size > 1) {
      findings.push(
        finding(
          "LINEAGE_SPANS_MULTIPLE_CLASSES",
          "blocker",
          `${lineageId} carries ${labels.size} different labels across its variants`,
        ),
      );
    }
  }
  return findings;
}

// ============================================================================
// PARTITION / FAMILY ALIASING
// ============================================================================

/**
 * The four in-distribution partitions. Not the test-OOA or test-novelty holdouts.
 *
 * Kept local rather than imported from the partitioner so the audit does not inherit
 * the partitioner's idea of what in-distribution means. An audit that asks the code
 * it is auditing to define the thing being checked is not an independent check.
 */
const ID_PARTITIONS: readonly Fc008DatasetPartition[] = Object.freeze([
  "train",
  "calibration",
  "policy-validation",
  "test-id",
]);

/**
 * Detects application family aliasing an in-distribution partition.
 *
 * This exists because of a real defect. Lineage ids are family-prefixed, so sorting
 * them grouped Family A ahead of Family B, and a four-slot rotation then gave A the
 * first two partitions and B the last two for every class. train and calibration
 * became entirely Family A; policy-validation and test-ID entirely Family B.
 *
 * The consequence is worse than an imbalance. test-ID is reported as an
 * in-distribution number, but a test-ID partition made of one whole application
 * family that never appears in train is a second out-of-application test under the
 * wrong name — a strictly harder measurement, published as the easier one. It also
 * starves the vocabulary, since any categorical value that happens to live only in
 * the family excluded from train can never be fitted.
 *
 * Three things are checked, all blockers:
 *
 *   1. every family in an in-distribution partition also appears in train;
 *   2. test-ID's families are not disjoint from train's;
 *   3. no family is confined to exactly one in-distribution partition while the
 *      corpus has more than one family and more than one such partition in play.
 *
 * Check 3 is the regression guard proper. Checks 1 and 2 would both have passed a
 * corpus where A owned train+calibration and B owned policy-validation+test-ID only
 * if A and B each spanned two partitions, which they did not — but a future variant
 * of the same bug could satisfy them, so the aliasing itself is named directly.
 */
function auditPartitionFamilyAliasing(records: readonly FutureBenchRecord[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const idPartitions = new Set<Fc008DatasetPartition>(ID_PARTITIONS);

  const familiesByPartition = new Map<Fc008DatasetPartition, Set<string>>();
  const idPartitionsByFamily = new Map<string, Set<Fc008DatasetPartition>>();
  for (const record of records) {
    if (!idPartitions.has(record.partition)) {
      continue;
    }
    const familyId = record.lineage.applicationFamilyId;
    const forPartition = familiesByPartition.get(record.partition);
    if (forPartition === undefined) {
      familiesByPartition.set(record.partition, new Set([familyId]));
    } else {
      forPartition.add(familyId);
    }
    const forFamily = idPartitionsByFamily.get(familyId);
    if (forFamily === undefined) {
      idPartitionsByFamily.set(familyId, new Set([record.partition]));
    } else {
      forFamily.add(record.partition);
    }
  }

  const trainFamilies = familiesByPartition.get("train") ?? new Set<string>();

  // 1. families(partition) must be a subset of families(train).
  for (const partition of ID_PARTITIONS) {
    if (partition === "train") {
      continue;
    }
    const families = familiesByPartition.get(partition);
    if (families === undefined) {
      continue;
    }
    for (const familyId of [...families].sort()) {
      if (!trainFamilies.has(familyId)) {
        findings.push(
          finding(
            "ID_PARTITION_FAMILY_ABSENT_FROM_TRAIN",
            "blocker",
            `${partition} contains ${familyId}, which never appears in train`,
          ),
        );
      }
    }
  }

  // 2. test-ID must overlap train by family, not merely be a subset of nothing.
  const testIdFamilies = familiesByPartition.get("test-id") ?? new Set<string>();
  if (testIdFamilies.size > 0 && trainFamilies.size > 0) {
    const shared = [...testIdFamilies].filter((familyId) => trainFamilies.has(familyId));
    if (shared.length === 0) {
      findings.push(
        finding(
          "APPLICATION_FAMILY_ALIASES_PARTITION",
          "blocker",
          "test-id shares no application family with train, so it is not in-distribution",
        ),
      );
    }
  }

  // 3. No family confined to a single in-distribution partition.
  const populatedIdPartitions = ID_PARTITIONS.filter(
    (partition) => (familiesByPartition.get(partition)?.size ?? 0) > 0,
  );
  if (idPartitionsByFamily.size > 1 && populatedIdPartitions.length > 1) {
    for (const [familyId, partitions] of [...idPartitionsByFamily].sort(([a], [b]) =>
      a.localeCompare(b, "en"),
    )) {
      if (partitions.size === 1) {
        findings.push(
          finding(
            "APPLICATION_FAMILY_ALIASES_PARTITION",
            "blocker",
            `${familyId} occurs in only one in-distribution partition (${[...partitions].join(", ")}), so family aliases partition`,
          ),
        );
      }
    }
  }

  // Every supported class must be learnable, whatever partition it is measured in.
  const trainClasses = new Set<number>();
  const supportedClasses = new Set<number>();
  for (const record of records) {
    if (record.oracle.classNumber === null) {
      continue;
    }
    supportedClasses.add(record.oracle.classNumber);
    if (record.partition === "train") {
      trainClasses.add(record.oracle.classNumber);
    }
  }
  for (const classNumber of [...supportedClasses].sort((a, b) => a - b)) {
    if (!trainClasses.has(classNumber)) {
      findings.push(
        finding(
          "CLASS_ABSENT_FROM_TRAIN",
          "blocker",
          `class ${classNumber} occurs in the corpus but never in train`,
        ),
      );
    }
  }

  return findings;
}

/**
 * Reports closed categorical values that occur in the in-distribution corpus but
 * never in train, so the fitted vocabulary cannot contain them.
 *
 * DIAGNOSTIC, not a blocker. A value genuinely rare enough to miss train is a fact
 * about the authored corpus rather than a construction error, and the projector
 * already handles an unseen feature by ignoring it. What makes this worth reporting
 * is the case that actually happened: `fm:other` existed on eleven records that were
 * all Family-B policy-validation, so a partitioning defect — not a scarcity of
 * authored material — kept the value out of the feature space entirely. A balanced
 * split fixes that, and this audit is how anyone would notice it had regressed.
 *
 * Scoped to in-distribution partitions on purpose. test-novelty deliberately carries
 * values train must never see, such as `fm:get` on an unsupported search form, and
 * reporting those would invert the intent.
 */
function auditCategoricalTrainCoverage(records: readonly FutureBenchRecord[]): AuditFinding[] {
  const idPartitions = new Set<Fc008DatasetPartition>(ID_PARTITIONS);
  const inTrain = new Set<string>();
  const inCorpus = new Map<string, number>();

  for (const record of records) {
    if (!idPartitions.has(record.partition)) {
      continue;
    }
    const semantics = record.observation.semantics;
    const values: string[] = [
      `fm:${semantics.formMethod}`,
      `sk:${semantics.surfaceKind}`,
      `ck:${semantics.controlKind}`,
      `cr:${semantics.controlRole}`,
      `ik:${semantics.interactionKind}`,
    ];
    for (const value of values) {
      inCorpus.set(value, (inCorpus.get(value) ?? 0) + 1);
      if (record.partition === "train") {
        inTrain.add(value);
      }
    }
  }

  const findings: AuditFinding[] = [];
  for (const [value, count] of [...inCorpus].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    if (!inTrain.has(value)) {
      findings.push(
        finding(
          "CATEGORICAL_VALUE_ABSENT_FROM_TRAIN",
          "diagnostic",
          `${value} occurs on ${count} in-distribution records but none in train`,
        ),
      );
    }
  }
  return findings;
}

// ============================================================================
// ORACLE PROXY AND CIRCULARITY
// ============================================================================

/**
 * Feature families the vocabulary is allowed to contain.
 *
 * A closed allowlist of PREFIXES is the whole check, and it is deliberately not a
 * keyword scan over feature names. Keyword scanning does not work here: the word
 * "storage" is on the prohibited-input list because browser storage must never be
 * captured, but "storage" is also an ordinary noun that a file product puts in a
 * heading. Flagging `tok:hd:storage` would report a privacy violation for a button
 * that says "Erase the selected files from storage", which is both wrong and the
 * kind of wrong that teaches people to ignore the audit.
 *
 * The prohibited inputs are data SOURCES, not words. A source can only reach the
 * model as a new feature family — `host:`, `url:`, `ts:` — so the family prefix is
 * exactly the right place to check, and it has no false positives.
 */
const PERMITTED_FEATURE_FAMILIES: readonly string[] = Object.freeze([
  "tok", // sanitized fixed-vocabulary semantic token on a named channel
  "chan", // channel identity
  "ck", // control kind
  "cr", // control role
  "ik", // interaction kind
  "sk", // surface kind
  "fm", // form method
  "st", // categorical state token, property-scoped
  "obj", // object-kind evidence
  "dstr", // destructive weak signal
  "miss", // missingness indicator
  "cnt", // bounded structural count bucket
]);

/**
 * Verifies the fitted vocabulary contains only permitted feature families and no
 * oracle or identity proxies.
 *
 * This is the independent second line. The type system already proves the projector
 * cannot reach oracle data, because `projectPrimaryFeatures` takes
 * `ObservationSemantics` and the label is not in it. This audit checks the ARTIFACT
 * instead, so a feature that embedded a class number or a lineage id would be caught
 * regardless of which code path produced it.
 */
function auditOracleProxies(input: AuditInput): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const permitted = new Set(PERMITTED_FEATURE_FAMILIES);
  const prohibitedSources = new Set<string>(
    PROHIBITED_PRIMARY_FEATURE_INPUTS.map((name) => name.toLowerCase()),
  );

  // Patterns applied to the FAMILY and to structured values only. A class number or
  // a lineage id has a recognizable shape; an English word does not.
  const proxyPatterns: readonly { pattern: RegExp; label: string }[] = [
    { pattern: /^(?:class|label|target|oracle|truth|y)\d*$/i, label: "label-like family" },
    {
      pattern: /^(?:lineage|scenario|fixture|generator|record|split|partition)/i,
      label: "identity-like family",
    },
  ];

  for (const name of input.vocabulary.entries.keys()) {
    const family = name.slice(0, name.indexOf(":") === -1 ? undefined : name.indexOf(":"));
    if (!permitted.has(family)) {
      findings.push(
        finding(
          "PROHIBITED_FEATURE_NAME_PRESENT",
          "blocker",
          `feature family "${family}" is not in the permitted set`,
        ),
      );
      // A family that is already rejected needs no further diagnosis.
      continue;
    }
    if (prohibitedSources.has(family.toLowerCase())) {
      findings.push(
        finding(
          "PROHIBITED_FEATURE_NAME_PRESENT",
          "blocker",
          `feature family "${family}" names a prohibited input source`,
        ),
      );
    }
    for (const { pattern, label } of proxyPatterns) {
      if (pattern.test(family)) {
        findings.push(
          finding("ORACLE_PROXY_REACHABLE_IN_FEATURES", "blocker", `${name} is ${label}`),
        );
      }
    }

    // The family alone is not enough for text tokens. `tok:ctl:c08` has the permitted
    // family `tok`, so family screening passes it, and the class-encoding value rides
    // through into the feature space. The VALUE segment is screened with the same
    // patterns used on rendered text, which makes the vocabulary a second independent
    // place a proxy has to survive rather than a weaker one.
    const valueProxy = featureValueProxyLabel(name);
    if (valueProxy !== null) {
      findings.push(
        finding(
          "ORACLE_PROXY_REACHABLE_IN_FEATURES",
          "blocker",
          `${name} carries a ${valueProxy} in its value segment`,
        ),
      );
    }
  }
  return findings;
}

/**
 * Screens the value segment of a token feature name for an oracle proxy.
 *
 * Only `tok:` features are screened. `obj:repository`, `st:visibility:private`, and
 * `st:name:current` are closed categorical vocabularies whose values are fixed by the
 * schema, so there is nothing for a generator to smuggle through them; `tok:` is the
 * open channel that carries whatever the surface rendered.
 */
function featureValueProxyLabel(featureName: string): string | null {
  const parts = featureName.split(":");
  if (parts[0] !== "tok" || parts.length < 3) {
    return null;
  }
  const value = parts.slice(2).join(":");
  const tokens = normalizeProxyText(value);
  for (const token of tokens) {
    if (GENERATOR_CLASS_ID_PATTERN.test(token)) {
      return "class-indexed generator id";
    }
  }
  const joined = tokens.join("");
  for (const { pattern, label } of ORACLE_PROXY_WINDOW_PATTERNS) {
    if (pattern.test(joined)) {
      return label;
    }
  }
  return null;
}

/**
 * Channels that carry rendered interface TEXT.
 *
 * `st` is excluded because it is a categorical state channel, not text. The current
 * state of a surface is a legitimate observation — a sharing dialog genuinely does
 * display "private" — and the model is supposed to see it. Counting it as rendered
 * label text would make the audit fire on every correctly built record.
 */
const TEXT_CHANNELS: readonly string[] = Object.freeze(["ctl", "acc", "hd", "nb"]);

/**
 * Detects the generator having rendered the canonical label into the surface.
 *
 * This is the circularity that would make the whole benchmark meaningless. If a
 * button literally reads "change-access repository visibility private public", then
 * a model that scores well has learned string matching and the result says nothing
 * about semantic inference. The signature is the FULL canonical tuple — verb, object
 * kind, property, and both endpoints — all present in rendered text at once.
 *
 * Requiring all five matters. A delete dialog containing the word "delete" is the
 * task, not a defect; a delete dialog that also spells out "existence present
 * absent" is a generator leaking its own answer key.
 */
/**
 * Direct oracle-representation proxies, as token-level patterns.
 *
 * These target the GENERATOR'S OWN REPRESENTATION of the answer rather than the
 * semantics of the interface. The distinction is the whole design of this check, and
 * getting it wrong in either direction is costly.
 *
 * Legitimate, and deliberately NOT matched: `obj:repository`, `st:visibility:private`,
 * `st:name:current`, a button reading "Delete", a heading reading "Make public". A
 * sharing dialog genuinely displays the word "private"; that is the observation the
 * model is supposed to make, and calling it leakage because it is predictive would be
 * a category error that makes the audit useless.
 *
 * Prohibited, and matched: a class number, a support-matrix row id, a serialized
 * tuple key, a generator-internal label, a scenario or template id that encodes the
 * class. None of those is something a product would ever render. They can only be
 * present because the generator leaked its own bookkeeping into display text, and a
 * model that reads them is reading the answer key.
 *
 * SEPARATORS MUST NOT DEFEAT THIS CHECK. An earlier version matched only joined
 * forms — `groundtruth`, `row8`, `scenarioid` — which is the one shape real leakage
 * almost never takes. Normalization splits on every non-alphanumeric character, so
 * `ground-truth` arrives as two tokens and `support-row-8` as three, and every one of
 * those patterns silently stopped matching the moment the text was realistic. The
 * hand-written tests passed because they injected the already-joined forms, which is
 * exactly how a check can look green while testing nothing.
 *
 * The patterns are therefore matched against JOINED WINDOWS of consecutive tokens
 * rather than single tokens, so `support-row-8`, `support_row_8`, `support/row/8`,
 * `support row 8` and `supportrow8` all reduce to the same candidate and all match.
 * Each pattern stays anchored to a whole window, so `classroom` and `subclass` are
 * still not `class8`.
 */
/**
 * Reduces raw text to the token sequence the audit reasons about.
 *
 * Deliberately a local reimplementation of the normalization grammar rather than a
 * call into the sanitizer. An audit that asks the pipeline it is auditing to decide
 * what the text "really says" inherits that pipeline's blind spots, and the specific
 * failure this guards against is a normalization change quietly widening what can
 * reach model-facing text. A parity test pins this against the sanitizer so the two
 * cannot drift apart unnoticed; the point is that drift becomes a test failure
 * instead of an invisible hole.
 *
 * The grammar is the one FutureClick actually uses: fold Unicode, lowercase, treat
 * every non-alphanumeric run as a separator. That covers `-`, `_`, `/`, `:`, `.` and
 * whitespace without enumerating them, which is why the separator matrix collapses to
 * a single code path.
 */
export function normalizeProxyText(raw: string): readonly string[] {
  return raw
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((part) => part.length > 0);
}

/**
 * Longest run of consecutive tokens joined into one proxy candidate.
 *
 * Three is the length of the longest proxy convention in use — `support row 8`,
 * `resolved oracle class`, `ground truth` plus one. Unbounded joining would start
 * manufacturing matches out of ordinary sentences.
 */
const PROXY_WINDOW_MAX_TOKENS = 3;

/**
 * Ordered token values on one channel.
 *
 * Tokens from different fields of the same channel are concatenated, so two adjacent
 * headings can appear to form a window that neither contains alone. That is the
 * conservative direction for an audit and it is left as-is: a false positive here
 * costs a reviewer one look at authored copy, while a false negative costs the
 * benchmark its meaning.
 */
function channelTokenSequence(record: FutureBenchRecord, channel: string): readonly string[] {
  return record.observation.semantics.tokens
    .filter((token) => token.channel === channel)
    .map((token) => token.value);
}

/**
 * Canonical tuple identities as normalized token runs, e.g. `change access repository
 * visibility` for class 8.
 *
 * Every row of the frozen matrix is included rather than only the record's own class.
 * A surface rendering some other class's tuple key is not a helpful hint, but it is
 * still the generator writing its own bookkeeping into display text, and treating
 * that as acceptable would leave an obvious evasion open.
 */
const CANONICAL_TUPLE_SIGNATURES: readonly { tokens: readonly string[]; label: string }[] =
  Object.freeze(
    FC008_SUPPORT_MATRIX.map((row) => ({
      tokens: [
        ...normalizeProxyText(row.tuple.verb),
        ...normalizeProxyText(row.tuple.objectKind),
        ...normalizeProxyText(row.tuple.transition.property),
      ],
      label: `${row.tuple.verb}/${row.tuple.objectKind}/${row.tuple.transition.property}`,
    })),
  );

/**
 * Finds a mechanically serialized canonical tuple key in a token sequence.
 *
 * The signature is verb, object kind, and property CONTIGUOUS and in canonical order,
 * which is what `change-access/repository/visibility` normalizes to and what authored
 * copy does not. This is the line between machine representation and human language,
 * and it is drawn by contiguity rather than by co-occurrence.
 *
 * "Change repository visibility" is ordinary product copy and must stay allowed. It
 * survives because the canonical verb is `change-access`: the signature requires
 * `access` immediately after `change`, and the human phrase puts `repository` there.
 * Co-occurrence alone would have flagged it, which is precisely the false positive
 * that would make authors route around the audit.
 *
 * Only the first three tuple fields participate. Requiring `from` and `to` as well is
 * the FULL-LABEL check's job, and demanding five fields here would miss the shorter
 * serialization that a generator is far more likely to emit.
 */
function serializedTupleKeyIn(sequence: readonly string[]): string | null {
  for (const { tokens, label } of CANONICAL_TUPLE_SIGNATURES) {
    for (let start = 0; start + tokens.length <= sequence.length; start += 1) {
      let matched = true;
      for (const [offset, expected] of tokens.entries()) {
        if (sequence[start + offset] !== expected) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return label;
      }
    }
  }
  return null;
}

const ORACLE_PROXY_WINDOW_PATTERNS: readonly { pattern: RegExp; label: string }[] = Object.freeze([
  { pattern: /^class\d{1,2}$/, label: "class number" },
  { pattern: /^(?:tuple|row)\d{1,2}$/, label: "canonical row id" },
  {
    pattern: /^(?:support|matrix)(?:matrix|row)\d{1,2}$/,
    label: "support-matrix row id",
  },
  { pattern: /^(?:fc008|fb)(?:class|tuple|label|oracle|row|truth)\w*$/, label: "generator label" },
  {
    pattern:
      /^(?:groundtruth|oracleclass|oracletruth|oraclelabel|resolvedoracleclass|resolvedoraclelabel)$/,
    label: "ground-truth field name",
  },
  {
    pattern: /^(?:class|label)(?:number|index|id)$/,
    label: "oracle label name",
  },
  { pattern: /^(?:lineage|scenario|template|fixture|generator)id$/, label: "identity key" },
]);

/**
 * A generator-internal lineage id that encodes the class it belongs to.
 *
 * Family B authors its lineages as `b-c08-repo-open`: a family prefix, a `cNN` class
 * token, and a descriptor. The `cNN` token is the whole signal and it is the reason
 * this family of proxy needs its own pattern — a bare `c08` is not a class number
 * pattern, not a row id, and not a field name, so every pattern above misses it while
 * it names class 8 to anyone who knows the convention. Which a model does not need to:
 * it only needs the token to correlate.
 *
 * Deliberately narrow. The signal is the `c`-plus-index convention as a whole token,
 * not the presence of a digit, so `s3`, `h2`, `utf8`, and `v2` are untouched. Ordinary
 * product copy does not contain a standalone `c08`.
 */
const GENERATOR_CLASS_ID_PATTERN = /^c\d{1,2}$/;

/**
 * Detects a direct oracle proxy in any model-facing text channel.
 *
 * Separate from the full-tuple check below, and deliberately so. The full-tuple
 * signature needs all five components precisely because each one alone is innocent;
 * a direct proxy needs no corroboration because there is no innocent reading of a
 * rendered class number. Requiring the five-part signature before reporting `class-8`
 * would have let the most obvious possible leak through.
 *
 * Every text channel is inspected individually — `ctl`, `acc`, `hd`, `nb` — because a
 * proxy in an accessible name is exactly as reachable by the model as one in button
 * text, and an audit that only read button text would be trivially evadable.
 */
function auditOracleProxyText(records: readonly FutureBenchRecord[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const record of records) {
    const reported = new Set<string>();
    const report = (channel: string, label: string, detail: string): void => {
      const key = `${channel}|${label}`;
      if (reported.has(key)) {
        return;
      }
      reported.add(key);
      findings.push(
        finding(
          "ORACLE_PROXY_TEXT_INJECTED",
          "blocker",
          `${record.recordId} carries ${detail} on channel ${channel}`,
        ),
      );
    };

    for (const channel of TEXT_CHANNELS) {
      const sequence = channelTokenSequence(record, channel);
      if (sequence.length === 0) {
        continue;
      }

      for (const [position, token] of sequence.entries()) {
        if (GENERATOR_CLASS_ID_PATTERN.test(token)) {
          report(channel, "generator id", `a class-indexed generator id ("${token}")`);
        }
        for (let size = 1; size <= PROXY_WINDOW_MAX_TOKENS; size += 1) {
          if (position + size > sequence.length) {
            break;
          }
          const joined = sequence.slice(position, position + size).join("");
          for (const { pattern, label } of ORACLE_PROXY_WINDOW_PATTERNS) {
            if (pattern.test(joined)) {
              report(channel, label, `a ${label} ("${joined}")`);
            }
          }
        }
      }

      const serialized = serializedTupleKeyIn(sequence);
      if (serialized !== null) {
        report(channel, "tuple key", `a serialized canonical tuple key ("${serialized}")`);
      }
    }
  }
  return findings;
}

function auditCanonicalLabelInjection(records: readonly FutureBenchRecord[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const textChannels = new Set(TEXT_CHANNELS);
  for (const record of records) {
    const tuple = record.oracle.supportedTuple;
    if (tuple === null) {
      continue;
    }
    const required = [tuple.verb, tuple.objectKind, tuple.property, tuple.from, tuple.to]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length > 0);
    const rendered = new Set(
      record.observation.semantics.tokens
        .filter((token) => textChannels.has(token.channel))
        .map((token) => token.value),
    );
    if (required.every((part) => rendered.has(part))) {
      findings.push(
        finding(
          "CANONICAL_LABEL_TEXT_INJECTED",
          "blocker",
          `${record.recordId} carries every canonical tuple component as rendered text`,
        ),
      );
    }
  }
  return findings;
}

// ============================================================================
// TRAIN VOCABULARY CONTAMINATION
// ============================================================================

/**
 * Verifies the vocabulary could have been fitted from train alone.
 *
 * Any vocabulary entry that no train record produces must have come from somewhere
 * else, which means a non-train partition informed the feature space.
 */
export function auditVocabularyContamination(input: AuditInput): AuditFinding[] {
  const trainNames = new Set<string>();
  for (const record of input.records) {
    if (record.partition !== "train") {
      continue;
    }
    const projection = projectPrimaryFeatures(
      record.observation.semantics,
      input.vocabulary,
      input.policy,
    );
    if (!projection.ok) {
      // Not reported here: `auditFeatureVectorDuplicates` already raises
      // FEATURE_PROJECTION_FAILED as a blocker for every record in every partition, so
      // the failure cannot pass unnoticed, and emitting it twice would make one defect
      // look like two.
      continue;
    }
    for (const index of projection.projection.vector.indices) {
      for (const [name, idx] of input.vocabulary.entries) {
        if (idx === index) {
          trainNames.add(name);
          break;
        }
      }
    }
  }
  const orphans = [...input.vocabulary.entries.keys()].filter((name) => !trainNames.has(name));
  if (orphans.length === 0) {
    return [];
  }
  return [
    finding(
      "TRAIN_VOCABULARY_CONTAMINATED",
      "blocker",
      `${orphans.length} vocabulary entries are produced by no train record`,
    ),
  ];
}

// ============================================================================
// FEATURE-LABEL ASSOCIATION (DIAGNOSTIC)
// ============================================================================

/**
 * Mutual information between each feature's presence and the label.
 *
 * Diagnostic only. High association is expected and desirable in a semantic task:
 * "delete" SHOULD predict the delete class. This exists so a human can scan for a
 * feature whose association looks suspiciously like an identifier rather than a
 * word, not so a pipeline can claim causal leakage.
 */
export function computeFeatureLabelAssociation(
  input: AuditInput,
  topN = 15,
): readonly MutualInformationFinding[] {
  const labelled = input.records.filter((record) => record.oracle.classNumber !== null);
  const total = labelled.length;
  if (total === 0) {
    return [];
  }

  const indexToName = new Map<number, string>();
  for (const [name, index] of input.vocabulary.entries) {
    indexToName.set(index, name);
  }

  const classCounts = new Map<number, number>();
  const featurePresence = new Map<number, number>();
  const jointCounts = new Map<string, number>();
  const featureClasses = new Map<number, Set<number>>();

  for (const record of labelled) {
    const classNumber = record.oracle.classNumber as number;
    classCounts.set(classNumber, (classCounts.get(classNumber) ?? 0) + 1);
    const projection = projectPrimaryFeatures(
      record.observation.semantics,
      input.vocabulary,
      input.policy,
    );
    if (!projection.ok) {
      continue;
    }
    for (const index of projection.projection.vector.indices) {
      featurePresence.set(index, (featurePresence.get(index) ?? 0) + 1);
      const key = `${index}|${classNumber}`;
      jointCounts.set(key, (jointCounts.get(key) ?? 0) + 1);
      const classes = featureClasses.get(index);
      if (classes === undefined) {
        featureClasses.set(index, new Set([classNumber]));
      } else {
        classes.add(classNumber);
      }
    }
  }

  const results: MutualInformationFinding[] = [];
  for (const [index, presentCount] of featurePresence) {
    const pFeature = presentCount / total;
    let bits = 0;
    for (const [classNumber, classCount] of classCounts) {
      const pClass = classCount / total;
      for (const featureOn of [true, false]) {
        const joint = featureOn
          ? (jointCounts.get(`${index}|${classNumber}`) ?? 0) / total
          : (classCount - (jointCounts.get(`${index}|${classNumber}`) ?? 0)) / total;
        if (joint <= 0) {
          continue;
        }
        const pf = featureOn ? pFeature : 1 - pFeature;
        if (pf <= 0) {
          continue;
        }
        bits += joint * Math.log2(joint / (pf * pClass));
      }
    }
    const classes = [...(featureClasses.get(index) ?? new Set<number>())].sort((a, b) => a - b);
    results.push({
      featureName: indexToName.get(index) ?? `index:${index}`,
      bits,
      classNumbers: classes,
      perfectlyPredictive: classes.length === 1,
    });
  }

  results.sort((a, b) =>
    b.bits !== a.bits ? b.bits - a.bits : a.featureName.localeCompare(b.featureName, "en"),
  );
  return Object.freeze(results.slice(0, topN));
}

// ============================================================================
// FULL AUDIT
// ============================================================================

/** Runs every audit and returns one report. */
export function auditDataset(input: AuditInput): AuditReport {
  const findings: AuditFinding[] = [
    ...auditDuplicates(input.records),
    ...auditFeatureVectorDuplicates(input),
    ...auditPartitionIntegrity(input.records),
    ...auditPartitionFamilyAliasing(input.records),
    ...auditLineageClassCoherence(input.records),
    ...auditOracleProxies(input),
    ...auditOracleProxyText(input.records),
    ...auditCanonicalLabelInjection(input.records),
    ...auditVocabularyContamination(input),
    ...auditCategoricalTrainCoverage(input.records),
  ];

  const populated = new Set(input.records.map((record) => record.partition));
  for (const partition of [
    "train",
    "calibration",
    "policy-validation",
    "test-id",
    "test-ooa",
    "test-novelty",
  ] as const) {
    if (!populated.has(partition)) {
      findings.push(finding("PARTITION_EMPTY", "diagnostic", partition));
    }
  }

  return {
    findings: Object.freeze(findings),
    blockerCount: findings.filter((f) => f.severity === "blocker").length,
    diagnosticCount: findings.filter((f) => f.severity === "diagnostic").length,
    topAssociatedFeatures: computeFeatureLabelAssociation(input),
  };
}
