/**
 * Synthetic scenario specification.
 *
 * THE CENTRAL SEPARATION
 *
 * A scenario carries two independent descriptions of the same situation:
 *
 *   `intent`  — the authoritative semantic specification. ORACLE INPUT ONLY.
 *   `surface` — the authored user interface.             EXTRACTOR INPUT ONLY.
 *
 * Nothing reads both. `resolveOracleLabel(intent)` cannot name `surface`, and
 * `extractObservationSemantics(surface)` cannot name `intent`, because neither
 * appears in the other's parameter list. That is the same signature-level trick
 * Sprint 1 used to keep Layer C away from the projector, and it is why "the
 * extractor cannot reach ground truth" is a property of the type system rather
 * than a rule reviewers have to remember.
 *
 * ANTI-CIRCULARITY
 *
 * The surface must be authored as human-style product UI, independently of the
 * class it happens to establish. Rendering the canonical tuple into button text
 * ("change-access repository visibility private public") would make the task
 * trivial and the benchmark meaningless; the audit in `audit.ts` searches for
 * exactly that and treats it as a blocker. No function in this package maps a
 * class to display text.
 */

import type { EntityKind } from "@futureclick/action-schema";
import type { Fc008DatasetPartition, RawSurface } from "@futureclick/action-understanding";

/** One semantic state transition the scenario specification establishes. */
export interface AuthoredTransition {
  readonly verb: string;
  readonly objectKind: EntityKind;
  readonly property: string;
  readonly from: string;
  readonly to: string;
}

/**
 * The authoritative semantic specification. Read by the oracle, by nothing else.
 *
 * `primaryTransition` exists so that a scenario establishing more than one
 * transition can name which one is primary. When it does not, the oracle rejects
 * the sample as ambiguous rather than picking arbitrarily — guessing would silently
 * manufacture ground truth.
 */
export interface AuthoredIntent {
  /** Every transition the specification establishes. May be empty. */
  readonly establishedTransitions: readonly AuthoredTransition[];
  /** Index into `establishedTransitions`, or null when none is designated. */
  readonly primaryTransitionIndex: number | null;
  /**
   * Whether submission itself is the semantic action.
   *
   * True only when the act of submitting is what the scenario is about. A
   * repository visibility change invoked BY a form submission sets this false: the
   * mechanism is submission, the action is the access change.
   */
  readonly submissionIsTheAction: boolean;
}

/**
 * Kinds of controlled variation within a lineage.
 *
 * None of these creates an independent lineage. A paraphrase of a scenario is the
 * same scenario, so it must never land in a different partition from its parent —
 * that is leakage wearing a different wording.
 */
export const VARIANT_KINDS = Object.freeze([
  "canonical",
  "wording",
  "layout",
  "nearby-distractor",
  "prompt-like-injection",
  "misleading-button-wording",
  "secret-like-text",
  "private-name-like-text",
  "reordered-controls",
  "missing-optional-context",
  "extra-irrelevant-context",
] as const);
export type VariantKind = (typeof VARIANT_KINDS)[number];

/**
 * Optional scenario-authored reversibility and risk annotation.
 *
 * Present ONLY when a scenario author explicitly stated it. It is research
 * metadata and never model input: it lives on the record, outside the sanitized
 * observation, so the projector cannot reach it.
 */
export interface AuthoredConsequenceAnnotation {
  readonly reversibility: "reversible" | "hard-to-reverse" | "irreversible";
  readonly riskBand: "low" | "medium" | "high";
  /** Free-form rationale kept for human review only. Never projected. */
  readonly rationale: string;
}

export interface ScenarioSpecification {
  readonly scenarioId: string;
  readonly applicationFamilyId: string;
  readonly templateLineageId: string;
  readonly wordingVariantId: string;
  readonly layoutVariantId: string;
  readonly variantKind: VariantKind;
  /**
   * The lineage this scenario descends from.
   *
   * Equals `templateLineageId` for a canonical scenario. Variants name their
   * parent, which is what lets the partitioner keep a whole variant family
   * together.
   */
  readonly parentLineageId: string;
  /** ORACLE INPUT. Never reaches extraction or projection. */
  readonly intent: AuthoredIntent;
  /** EXTRACTOR INPUT. Never reaches the oracle. */
  readonly surface: RawSurface;
  /** Research annotation, present only when explicitly authored. */
  readonly consequence: AuthoredConsequenceAnnotation | null;
  /**
   * Set when the scenario deliberately depicts a surface outside the supported
   * matrix, for the novelty partition, where abstention is the correct outcome.
   */
  readonly intendedForNovelty: boolean;
}

/** An application family: a coherent synthetic product environment. */
export interface ApplicationFamily {
  readonly applicationFamilyId: string;
  /** Human-readable product concept. Never projected. */
  readonly description: string;
  /**
   * How this family's UI conventions differ from the others.
   *
   * Recorded because independence is the claim that matters: two families that
   * differ only in colour or object names are one family with two themes, and the
   * out-of-application generalization measurement would be meaningless.
   */
  readonly independenceBasis: string;
  readonly scenarios: readonly ScenarioSpecification[];
}

/** A scenario paired with the partition it was assigned to. */
export interface PartitionedScenario {
  readonly scenario: ScenarioSpecification;
  readonly partition: Fc008DatasetPartition;
}
