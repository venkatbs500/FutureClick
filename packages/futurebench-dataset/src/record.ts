/**
 * The versioned FutureBench record.
 *
 * SEPARATION IS THE WHOLE DESIGN
 *
 * A record has five sections that never merge:
 *
 *   A `observation` — the sanitized `ActionObservation`. The only model input.
 *   B `oracle`      — ground truth. Outside the observation, always.
 *   C `benchmark`   — research metadata and provenance.
 *   D `partition`   — split identity.
 *   E `lineage`     — application family, template lineage, variant ancestry.
 *   F `consequence` — reversibility/risk, present only when scenario-authored.
 *
 * Sections B through F are siblings of the observation, not fields inside it.
 * That matters because the projector's parameter is `observation.semantics`: there
 * is no path from the projector's input up to the record, so the oracle label,
 * the partition, and the lineage identifiers are unreachable rather than merely
 * unused. Nesting the oracle inside the observation would make the entire
 * structural isolation argument collapse into a naming convention.
 *
 * SIZE
 *
 * The canonical form is capped at `maxBenchmarkRecordBytes` (16 KB). Exceeding it
 * is a refusal, not a truncation: a silently shortened record would produce a
 * dataset hash that does not describe the data anyone actually has.
 */

import {
  FC008_SAFETY_CAPS,
  type Fc008DatasetPartition,
  type ActionObservation,
} from "@futureclick/action-understanding";
import { canonicalByteLength, canonicalJson, canonicalSha256 } from "./canonical.js";
import type { AuthoredConsequenceAnnotation, VariantKind } from "./scenario.js";

export const FUTUREBENCH_RECORD_SCHEMA_VERSION = "1.0";

/** Section B. Ground truth, held outside the observation. */
export interface FutureBenchOracleSection {
  readonly oracleId: string;
  readonly oracleVersion: string;
  /** Canonical class number 1..13, or null when the oracle declined. */
  readonly classNumber: number | null;
  readonly supportedTuple: {
    readonly verb: string;
    readonly objectKind: string;
    readonly property: string;
    readonly from: string;
    readonly to: string;
  } | null;
  /** `resolved` or `rejected`, mirroring the oracle's disposition. */
  readonly disposition: "resolved" | "rejected";
  /** Rejection reason, or the basis on which the label was assigned. */
  readonly reason: string;
}

/** Section C. Research metadata. Never model input. */
export interface FutureBenchBenchmarkSection {
  readonly datasetVersion: string;
  readonly generatorVersion: string;
  readonly extractorId: string;
  readonly extractorVersion: string;
  readonly sanitizerVersion: string;
  readonly supportMatrixVersion: string;
  readonly featurePolicyVersion: string;
  /**
   * Explicit statement of what this data is.
   *
   * Carried in every record so that no downstream consumer can mistake a
   * synthetic corpus for evidence about real users.
   */
  readonly provenanceClass: "synthetic-by-construction";
}

/** Section E. Lineage and variant ancestry. */
export interface FutureBenchLineageSection {
  readonly applicationFamilyId: string;
  readonly templateLineageId: string;
  readonly parentLineageId: string;
  readonly scenarioId: string;
  readonly wordingVariantId: string;
  readonly layoutVariantId: string;
  readonly variantKind: VariantKind;
}

export interface FutureBenchRecord {
  readonly schemaVersion: string;
  readonly recordId: string;
  /** Section A. The sanitized observation. The only model input. */
  readonly observation: ActionObservation;
  /** Section B. */
  readonly oracle: FutureBenchOracleSection;
  /** Section C. */
  readonly benchmark: FutureBenchBenchmarkSection;
  /** Section D. */
  readonly partition: Fc008DatasetPartition;
  /** Section E. */
  readonly lineage: FutureBenchLineageSection;
  /** Section F. Null unless a scenario author explicitly stated it. */
  readonly consequence: AuthoredConsequenceAnnotation | null;
  /** SHA-256 over the canonical form of every section except this field. */
  readonly recordHash: string;
}

/** Top-level record keys, in canonical order. Referenced by the schema tests. */
export const FUTUREBENCH_RECORD_KEYS = Object.freeze([
  "schemaVersion",
  "recordId",
  "observation",
  "oracle",
  "benchmark",
  "partition",
  "lineage",
  "consequence",
  "recordHash",
] as const);

/**
 * Ground-truth keys, forbidden ANYWHERE inside section A.
 *
 * The one thing an observation must never contain is the answer. A refactor that
 * tucked the label next to the semantics for convenience would fail here rather
 * than ship, and no part of the observation — not even the metadata layer — is
 * exempt.
 */
export const OBSERVATION_FORBIDDEN_RECORD_KEYS = Object.freeze([
  "oracle",
  "classNumber",
  "label",
  "groundTruth",
  "deterministicRuleResult",
  "consequence",
  "reversibility",
  "riskBand",
  "recordId",
  "recordHash",
] as const);

