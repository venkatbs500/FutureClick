/**
 * FC-008 Sprint 1 — frozen support-condition to outcome mapping.
 *
 * Every deterministic input-quality and support condition maps to exactly one
 * outcome, and the mapping is declared once, here, as data.
 *
 * The alternative — nine diagnostic codes plus condition checks scattered
 * through the runtime — leaves the mapping implicit in control flow. A code
 * could then be exported, never wired to an outcome, and silently do nothing,
 * or two conditions could drift onto different outcomes in different branches.
 * Declaring the table makes both failures visible: `verifyOutcomeMapping`
 * asserts that every code has exactly one entry and that every entry names a
 * member of the frozen result vocabularies.
 *
 * `runtime.ts` evaluates these conditions in precedence order and returns the
 * mapped outcome, so there is exactly one place where a condition becomes a
 * result.
 */

import type { AbstentionPolicy } from "./policy.js";
import type { ActionObservation } from "./observation.js";
import {
  EPISTEMIC_ABSTENTION_REASONS,
  type EpistemicAbstentionReason,
  OPERATIONAL_FAILURE_CODES,
  type OperationalFailureCode,
} from "./result.js";
import type { RuntimeSupportDiagnostics } from "./support.js";

/** The nine deterministic support and input-quality checks. */
export const SUPPORT_CHECK_CODES = Object.freeze([
  "SCHEMA_VERSION_MISMATCH",
  "FEATURE_POLICY_MISMATCH",
  "EXCESSIVE_PRIVACY_REDACTION",
  "MISSING_REQUIRED_FEATURE_GROUPS",
  "MISSING_MINIMUM_SEMANTIC_EVIDENCE",
  "UNSUPPORTED_OBJECT_KIND",
  "UNKNOWN_CATEGORICAL_TOKEN",
  "UNKNOWN_TOKEN_RATIO_EXCEEDED",
  "UNSUPPORTED_SEMANTIC_TUPLE",
] as const);
export type SupportCheckCode = (typeof SUPPORT_CHECK_CODES)[number];

/** Historical alias; the codes are support checks, not novelty scores. */
export const NOVELTY_CHECK_CODES = SUPPORT_CHECK_CODES;

export type SupportCheckOutcome =
  | { readonly category: "operational"; readonly code: OperationalFailureCode }
  | { readonly category: "epistemic"; readonly reason: EpistemicAbstentionReason };

export interface SupportCheckMapping {
  readonly code: SupportCheckCode;
  readonly outcome: SupportCheckOutcome;
  /** Precedence step at which this condition is evaluated. */
  readonly precedenceStep: number;
  readonly description: string;
}

function operational(code: OperationalFailureCode): SupportCheckOutcome {
  return Object.freeze({ category: "operational" as const, code });
}

function epistemic(reason: EpistemicAbstentionReason): SupportCheckOutcome {
  return Object.freeze({ category: "epistemic" as const, reason });
}

function mapping(
  code: SupportCheckCode,
  outcome: SupportCheckOutcome,
  precedenceStep: number,
  description: string,
): SupportCheckMapping {
  return Object.freeze({ code, outcome, precedenceStep, description });
}

/**
 * The frozen mapping. Order matches the precedence ladder, so evaluating this
 * table top to bottom is the same as walking the ladder.
 */
export const FC008_SUPPORT_OUTCOME_MAPPING: readonly SupportCheckMapping[] = Object.freeze([
  mapping(
    "SCHEMA_VERSION_MISMATCH",
    operational("SCHEMA_INVALID"),
    1,
    "The observation schema version is not the supported version.",
  ),
  mapping(
    "FEATURE_POLICY_MISMATCH",
    operational("MODEL_VERSION_MISMATCH"),
    2,
    "A feature-policy, support-matrix, abstention-policy, or model artifact version does not agree across the observation, policy, artifact, and calibration identity.",
  ),
  mapping(
    "EXCESSIVE_PRIVACY_REDACTION",
    epistemic("PRIVACY_REDACTION_TOO_HIGH"),
    6,
    "The retained sanitization ratio is below the policy minimum.",
  ),
  mapping(
    "MISSING_REQUIRED_FEATURE_GROUPS",
    epistemic("INSUFFICIENT_CONTEXT"),
    7,
    "Required feature-group coverage is below the policy minimum.",
  ),
  mapping(
    "MISSING_MINIMUM_SEMANTIC_EVIDENCE",
    epistemic("INSUFFICIENT_CONTEXT"),
    7,
    "Neither control text nor an accessible name is present.",
  ),
  mapping(
    "UNSUPPORTED_OBJECT_KIND",
    epistemic("UNSUPPORTED_OBJECT"),
    8,
    "Object-kind evidence names only kinds outside the nine supported kinds.",
  ),
  mapping(
    "UNKNOWN_CATEGORICAL_TOKEN",
    epistemic("NOVEL_OR_UNSUPPORTED_INPUT"),
    9,
    "At least one closed-grammar categorical resolved to the vocabulary escape hatch.",
  ),
  mapping(
    "UNKNOWN_TOKEN_RATIO_EXCEEDED",
    epistemic("NOVEL_OR_UNSUPPORTED_INPUT"),
    9,
    "The unknown-token ratio exceeds the policy maximum. Evaluated only when a fitted vocabulary is loaded.",
  ),
  mapping(
    "UNSUPPORTED_SEMANTIC_TUPLE",
    epistemic("NOVEL_OR_UNSUPPORTED_INPUT"),
    9,
    "The composed semantic tuple is not a member of the frozen support matrix.",
  ),
]);

const BY_CODE: ReadonlyMap<SupportCheckCode, SupportCheckMapping> = new Map(
  FC008_SUPPORT_OUTCOME_MAPPING.map((m) => [m.code, m] as const),
);

