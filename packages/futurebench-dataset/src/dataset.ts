/**
 * Dataset assembly: scenarios in, audited records plus a fitted vocabulary out.
 *
 * THE ORDER OF THIS PIPELINE IS THE ARCHITECTURE
 *
 *   1. partition        — before anything is fitted or measured
 *   2. extract          — surface only; the oracle is not in scope
 *   3. sanitize         — inside extraction, before any fingerprint
 *   4. validate         — through the Sprint-1 validator, not a second path
 *   5. resolve oracle   — intent only; the surface is not in scope
 *   6. build records    — oracle held outside the observation
 *   7. fit vocabulary   — train partition only, enforced by type
 *   8. audit            — leakage, duplication, circularity
 *
 * Steps 2 and 5 read disjoint halves of the scenario and neither can name the
 * other's input, so "the extractor cannot see the label" is a property of the
 * signatures rather than of this comment.
 *
 * SYNTHETIC BY CONSTRUCTION
 *
 * Everything produced here is synthetic. It supports claims about whether the
 * pipeline behaves correctly and about relative behaviour across controlled
 * variation. It is NOT evidence about real-world user accuracy, and every record
 * carries `provenanceClass: "synthetic-by-construction"` so no consumer can lose
 * track of that.
 */

import {
  FC008_DATASET_PARTITIONS,
  FC008_FEATURE_POLICY,
  FC008_FEATURE_POLICY_VERSION,
  FC008_SUPPORT_MATRIX_VERSION,
  type ActionObservation,
  type Fc008DatasetPartition,
  type FeatureVocabulary,
  FC008_EXTRACTOR_ID,
  FC008_EXTRACTOR_VERSION,
  buildObservationFromSurface,
  validateActionObservation,
} from "@futureclick/action-understanding";
import { TEXT_SANITIZER_VERSION } from "@futureclick/privacy";
import { type AuditReport, auditDataset } from "./audit.js";
import { FC008_ORACLE_ID, FC008_ORACLE_VERSION, resolveOracleLabel } from "./oracle.js";
import {
  type PartitionPlanDiagnostics,
  planPartitions,
  verifyLineageClassCoherence,
} from "./partition.js";
import {
  type FutureBenchOracleSection,
  type FutureBenchRecord,
  buildFutureBenchRecord,
} from "./record.js";
import type { ApplicationFamily, ScenarioSpecification } from "./scenario.js";
import {
  DEFAULT_VOCABULARY_FIT_OPTIONS,
  type VocabularyFitOptions,
  fitFeatureVocabulary,
  openTrainOnlyCorpus,
} from "./vocabulary.js";

export const FUTUREBENCH_DATASET_VERSION = "fb-ds-1-0";
/**
 * Generator version.
 *
 * Hyphen-separated rather than dotted because this value is carried in Layer C,
 * whose opaque-identifier grammar admits no dots. Keeping one spelling everywhere
 * avoids a version string that validates in the manifest and fails in the
 * observation.
 */
export const FUTUREBENCH_GENERATOR_VERSION = "fb-gen-1-0";

/** Why one scenario produced no record. Counted, never silently ignored. */
export const SCENARIO_SKIPS = Object.freeze([
  "extraction-refused",
  "observation-invalid",
  "record-refused",
] as const);
export type ScenarioSkip = (typeof SCENARIO_SKIPS)[number];

export interface SkippedScenario {
  readonly scenarioId: string;
  readonly skip: ScenarioSkip;
  readonly detail: string;
}

export interface BuildDatasetInput {
  readonly families: readonly ApplicationFamily[];
  readonly outOfApplicationFamilyIds: readonly string[];
  readonly vocabularyOptions?: VocabularyFitOptions;
}

export interface DatasetBuildDiagnostics {
  readonly partitioning: PartitionPlanDiagnostics;
  readonly recordCount: number;
  readonly skipped: readonly SkippedScenario[];
  readonly vocabularySize: number;
  readonly perClassCounts: readonly { classNumber: number; count: number }[];
  /**
   * Which application families occur in each partition.
   *
   * Reported because family/partition aliasing was a real defect that no existing
   * diagnostic made visible: every count looked correct while train and calibration
   * were entirely one family and policy-validation and test-ID entirely the other.
   */
  readonly perPartitionFamilies: readonly {
    partition: Fc008DatasetPartition;
    applicationFamilyIds: readonly string[];
  }[];
  readonly lineageCoherenceProblems: readonly string[];
  readonly rejectedByOracleCount: number;
}

