/**
 * FC-008 Sprint 1 — `UnderstandingResult`.
 *
 * Epistemic abstention and operational failure are STRUCTURALLY separate. An
 * operational crash is never represented as model uncertainty.
 *
 * - `hypothesis` : the system worked and committed to one supported tuple.
 * - `abstained`  : the system worked and declined to commit. EPISTEMIC.
 * - `failed`     : the system did not work. OPERATIONAL.
 *
 * Consequences of the split, which the Sprint 4 evaluator depends on:
 * coverage and selective-risk statistics are computed over `hypothesis` versus
 * `abstained` only. `failed` is reported separately as an engineering
 * reliability defect and is excluded from every research metric. A non-zero
 * `failed` rate in a final evaluation is a bug to fix, not a finding.
 */

import { type FailureDetail, createFailureDetail } from "./failure-detail.js";
import type { ActionHypothesis, ArtifactProvenance, InferenceDiagnostics } from "./hypothesis.js";
import type { ActionObservationId } from "./observation.js";
import type { RuntimeSupportDiagnostics } from "./support.js";

/** Exactly seven epistemic abstention reasons. */
export const EPISTEMIC_ABSTENTION_REASONS = Object.freeze([
  "LOW_CONFIDENCE",
  "AMBIGUOUS_ACTION",
  "NOVEL_OR_UNSUPPORTED_INPUT",
  "INSUFFICIENT_CONTEXT",
  "UNSUPPORTED_OBJECT",
  "PRIVACY_REDACTION_TOO_HIGH",
  "OBSERVATION_STALE",
] as const);
export type EpistemicAbstentionReason = (typeof EPISTEMIC_ABSTENTION_REASONS)[number];

/** Exactly five operational failure codes. */
export const OPERATIONAL_FAILURE_CODES = Object.freeze([
  "SCHEMA_INVALID",
  "MODEL_UNAVAILABLE",
  "MODEL_TIMEOUT",
  "MODEL_VERSION_MISMATCH",
  "INTERNAL_ERROR",
] as const);
export type OperationalFailureCode = (typeof OPERATIONAL_FAILURE_CODES)[number];

export const UNDERSTANDING_OUTCOMES = Object.freeze(["hypothesis", "abstained", "failed"] as const);
export type UnderstandingOutcome = (typeof UNDERSTANDING_OUTCOMES)[number];

export interface HypothesisResult {
  readonly outcome: "hypothesis";
  readonly hypothesis: ActionHypothesis;
  /** Populated only in explicit local research mode. */
  readonly diagnostics: InferenceDiagnostics | null;
}

export interface AbstainedResult {
  readonly outcome: "abstained";
  readonly reason: EpistemicAbstentionReason;
  readonly observationId: ActionObservationId | null;
  readonly inputFingerprint: string | null;
  readonly support: RuntimeSupportDiagnostics | null;
  readonly provenance: ArtifactProvenance | null;
  readonly diagnostics: InferenceDiagnostics | null;
}

export interface FailedResult {
  readonly outcome: "failed";
  readonly code: OperationalFailureCode;
  readonly observationId: ActionObservationId | null;
  /**
   * Closed categorical detail. See `failure-detail.ts`: there is no free-text
   * field, so no page-derived or model-derived string can leave through a
   * failure path.
   */
  readonly detail: FailureDetail;
}

export type UnderstandingResult = HypothesisResult | AbstainedResult | FailedResult;

const EPISTEMIC_SET = new Set<string>(EPISTEMIC_ABSTENTION_REASONS);
const OPERATIONAL_SET = new Set<string>(OPERATIONAL_FAILURE_CODES);

export function isHypothesisResult(result: UnderstandingResult): result is HypothesisResult {
  return result.outcome === "hypothesis";
}

export function isAbstainedResult(result: UnderstandingResult): result is AbstainedResult {
  return result.outcome === "abstained";
}

export function isFailedResult(result: UnderstandingResult): result is FailedResult {
  return result.outcome === "failed";
}

export function isEpistemicAbstentionReason(value: unknown): value is EpistemicAbstentionReason {
  return typeof value === "string" && EPISTEMIC_SET.has(value);
}

export function isOperationalFailureCode(value: unknown): value is OperationalFailureCode {
  return typeof value === "string" && OPERATIONAL_SET.has(value);
}

/**
 * True when the result participates in coverage and selective-risk statistics.
 *
 * Operational failures are excluded, so a crash can never be counted as the
 * model having declined to predict.
 */
export function participatesInSelectiveStatistics(result: UnderstandingResult): boolean {
  return result.outcome === "hypothesis" || result.outcome === "abstained";
}

/**
 * Exhaustiveness guard. Adding a fourth outcome without updating every consumer
 * becomes a compile error rather than a silent fall-through.
 */
export function assertUnreachableOutcome(value: never): never {
  throw new Error(`Unhandled UnderstandingResult outcome: ${JSON.stringify(value)}`);
}

export function createHypothesisResult(
  hypothesis: ActionHypothesis,
  diagnostics: InferenceDiagnostics | null = null,
): HypothesisResult {
  return Object.freeze({
    outcome: "hypothesis" as const,
    hypothesis,
    diagnostics: diagnostics === null ? null : Object.freeze({ ...diagnostics }),
  });
}

export interface AbstainedResultInput {
  readonly reason: EpistemicAbstentionReason;
  readonly observationId?: ActionObservationId | null;
  readonly inputFingerprint?: string | null;
  readonly support?: RuntimeSupportDiagnostics | null;
  readonly provenance?: ArtifactProvenance | null;
  readonly diagnostics?: InferenceDiagnostics | null;
}

export function createAbstainedResult(input: AbstainedResultInput): AbstainedResult {
  // Each nested record is detached and frozen here rather than trusted, so a
  // caller that retains a mutable reference cannot alter a published result.
  const support = input.support ?? null;
  const provenance = input.provenance ?? null;
  const diagnostics = input.diagnostics ?? null;
  return Object.freeze({
    outcome: "abstained" as const,
    reason: input.reason,
    observationId: input.observationId ?? null,
    inputFingerprint: input.inputFingerprint ?? null,
    support: support === null ? null : Object.freeze({ ...support }),
    provenance: provenance === null ? null : Object.freeze({ ...provenance }),
    diagnostics: diagnostics === null ? null : Object.freeze({ ...diagnostics }),
  });
}

export function createFailedResult(
  code: OperationalFailureCode,
  observationId: ActionObservationId | null,
  detail: FailureDetail,
): FailedResult {
  // Re-run the detail through its own constructor so a caller cannot hand in an
  // unvalidated or unfrozen object literal.
  return Object.freeze({
    outcome: "failed" as const,
    code,
    observationId,
    detail: createFailureDetail(detail.stage, detail.reason, detail.measurement),
  });
}
