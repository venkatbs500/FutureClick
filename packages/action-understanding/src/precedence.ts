/**
 * FC-008 Sprint 1 — frozen deterministic precedence ladder.
 *
 * The ladder is declared as DATA, not as nested conditionals, so that the order
 * is inspectable, testable step by step, and impossible to reorder accidentally
 * by editing control flow. `runtime.ts` walks this table in order and returns at
 * the first step whose condition holds.
 *
 * Phase semantics:
 * - `pre-inference`  evaluated before the provider is invoked.
 * - `post-inference` evaluated only after the provider has returned scores.
 * - `final`          the post-inference freshness replacement.
 *
 * Step 4 is reached "when encountered": a timeout or internal error can only win
 * at the moment it actually occurs. If an earlier pre-inference step short
 * circuits, the provider is never invoked and no timeout can be encountered.
 *
 * Step 13 replaces any UNPUBLISHED EPISTEMIC OR ACCEPTED result produced at or
 * after inference. It deliberately does NOT replace an operational failure:
 * reporting a crashed or timed-out model as stale input would hide an
 * engineering reliability defect behind an epistemic label.
 */

import type { EpistemicAbstentionReason, OperationalFailureCode } from "./result.js";

export type PrecedenceCategory = "operational" | "epistemic" | "accept";
export type PrecedencePhase = "pre-inference" | "post-inference" | "final";

export interface PrecedenceStep {
  readonly step: number;
  readonly category: PrecedenceCategory;
  readonly phase: PrecedencePhase;
  /** Operational codes this step can emit. Empty for epistemic and accept steps. */
  readonly operationalCodes: readonly OperationalFailureCode[];
  /** Epistemic reason this step can emit, when the step is epistemic. */
  readonly epistemicReason: EpistemicAbstentionReason | null;
  readonly condition: string;
}

function step(
  stepNumber: number,
  category: PrecedenceCategory,
  phase: PrecedencePhase,
  operationalCodes: readonly OperationalFailureCode[],
  epistemicReason: EpistemicAbstentionReason | null,
  condition: string,
): PrecedenceStep {
  return Object.freeze({
    step: stepNumber,
    category,
    phase,
    operationalCodes: Object.freeze([...operationalCodes]),
    epistemicReason,
    condition,
  });
}

export const FC008_PRECEDENCE: readonly PrecedenceStep[] = Object.freeze([
  step(
    1,
    "operational",
    "pre-inference",
    ["SCHEMA_INVALID"],
    null,
    "The observation failed fail-closed validation.",
  ),
  step(
    2,
    "operational",
    "pre-inference",
    ["MODEL_VERSION_MISMATCH"],
    null,
    "A declared support-matrix, feature-policy, or abstention-policy version does not match the runtime policy.",
  ),
  step(
    3,
    "operational",
    "pre-inference",
    ["MODEL_UNAVAILABLE"],
    null,
    "No validated model artifact is loaded, or the provider reports it is unavailable.",
  ),
  step(
    4,
    "operational",
    "post-inference",
    ["MODEL_TIMEOUT", "INTERNAL_ERROR"],
    null,
    "The provider timed out or raised an internal error, when encountered.",
  ),
  step(
    5,
    "epistemic",
    "pre-inference",
    [],
    "OBSERVATION_STALE",
    "The freshness binding is no longer current before inference begins.",
  ),
  step(
    6,
    "epistemic",
    "pre-inference",
    [],
    "PRIVACY_REDACTION_TOO_HIGH",
    "The retained sanitization ratio is below the policy minimum.",
  ),
  step(
    7,
    "epistemic",
    "pre-inference",
    [],
    "INSUFFICIENT_CONTEXT",
    "Required feature-group coverage is below the policy minimum, or minimum semantic evidence is absent.",
  ),
  step(
    8,
    "epistemic",
    "pre-inference",
    [],
    "UNSUPPORTED_OBJECT",
    "Object-kind evidence names only kinds outside the nine supported kinds.",
  ),
  step(
    9,
    "epistemic",
    "post-inference",
    [],
    "NOVEL_OR_UNSUPPORTED_INPUT",
    "A deterministic support check failed: unknown-token ratio exceeded, unknown categorical present, unsupported tuple, or schema mismatch.",
  ),
  step(
    10,
    "epistemic",
    "post-inference",
    [],
    "AMBIGUOUS_ACTION",
    "The gap between the top two calibrated probabilities is below the policy minimum.",
  ),
  step(
    11,
    "epistemic",
    "post-inference",
    [],
    "LOW_CONFIDENCE",
    "The top calibrated probability is below the policy minimum.",
  ),
  step(
    12,
    "accept",
    "post-inference",
    [],
    null,
    "All gates passed; a PREDICTED hypothesis is accepted.",
  ),
  step(
    13,
    "epistemic",
    "final",
    [],
    "OBSERVATION_STALE",
    "Post-inference freshness failed; any unpublished epistemic or accepted result is replaced. Operational failures are not replaced.",
  ),
]);

export const FC008_PRECEDENCE_STEP_COUNT = FC008_PRECEDENCE.length;

/** The step at which an operational code can be emitted. */
export function precedenceStepForOperationalCode(code: OperationalFailureCode): number {
  const found = FC008_PRECEDENCE.find((s) => s.operationalCodes.includes(code));
  return found === undefined ? -1 : found.step;
}

/**
 * The first step at which an epistemic reason can be emitted. `OBSERVATION_STALE`
 * appears at both step 5 and step 13, so the lower step is returned.
 */
export function precedenceStepForEpistemicReason(reason: EpistemicAbstentionReason): number {
  const found = FC008_PRECEDENCE.find((s) => s.epistemicReason === reason);
  return found === undefined ? -1 : found.step;
}
