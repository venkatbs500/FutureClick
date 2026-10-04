/**
 * The frozen specificity oracle.
 *
 * Ground truth is the intended semantic STATE TRANSITION, not the UI mechanism
 * used to invoke it. The canonical case: a GitHub-style repository visibility
 * change is performed by submitting a form, and its label is class 8
 * (change-access / repository / visibility private->public), NOT class 13
 * (submit / form). Mechanism is not meaning.
 *
 * ISOLATION
 *
 * `resolveOracleLabel` takes `AuthoredIntent` and nothing else. It cannot read the
 * surface, so it cannot be influenced by page text, and the extractor — which takes
 * only `RawSurface` — cannot read it back. The separation is enforced by the
 * parameter lists, not by discipline.
 *
 * The oracle implements `FC008_SPECIFICITY_ORACLE_RULE` from the frozen Sprint-1
 * support matrix. It does not restate those rules as new policy; it executes them.
 */

import {
  FC008_LEAST_SPECIFIC_CLASS_NUMBER,
  FC008_SPECIFICITY_ORACLE_RULE_VERSION,
  findSupportMatrixEntry,
} from "@futureclick/action-understanding";
import type { SupportMatrixEntry } from "@futureclick/action-understanding";
import type { AuthoredIntent, AuthoredTransition } from "./scenario.js";

export const FC008_ORACLE_ID = "fc008-specificity-oracle";
export const FC008_ORACLE_VERSION = FC008_SPECIFICITY_ORACLE_RULE_VERSION;

/** Why the oracle declined to assign a label. */
export const ORACLE_REJECTIONS = Object.freeze([
  "ambiguous-equally-specific-transitions",
  "no-supported-transition-established",
  "primary-transition-index-invalid",
  "submission-claimed-with-specific-transition",
] as const);
export type OracleRejection = (typeof ORACLE_REJECTIONS)[number];

export type OracleResolution =
  | {
      readonly disposition: "resolved";
      /** Canonical external class number, 1 through 13. */
      readonly classNumber: number;
      readonly entry: SupportMatrixEntry;
      /** Which rule produced the label. Audit trail, not model input. */
      readonly basis:
        | "sole-specific-transition"
        | "designated-primary-transition"
        | "submission-is-the-action";
    }
  | {
      readonly disposition: "rejected";
      readonly rejection: OracleRejection;
      /** Class numbers that competed, for human triage. Never model input. */
      readonly competingClassNumbers: readonly number[];
    };

/**
 * Resolves one authored transition against the frozen support matrix.
 *
 * The verb/object lookup is only the first half. The authored property and endpoints
 * are then compared field by field, so a scenario that claims
 * `delete/file/existence: absent -> present` matches nothing instead of silently
 * collecting class 1. An author who states the transition backwards has made a
 * mistake, and the oracle's job is to decline rather than to guess the intent.
 */
function matchTransition(transition: AuthoredTransition): SupportMatrixEntry | undefined {
  const entry = findSupportMatrixEntry(transition.verb, transition.objectKind);
  if (entry === undefined) {
    return undefined;
  }
  const matrixTransition = entry.tuple.transition;
  const exact =
    matrixTransition.property === transition.property &&
    matrixTransition.from === transition.from &&
    matrixTransition.to === transition.to;
  return exact ? entry : undefined;
}

/**
 * Assigns ground truth from the authoritative scenario specification.
 *
 * Rule order matters and follows the frozen rule list exactly: specific classes
 * 1..12 are considered first, class 13 only when no specific transition exists, and
 * ambiguity is rejected rather than resolved by preference.
 */
export function resolveOracleLabel(intent: AuthoredIntent): OracleResolution {
  // A designated primary index is validated whenever it is present, not only when
  // it is needed to break a tie. The field exists solely to name one of the
  // established transitions, so an index that addresses none of them is an
  // incoherent specification. Ignoring it when it happens to be unnecessary would
  // let an author's off-by-one sit undetected until the day a second transition is
  // added and the wrong one is suddenly authoritative.
  if (intent.primaryTransitionIndex !== null) {
    const index = intent.primaryTransitionIndex;
    if (!Number.isInteger(index) || index < 0 || index >= intent.establishedTransitions.length) {
      return {
        disposition: "rejected",
        rejection: "primary-transition-index-invalid",
        competingClassNumbers: [],
      };
    }
  }

  const matched: { index: number; entry: SupportMatrixEntry }[] = [];
  for (const [index, transition] of intent.establishedTransitions.entries()) {
    const entry = matchTransition(transition);
    if (entry !== undefined) {
      matched.push({ index, entry });
    }
  }

  // Classes 1..12 are the specific ones. Class 13 is the generic submission class
  // and is never allowed to win on specificity.
  const specific = matched.filter(
    (candidate) => candidate.entry.classNumber !== FC008_LEAST_SPECIFIC_CLASS_NUMBER,
  );
  const distinctSpecificClasses = [
    ...new Set(specific.map((candidate) => candidate.entry.classNumber)),
  ].sort((a, b) => a - b);

  if (specific.length > 0) {
    // A scenario claiming submission IS the action while also establishing a
    // specific transition contradicts itself. Silently preferring one reading
    // would bury an authoring error in the labels.
    if (intent.submissionIsTheAction) {
      return {
        disposition: "rejected",
        rejection: "submission-claimed-with-specific-transition",
        competingClassNumbers: distinctSpecificClasses,
      };
    }

    if (distinctSpecificClasses.length === 1) {
      const sole = specific[0] as { index: number; entry: SupportMatrixEntry };
      return {
        disposition: "resolved",
        classNumber: sole.entry.classNumber,
        entry: sole.entry,
        basis: "sole-specific-transition",
      };
    }

    // More than one equally specific class applies. Only an explicitly designated
    // primary transition can break the tie.
    if (intent.primaryTransitionIndex === null) {
      return {
        disposition: "rejected",
        rejection: "ambiguous-equally-specific-transitions",
        competingClassNumbers: distinctSpecificClasses,
      };
    }
    const designated = specific.find(
      (candidate) => candidate.index === intent.primaryTransitionIndex,
    );
    if (designated === undefined) {
      // The designated index points at nothing specific, so it cannot disambiguate.
      return {
        disposition: "rejected",
        rejection: "primary-transition-index-invalid",
        competingClassNumbers: distinctSpecificClasses,
      };
    }
    return {
      disposition: "resolved",
      classNumber: designated.entry.classNumber,
      entry: designated.entry,
      basis: "designated-primary-transition",
    };
  }

  // No specific transition. Class 13 applies only if submission itself is the
  // semantic action AND the matrix agrees that submission is established.
  const submission = matched.find(
    (candidate) => candidate.entry.classNumber === FC008_LEAST_SPECIFIC_CLASS_NUMBER,
  );
  if (intent.submissionIsTheAction && submission !== undefined) {
    return {
      disposition: "resolved",
      classNumber: submission.entry.classNumber,
      entry: submission.entry,
      basis: "submission-is-the-action",
    };
  }

  return {
    disposition: "rejected",
    rejection: "no-supported-transition-established",
    competingClassNumbers: [],
  };
}

/**
 * Names this oracle must never be able to see.
 *
 * Asserted structurally by the isolation tests: the oracle's parameter type has no
 * path to any of these, so an authored surface cannot influence its own label.
 */
export const ORACLE_FORBIDDEN_INPUTS = Object.freeze([
  "surface",
  "candidates",
  "headings",
  "ownText",
  "accessibleName",
  "nearbyLabels",
  "partition",
  "semantics",
  "tokens",
] as const);