/** Families present in each partition, sorted, for the diagnostics block. */
function summarizeFamiliesByPartition(
  records: readonly FutureBenchRecord[],
): { partition: Fc008DatasetPartition; applicationFamilyIds: readonly string[] }[] {
  const byPartition = new Map<Fc008DatasetPartition, Set<string>>();
  for (const record of records) {
    const bucket = byPartition.get(record.partition);
    if (bucket === undefined) {
      byPartition.set(record.partition, new Set([record.lineage.applicationFamilyId]));
    } else {
      bucket.add(record.lineage.applicationFamilyId);
    }
  }
  return FC008_DATASET_PARTITIONS.filter((partition) => byPartition.has(partition)).map(
    (partition) => ({
      partition,
      applicationFamilyIds: Object.freeze([...(byPartition.get(partition) ?? [])].sort()),
    }),
  );
}

/**
 * An audit report that has been checked to contain no blockers.
 *
 * The brand is phantom — it exists only in the type system — so the only way to hold
 * one is to go through `assertNoBlockers`. A plain `AuditReport` can be constructed
 * anywhere; this cannot.
 */
export type CleanAuditReport = AuditReport & { readonly __noBlockers: unique symbol };

/** Narrows a report to `CleanAuditReport`, or null when any blocker is present. */
function assertNoBlockers(report: AuditReport): CleanAuditReport | null {
  // The count is recomputed from the findings rather than trusted, so a report whose
  // own `blockerCount` disagreed with its findings could not talk its way through.
  const blockers = report.findings.filter((entry) => entry.severity === "blocker");
  if (blockers.length > 0 || report.blockerCount > 0) {
    return null;
  }
  return report as CleanAuditReport;
}

/**
 * The outcome of a dataset build.
 *
 * THE SUCCESS BRANCH CANNOT CARRY AUDIT BLOCKERS
 *
 * `ok: true` now requires `CleanAuditReport`, which only `assertNoBlockers` produces.
 * The previous shape returned `ok: true` with the audit report attached and left the
 * blocker decision to the caller, on the reasoning that whether a blocker is
 * acceptable is a research judgement. That reasoning was wrong in a specific way: it
 * made the safe path the one requiring extra vigilance. A caller checking `if
 * (!built.ok) return` — the obvious, idiomatic check — would sail past a corpus with
 * lineage leakage and treat it as validated.
 *
 * The failure branch still carries the full report, so a blocked build remains
 * diagnosable. What it does not carry is the records, because a leakage-invalid corpus
 * must not be reachable through a branch a reader scans as success.
 *
 * Deliberately NOT done: filtering offending records and returning success. The
 * offending record is evidence of a construction defect, and quietly deleting it
 * produces a clean-looking corpus built by a process still capable of the same fault.
 */
export type DatasetBuildResult =
  | {
      readonly ok: true;
      readonly records: readonly FutureBenchRecord[];
      readonly vocabulary: FeatureVocabulary;
      readonly audit: CleanAuditReport;
      readonly diagnostics: DatasetBuildDiagnostics;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly detail: string;
      /** Present when the build got far enough to audit. Null when it refused earlier. */
      readonly audit: AuditReport | null;
      /** Present alongside a failing audit, for inspection only. Never validated. */
      readonly diagnostics: DatasetBuildDiagnostics | null;
    };

