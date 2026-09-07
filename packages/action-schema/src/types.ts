/**
 * Foundational provisional schema types for FutureClick pre-execution consequence evaluation.
 *
 * PROVISIONAL CONTRACT NOTICE:
 * These types establish initial structural boundaries for Sprint FC-001/FC-001A.
 * TypeScript structural typing does not by itself guarantee runtime semantic validity.
 * Cross-field semantic invariants and boundary validations will be progressively
 * introduced in subsequent domain-design sprints. External and untrusted inputs
 * will require explicit runtime validation at system boundaries.
 */

import type { Brand, IsoTimestamp } from "@futureclick/shared";

export type StateId = Brand<string, "StateId">;
export type ActionId = Brand<string, "ActionId">;
export type TargetId = Brand<string, "TargetId">;
export type ConsequenceId = Brand<string, "ConsequenceId">;
export type EvidenceId = Brand<string, "EvidenceId">;

export type SupportedPlatform = "macos" | "windows" | "browser" | "unknown";

/**
 * Snapshot of observed environment state prior to action execution.
 */
export interface EnvironmentState {
  readonly id: StateId;
  readonly timestamp: IsoTimestamp;
  readonly platform: SupportedPlatform;
  readonly applicationName: string;
  readonly windowTitle?: string;
}

export type ActionCategory =
  | "delete"
  | "share"
  | "submit"
  | "purchase"
  | "grant_permission"
  | "rename"
  | "move"
  | "modify_access"
  | "custom";

export interface ActionTarget {
  readonly id: TargetId;
  readonly kind: "button" | "file" | "link" | "permission_dialog" | "system_control" | "custom";
  readonly label?: string;
  readonly locator?: string;
}

/**
 * Represents the proposed digital action awaiting analysis.
 */
export interface ProposedAction {
  readonly id: ActionId;
  readonly category: ActionCategory;
  readonly target: ActionTarget;
  readonly timestamp: IsoTimestamp;
  readonly stateId: StateId;
}

export type ReversibilityLevel =
  | "fully_reversible"
  | "partially_reversible"
  | "irreversible"
  | "unknown";

/**
 * Branded numerical confidence score strictly bounded in [0.0, 1.0].
 */
export type ConfidenceScore = Brand<number, "ConfidenceScore">;

export type EvidenceSource =
  | "deterministic_rule"
  | "static_analysis"
  | "simulation"
  | "statistical_model"
  | "heuristic";

export interface EvidenceRecord {
  readonly id: EvidenceId;
  readonly source: EvidenceSource;
  readonly summary: string;
}

export interface PredictionProvenance {
  readonly engineVersion: string;
  readonly evaluationTimestamp: IsoTimestamp;
  readonly deterministic: boolean;
  readonly modelIdentifier?: string;
}

/**
 * Consequence classification:
 * - verified: deterministic derivation within defined assumptions/scope (not unconditional certainty)
 * - simulated: observed in an isolated/sandboxed execution context
 * - predicted: probabilistic statistical/model projection with explicit uncertainty
 */
export type ConsequenceKind = "verified" | "simulated" | "predicted";

export interface ActionConsequence {
  readonly id: ConsequenceId;
  readonly actionId: ActionId;
  readonly kind: ConsequenceKind;
  readonly summary: string;
  readonly reversibility: ReversibilityLevel;
  readonly confidence: ConfidenceScore;
  readonly evidence: readonly EvidenceRecord[];
  readonly provenance: PredictionProvenance;
}

/**
 * Validates whether a value is a valid numerical confidence score in [0.0, 1.0].
 * Disallows NaN, Infinity, -Infinity, negative numbers, and values > 1.0.
 */
export function isValidConfidenceScore(score: unknown): score is ConfidenceScore {
  return typeof score === "number" && Number.isFinite(score) && score >= 0.0 && score <= 1.0;
}

/**
 * Safely constructs a validated ConfidenceScore within [0.0, 1.0].
 * Throws RangeError on out-of-bounds, negative, or non-finite numbers.
 */
export function createConfidenceScore(score: number): ConfidenceScore {
  if (!isValidConfidenceScore(score)) {
    throw new RangeError(
      `Invalid confidence score: ${score}. Confidence must be a finite number between 0.0 and 1.0 inclusive.`,
    );
  }
  return score;
}