/**
 * Identity keys, forbidden inside the SEMANTICS only.
 *
 * These are a different case from ground truth. Sprint 1 deliberately placed
 * benchmark identity in Layer C, because a dataset whose records cannot be traced
 * to the scenario that produced them is not auditable. The invariant is not that
 * identity is absent from the observation — it is that identity is absent from the
 * layer the model reads. Layer B is that layer, so the scope of this check is Layer
 * B, and the structural guarantee behind it is that `projectPrimaryFeatures` takes
 * `ObservationSemantics` and therefore cannot name Layer C at all.
 */
export const SEMANTICS_FORBIDDEN_IDENTITY_KEYS = Object.freeze([
  "applicationFamilyId",
  "templateLineageId",
  "parentLineageId",
  "scenarioId",
  "wordingVariantId",
  "layoutVariantId",
  "generatorVersion",
  "partition",
  "lineage",
  "fixtureId",
  "objectLabel",
] as const);

/**
 * The canonical record size cap.
 *
 * Derived from the Sprint-1 safety caps rather than restated, so there is exactly
 * one number and a later change to the frozen bound cannot leave this module
 * enforcing a stale one.
 */
export const MAX_CANONICAL_RECORD_BYTES = FC008_SAFETY_CAPS.maxBenchmarkRecordBytes;

export const RECORD_REFUSALS = Object.freeze([
  "canonical-size-exceeds-cap",
  "observation-contains-forbidden-key",
  "semantics-contains-identity-key",
] as const);
export type RecordRefusal = (typeof RECORD_REFUSALS)[number];

export type RecordBuildResult =
  | { readonly ok: true; readonly record: FutureBenchRecord; readonly canonicalBytes: number }
  | { readonly ok: false; readonly refusal: RecordRefusal; readonly detail: string };

const FORBIDDEN_OBSERVATION_KEYS = new Set<string>(OBSERVATION_FORBIDDEN_RECORD_KEYS);
const FORBIDDEN_SEMANTICS_KEYS = new Set<string>(SEMANTICS_FORBIDDEN_IDENTITY_KEYS);

/** Depth-bounded search for any of `forbidden` reachable from `value`. */
function findForbiddenKey(
  value: unknown,
  forbidden: ReadonlySet<string>,
  path: string,
  depth: number,
): string | null {
  if (depth > 12 || value === null || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findForbiddenKey(item, forbidden, `${path}[${index}]`, depth + 1);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.has(key)) {
      return `${path}.${key}`;
    }
    const found = findForbiddenKey(child, forbidden, `${path}.${key}`, depth + 1);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

export interface RecordBuildInput {
  readonly recordId: string;
  readonly observation: ActionObservation;
  readonly oracle: FutureBenchOracleSection;
  readonly benchmark: FutureBenchBenchmarkSection;
  readonly partition: Fc008DatasetPartition;
  readonly lineage: FutureBenchLineageSection;
  readonly consequence: AuthoredConsequenceAnnotation | null;
}

/**
 * Builds a record, hashes it, and enforces the size cap.
 *
 * The hash covers every section except `recordHash` itself, so it is reproducible
 * and a mutation anywhere in the record changes it.
 */
export function buildFutureBenchRecord(input: RecordBuildInput): RecordBuildResult {
  const groundTruthKey = findForbiddenKey(
    input.observation,
    FORBIDDEN_OBSERVATION_KEYS,
    "observation",
    0,
  );
  if (groundTruthKey !== null) {
    return {
      ok: false,
      refusal: "observation-contains-forbidden-key",
      detail: groundTruthKey,
    };
  }
  const identityKey = findForbiddenKey(
    input.observation.semantics,
    FORBIDDEN_SEMANTICS_KEYS,
    "observation.semantics",
    0,
  );
  if (identityKey !== null) {
    return {
      ok: false,
      refusal: "semantics-contains-identity-key",
      detail: identityKey,
    };
  }

  const hashable = {
    schemaVersion: FUTUREBENCH_RECORD_SCHEMA_VERSION,
    recordId: input.recordId,
    observation: JSON.parse(JSON.stringify(input.observation)) as unknown,
    oracle: input.oracle,
    benchmark: input.benchmark,
    partition: input.partition,
    lineage: input.lineage,
    consequence: input.consequence,
  };
  const recordHash = canonicalSha256(hashable);
  const record: FutureBenchRecord = Object.freeze({
    ...hashable,
    observation: input.observation,
    recordHash,
  }) as FutureBenchRecord;

  // Measured on the hashable projection so the number does not depend on whether
  // the observation happens to carry non-enumerable properties.
  const canonicalBytes = canonicalByteLength({ ...hashable, recordHash });
  if (canonicalBytes > MAX_CANONICAL_RECORD_BYTES) {
    return {
      ok: false,
      refusal: "canonical-size-exceeds-cap",
      detail: `${canonicalBytes} bytes exceeds ${MAX_CANONICAL_RECORD_BYTES}`,
    };
  }
  return { ok: true, record, canonicalBytes };
}

/**
 * The canonical text of a record.
 *
 * Exported so that duplicate detection and manifest hashing operate on exactly the
 * same bytes, rather than on two serializations that might differ.
 */
export function canonicalRecordText(record: FutureBenchRecord): string {
  return canonicalJson(JSON.parse(JSON.stringify(record)) as unknown);
}