/** Bounded summary of why scenarios dropped out, for a refusal detail. */
function summarizeSkips(
  skipped: readonly SkippedScenario[],
  offendingPartitions: readonly string[],
): string {
  const counts = new Map<string, number>();
  for (const entry of skipped) {
    const key = `${entry.skip}:${entry.detail}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, count]) => `${key}x${count}`);
  if (offendingPartitions.length > 0) {
    parts.push(`offending=${[...offendingPartitions].sort().join("|")}`);
  }
  return parts.join(" ");
}

/** Deterministic observation id. Opaque and non-semantic by construction. */
function observationId(scenario: ScenarioSpecification, sequence: number): string {
  return `obs-${scenario.scenarioId}-${String(sequence).padStart(4, "0")}`;
}

/** Oracle section for one scenario, read from the authored intent only. */
function oracleSection(scenario: ScenarioSpecification): FutureBenchOracleSection {
  const resolution = resolveOracleLabel(scenario.intent);
  if (resolution.disposition === "resolved") {
    const tuple = resolution.entry.tuple;
    return {
      oracleId: FC008_ORACLE_ID,
      oracleVersion: FC008_ORACLE_VERSION,
      classNumber: resolution.classNumber,
      supportedTuple: {
        verb: tuple.verb,
        objectKind: tuple.objectKind,
        property: tuple.transition.property,
        from: tuple.transition.from,
        to: tuple.transition.to,
      },
      disposition: "resolved",
      reason: resolution.basis,
    };
  }
  return {
    oracleId: FC008_ORACLE_ID,
    oracleVersion: FC008_ORACLE_VERSION,
    classNumber: null,
    supportedTuple: null,
    disposition: "rejected",
    reason: resolution.rejection,
  };
}

/**
 * Builds the dataset, or refuses.
 *
 * FAILS CLOSED ON AUDIT BLOCKERS. Any blocker finding makes this return `ok: false`
 * with `reason: "audit-blockers-present"`, and the caller does not get the choice:
 * there is no branch on which a blocker-bearing corpus is reachable as a validated
 * dataset, because `ok: true` requires a `CleanAuditReport` that only
 * `assertNoBlockers` can produce. Offending records are never silently dropped
 * either — that would hide the very problem the audit exists to surface.
 *
 * Diagnostics stay fully inspectable on both branches. `diagnostics` and the audit
 * report are attached to the refusal as well as to the success, so a failed build can
 * be understood without re-running it; the distinction is that a blocker ends the
 * build while a diagnostic is reported and the build continues.
 *
 * An earlier version returned the report alongside the records and left the decision
 * to the caller, on the reasoning that whether a blocker is acceptable is a research
 * judgement. That made the safe path the one requiring extra vigilance, so a caller
 * writing the idiomatic `if (!result.ok) return` got the unsafe behaviour by default.
 */
export function buildDataset(input: BuildDatasetInput): DatasetBuildResult {
  const plan = planPartitions({
    families: input.families,
    outOfApplicationFamilyIds: input.outOfApplicationFamilyIds,
  });
  if (!plan.ok) {
    return { ok: false, reason: plan.refusal, detail: plan.detail, audit: null, diagnostics: null };
  }

  const records: FutureBenchRecord[] = [];
  const skipped: SkippedScenario[] = [];
  const observations: { partition: Fc008DatasetPartition; observation: ActionObservation }[] = [];

  for (const [sequence, assignment] of plan.assignments.entries()) {
    const { scenario, partition } = assignment;

    // ---- EXTRACT (surface only) -----------------------------------------
    const assembled = buildObservationFromSurface({
      surface: scenario.surface,
      acquisition: {
        actor: { kind: "human" },
        platform: "web",
        environmentKind: "browser",
        localeTag: "en-US",
        topFrame: true,
        acquisitionAuthorized: true,
      },
      benchmark: {
        applicationFamilyId: scenario.applicationFamilyId,
        templateLineageId: scenario.templateLineageId,
        wordingVariantId: scenario.wordingVariantId,
        layoutVariantId: scenario.layoutVariantId,
        scenarioId: scenario.scenarioId,
        generatorVersion: FUTUREBENCH_GENERATOR_VERSION,
      },
      freshness: {
        epoch: 1,
        observationSequence: sequence + 1,
        // A fixed capture instant: a real timestamp would make the dataset hash
        // change on every build, and capture time is not research content.
        capturedAt: "2026-01-01T00:00:00.000Z" as ActionObservation["freshness"]["capturedAt"],
        featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
        supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
        abstentionPolicyVersion: "1.0",
      },
      observationId: observationId(scenario, sequence + 1),
    });
    if (!assembled.ok) {
      skipped.push({
        scenarioId: scenario.scenarioId,
        skip: "extraction-refused",
        detail: assembled.refusal,
      });
      continue;
    }

    // ---- VALIDATE through the Sprint-1 validator ------------------------
    const validated = validateActionObservation(assembled.observation);
    if (!validated.valid) {
      skipped.push({
        scenarioId: scenario.scenarioId,
        skip: "observation-invalid",
        detail: validated.issues.map((issue) => issue.code).join(","),
      });
      continue;
    }

    // ---- ORACLE (intent only) -------------------------------------------
    const built = buildFutureBenchRecord({
      recordId: `rec-${scenario.scenarioId}`,
      observation: validated.value,
      oracle: oracleSection(scenario),
      benchmark: {
        datasetVersion: FUTUREBENCH_DATASET_VERSION,
        generatorVersion: FUTUREBENCH_GENERATOR_VERSION,
        extractorId: FC008_EXTRACTOR_ID,
        extractorVersion: FC008_EXTRACTOR_VERSION,
        sanitizerVersion: TEXT_SANITIZER_VERSION,
        supportMatrixVersion: FC008_SUPPORT_MATRIX_VERSION,
        featurePolicyVersion: FC008_FEATURE_POLICY_VERSION,
        provenanceClass: "synthetic-by-construction",
      },
      partition,
      lineage: {
        applicationFamilyId: scenario.applicationFamilyId,
        templateLineageId: scenario.templateLineageId,
        parentLineageId: scenario.parentLineageId,
        scenarioId: scenario.scenarioId,
        wordingVariantId: scenario.wordingVariantId,
        layoutVariantId: scenario.layoutVariantId,
        variantKind: scenario.variantKind,
      },
      consequence: scenario.consequence,
    });
    if (!built.ok) {
      skipped.push({
        scenarioId: scenario.scenarioId,
        skip: "record-refused",
        detail: `${built.refusal}:${built.detail}`,
      });
      continue;
    }
    records.push(built.record);
    observations.push({ partition, observation: validated.value });
  }

  // ---- FIT VOCABULARY FROM TRAIN ONLY -----------------------------------
  const trainSamples = observations
    .filter((entry) => entry.partition === "train")
    .map((entry) => ({ partition: entry.partition, semantics: entry.observation.semantics }));
  const corpus = openTrainOnlyCorpus(trainSamples);
  if (!corpus.ok) {
    // The skip tally goes in the detail because an empty train corpus is almost
    // always a symptom: scenarios were refused upstream and the first visible
    // consequence is that there is nothing to fit. Reporting only "empty-corpus"
    // would send a reader looking in the wrong place.
    return {
      ok: false,
      reason: corpus.reason,
      detail: summarizeSkips(skipped, corpus.offendingPartitions),
      audit: null,
      diagnostics: null,
    };
  }
  const fitted = fitFeatureVocabulary(
    corpus.corpus,
    input.vocabularyOptions ?? DEFAULT_VOCABULARY_FIT_OPTIONS,
  );
  if (!fitted.ok) {
    return {
      ok: false,
      reason: fitted.reason,
      detail: "vocabulary fit refused",
      audit: null,
      diagnostics: null,
    };
  }

  // ---- AUDIT ------------------------------------------------------------
  const audit = auditDataset({
    records,
    vocabulary: fitted.vocabulary,
    policy: FC008_FEATURE_POLICY,
  });

  // Lineage/class coherence over the SCENARIO specifications, which is where an
  // authoring mistake originates and where the message can name it usefully. The
  // record-level equivalent runs inside `auditDataset`; this one sees the authored
  // intent directly, so it catches a lineage whose variants disagree even when no
  // record was built from the offending variant.
  const coherenceProblems = verifyLineageClassCoherence(
    plan.assignments.map((assignment) => assignment.scenario),
  );

  const perClass = new Map<number, number>();
  let rejected = 0;
  for (const record of records) {
    if (record.oracle.classNumber === null) {
      rejected += 1;
      continue;
    }
    perClass.set(record.oracle.classNumber, (perClass.get(record.oracle.classNumber) ?? 0) + 1);
  }

  const diagnostics: DatasetBuildDiagnostics = {
    partitioning: plan.diagnostics,
    recordCount: records.length,
    skipped: Object.freeze(skipped),
    vocabularySize: fitted.vocabulary.size,
    perClassCounts: Object.freeze(
      [...perClass.entries()]
        .sort(([a], [b]) => a - b)
        .map(([classNumber, count]) => ({ classNumber, count })),
    ),
    perPartitionFamilies: Object.freeze(summarizeFamiliesByPartition(records)),
    lineageCoherenceProblems: Object.freeze([...coherenceProblems]),
    rejectedByOracleCount: rejected,
  };

  // ---- FAIL CLOSED ------------------------------------------------------
  if (coherenceProblems.length > 0) {
    return {
      ok: false,
      reason: "lineage-class-incoherent",
      detail: coherenceProblems.slice(0, 8).join(" "),
      audit,
      diagnostics,
    };
  }
  const clean = assertNoBlockers(audit);
  if (clean === null) {
    // The reason names the audit codes rather than a count, so a blocked build is
    // actionable from the return value alone without re-running anything.
    const codes = [
      ...new Set(
        audit.findings.filter((entry) => entry.severity === "blocker").map((entry) => entry.code),
      ),
    ].sort();
    return {
      ok: false,
      reason: "audit-blockers-present",
      detail: `${audit.blockerCount} blockers: ${codes.join(", ")}`,
      audit,
      diagnostics,
    };
  }

  return {
    ok: true,
    records: Object.freeze(records),
    vocabulary: fitted.vocabulary,
    audit: clean,
    diagnostics,
  };
}