/** The outcome for one support check code. Never undefined for a valid code. */
export function outcomeForSupportCheck(code: SupportCheckCode): SupportCheckOutcome {
  const found = BY_CODE.get(code);
  if (found === undefined) {
    throw new Error(`Support check code "${code}" has no declared outcome.`);
  }
  return found.outcome;
}

/**
 * Structural self-check. Returns the list of problems, empty when the mapping
 * is internally consistent and total over the declared codes.
 */
export function verifyOutcomeMapping(): readonly string[] {
  const issues: string[] = [];
  const epistemicSet = new Set<string>(EPISTEMIC_ABSTENTION_REASONS);
  const operationalSet = new Set<string>(OPERATIONAL_FAILURE_CODES);

  if (FC008_SUPPORT_OUTCOME_MAPPING.length !== SUPPORT_CHECK_CODES.length) {
    issues.push("MAPPING_SIZE_MISMATCH");
  }
  for (const code of SUPPORT_CHECK_CODES) {
    const entries = FC008_SUPPORT_OUTCOME_MAPPING.filter((m) => m.code === code);
    if (entries.length !== 1) {
      issues.push(`CODE_NOT_MAPPED_EXACTLY_ONCE:${code}`);
    }
  }
  for (const entry of FC008_SUPPORT_OUTCOME_MAPPING) {
    if (entry.outcome.category === "operational") {
      if (!operationalSet.has(entry.outcome.code)) {
        issues.push(`UNKNOWN_OPERATIONAL_CODE:${entry.code}`);
      }
    } else if (!epistemicSet.has(entry.outcome.reason)) {
      issues.push(`UNKNOWN_EPISTEMIC_REASON:${entry.code}`);
    }
    if (!Number.isInteger(entry.precedenceStep) || entry.precedenceStep < 1) {
      issues.push(`INVALID_PRECEDENCE_STEP:${entry.code}`);
    }
    // A code with no predicate would be exported, mapped, and yet unable to
    // fire. That is exactly the silent gap this table exists to prevent.
    if (!SUPPORT_CHECK_PREDICATES.has(entry.code)) {
      issues.push(`CODE_HAS_NO_PREDICATE:${entry.code}`);
    }
  }
  return Object.freeze(issues);
}

/** Everything one support condition needs in order to be decided. */
export interface SupportCheckInputs {
  readonly observation: ActionObservation;
  readonly support: RuntimeSupportDiagnostics;
  readonly policy: AbstentionPolicy;
}

type SupportCheckPredicate = (inputs: SupportCheckInputs) => boolean;

/**
 * Whether each condition holds, declared once alongside the mapping so that a
 * condition and its outcome cannot drift apart.
 */
const SUPPORT_CHECK_PREDICATES: ReadonlyMap<SupportCheckCode, SupportCheckPredicate> = new Map<
  SupportCheckCode,
  SupportCheckPredicate
>([
  [
    "EXCESSIVE_PRIVACY_REDACTION",
    ({ observation, policy }) =>
      observation.redaction.retainedRatio < policy.minRetainedRedactionRatio,
  ],
  [
    "MISSING_REQUIRED_FEATURE_GROUPS",
    ({ support, policy }) => support.featureCoverage < policy.minFeatureCoverage,
  ],
  ["MISSING_MINIMUM_SEMANTIC_EVIDENCE", ({ support }) => !support.minimumSemanticEvidence],
  ["UNSUPPORTED_OBJECT_KIND", ({ support }) => !support.supportedObjectEvidence],
  ["UNKNOWN_CATEGORICAL_TOKEN", ({ support }) => support.unknownCategoricalCount > 0],
  [
    // Applied only when a fitted vocabulary made the ratio computable, so
    // Sprint 1 cannot report passing a check it is unable to perform.
    "UNKNOWN_TOKEN_RATIO_EXCEEDED",
    ({ support, policy }) =>
      support.unknownTokenRatioAvailable && support.unknownTokenRatio > policy.maxUnknownTokenRatio,
  ],
  ["UNSUPPORTED_SEMANTIC_TUPLE", ({ support }) => !support.supportedTupleResolved],
  ["FEATURE_POLICY_MISMATCH", ({ support }) => !support.schemaVersionsMatched],
  // Step 1 is decided by the observation validator before any support exists.
  ["SCHEMA_VERSION_MISMATCH", () => false],
]);

/** Phase in which a condition may be evaluated. Mirrors `FC008_PRECEDENCE`. */
export const PRE_INFERENCE_MAX_STEP = 8;

/**
 * Evaluates the support conditions in precedence order and returns the first
 * code that holds, or null when none does.
 *
 * `maxStep` bounds evaluation to one phase of the ladder. Pre-inference the
 * runtime passes `PRE_INFERENCE_MAX_STEP`, so step-9 conditions are not
 * consulted before the provider has run; post-inference it passes no bound.
 * This keeps the evaluated order identical to the declared phase semantics in
 * `FC008_PRECEDENCE` rather than quietly promoting a post-inference condition.
 */
export function firstFailingSupportCheck(
  observation: ActionObservation,
  support: RuntimeSupportDiagnostics,
  policy: AbstentionPolicy,
  maxStep: number = Number.POSITIVE_INFINITY,
): SupportCheckCode | null {
  const inputs: SupportCheckInputs = { observation, support, policy };
  for (const entry of FC008_SUPPORT_OUTCOME_MAPPING) {
    if (entry.precedenceStep > maxStep) {
      continue;
    }
    const predicate = SUPPORT_CHECK_PREDICATES.get(entry.code);
    if (predicate?.(inputs)) {
      return entry.code;
    }
  }
  return null;
}
