/**
 * FC-008 Sprint 1 — frozen V1 learned support matrix.
 *
 * This is an ALLOWLISTED LEARNED SUBSET, not a new global taxonomy. The
 * canonical vocabulary in `@futureclick/action-schema` is unchanged: every verb
 * here is an existing `ActionVerb` and every object kind is an existing
 * `KnownEntityKind`.
 *
 * Invariants:
 * - Exactly 13 tuples, each unique.
 * - `unknown` is never a learned class and is never emitted.
 * - A combination outside this matrix abstains; it is never coerced to a
 *   neighbouring class.
 * - Alternatives on a hypothesis are themselves complete supported tuples.
 * - The actor is inherited from validated acquisition context, never predicted.
 * - Private object names (repository, file, folder, document, account,
 *   organisation, person) are never labels and never features.
 */

import {
  ACTION_VERBS,
  type ActionVerb,
  type EntityKind,
  KNOWN_ENTITY_KINDS,
} from "@futureclick/action-schema";

export const FC008_SUPPORT_MATRIX_VERSION = "1.0" as const;
export type Fc008SupportMatrixVersion = typeof FC008_SUPPORT_MATRIX_VERSION;

/**
 * Closed set of transition properties reachable through the support matrix.
 * Ten distinct properties across the thirteen tuples.
 */
export const SUPPORTED_TRANSITION_PROPERTIES = Object.freeze([
  "existence",
  "access",
  "name",
  "container",
  "visibility",
  "grant-state",
  "status",
  "installation",
  "delivery",
  "submission",
] as const);
export type SupportedTransitionProperty = (typeof SUPPORTED_TRANSITION_PROPERTIES)[number];

export interface SupportedTransition {
  readonly property: SupportedTransitionProperty;
  readonly from: string;
  readonly to: string;
}

/** A complete semantic tuple. Only values present in the matrix are valid. */
export interface SupportedTuple {
  readonly verb: ActionVerb;
  readonly objectKind: EntityKind;
  readonly transition: SupportedTransition;
}

/**
 * A matrix row.
 *
 * CLASS NUMBERING, stated once so it is never ambiguous again:
 *
 * - `classNumber` is the CANONICAL EXTERNAL identity, 1 through 13. Every
 *   document, report, dataset record, and oracle statement uses this.
 * - `classIndex` is the INTERNAL ARRAY POSITION, 0 through 12. Logit vectors,
 *   coefficient matrices, and array lookups use this.
 * - The relationship is exactly `classNumber === classIndex + 1`.
 *
 * There is no such thing as "class 0". Index 0 is class number 1.
 */
export interface SupportMatrixEntry {
  /** Canonical external class number, 1 through 13. */
  readonly classNumber: number;
  /** Internal zero-based array position, 0 through 12. */
  readonly classIndex: number;
  readonly tuple: SupportedTuple;
}

function entry(
  classIndex: number,
  verb: ActionVerb,
  objectKind: EntityKind,
  property: SupportedTransitionProperty,
  from: string,
  to: string,
): SupportMatrixEntry {
  return Object.freeze({
    classNumber: classIndex + 1,
    classIndex,
    tuple: Object.freeze({
      verb,
      objectKind,
      transition: Object.freeze({ property, from, to }),
    }),
  });
}

/**
 * The frozen matrix. Order is the permanent model class ordering and must never
 * be changed without a new matrix version and a new model artifact.
 */
export const FC008_SUPPORT_MATRIX: readonly SupportMatrixEntry[] = Object.freeze([
  entry(0, "delete", "file", "existence", "present", "absent"),
  entry(1, "delete", "document", "existence", "present", "absent"),
  entry(2, "share", "file", "access", "private", "shared"),
  entry(3, "share", "document", "access", "private", "shared"),
  entry(4, "rename", "file", "name", "current", "replaced"),
  entry(5, "move", "file", "container", "source", "destination"),
  entry(6, "move", "folder", "container", "source", "destination"),
  entry(7, "change-access", "repository", "visibility", "private", "public"),
  entry(8, "grant", "permission", "grant-state", "absent", "granted"),
  entry(9, "subscribe", "subscription", "status", "inactive", "active"),
  entry(10, "install", "application", "installation", "absent", "installed"),
  entry(11, "send", "message", "delivery", "draft", "sent"),
  entry(12, "submit", "form", "submission", "ready", "submitted"),
]);

export const FC008_SUPPORTED_TUPLE_COUNT = FC008_SUPPORT_MATRIX.length;

/**
 * The least specific class: `submit / form`.
 *
 * Assigned only when submission itself is the supported semantic action and no
 * class 1..12 transition is established. See `FC008_SPECIFICITY_ORACLE_RULE`.
 */
export const FC008_LEAST_SPECIFIC_CLASS_NUMBER = 13;

/** Array position of the least specific class. Equals its number minus one. */
export const FC008_LEAST_SPECIFIC_CLASS_INDEX = FC008_LEAST_SPECIFIC_CLASS_NUMBER - 1;

/** Converts a canonical class number (1..13) to an array index (0..12). */
export function classNumberToIndex(classNumber: number): number | undefined {
  if (
    !Number.isInteger(classNumber) ||
    classNumber < 1 ||
    classNumber > FC008_SUPPORTED_TUPLE_COUNT
  ) {
    return undefined;
  }
  return classNumber - 1;
}

/** Converts an array index (0..12) to a canonical class number (1..13). */
export function classIndexToNumber(classIndex: number): number | undefined {
  if (
    !Number.isInteger(classIndex) ||
    classIndex < 0 ||
    classIndex >= FC008_SUPPORTED_TUPLE_COUNT
  ) {
    return undefined;
  }
  return classIndex + 1;
}

/** Looks up a row by its canonical external class number, 1 through 13. */
export function getSupportMatrixEntryByClassNumber(
  classNumber: number,
): SupportMatrixEntry | undefined {
  const index = classNumberToIndex(classNumber);
  return index === undefined ? undefined : FC008_SUPPORT_MATRIX[index];
}

/** Distinct verbs reachable through the matrix, in first-appearance order. */
export const FC008_MATRIX_VERBS: readonly ActionVerb[] = Object.freeze(
  Array.from(new Set(FC008_SUPPORT_MATRIX.map((e) => e.tuple.verb))),
);

/** Distinct object kinds reachable through the matrix, in first-appearance order. */
export const FC008_MATRIX_OBJECT_KINDS: readonly EntityKind[] = Object.freeze(
  Array.from(new Set(FC008_SUPPORT_MATRIX.map((e) => e.tuple.objectKind))),
);

/** Distinct transition properties reachable through the matrix. */
export const FC008_MATRIX_TRANSITION_PROPERTIES: readonly SupportedTransitionProperty[] =
  Object.freeze(Array.from(new Set(FC008_SUPPORT_MATRIX.map((e) => e.tuple.transition.property))));

/** Factorized head sizes, derived from the matrix rather than hard-coded. */
export const FC008_MATRIX_VERB_COUNT = FC008_MATRIX_VERBS.length;
export const FC008_MATRIX_OBJECT_KIND_COUNT = FC008_MATRIX_OBJECT_KINDS.length;
export const FC008_MATRIX_TRANSITION_PROPERTY_COUNT = FC008_MATRIX_TRANSITION_PROPERTIES.length;

/**
 * Injective, self-delimiting key for a supported tuple. Length-prefixed so that
 * no combination of field values can produce a colliding key.
 */
export function supportedTupleKey(tuple: SupportedTuple): string {
  const parts = [
    tuple.verb,
    tuple.objectKind,
    tuple.transition.property,
    tuple.transition.from,
    tuple.transition.to,
  ];
  return parts.map((p) => `${p.length}:${p}`).join("|");
}

const ENTRY_BY_VERB_OBJECT: ReadonlyMap<string, SupportMatrixEntry> = new Map(
  FC008_SUPPORT_MATRIX.map((e) => [
    `${e.tuple.verb.length}:${e.tuple.verb}/${e.tuple.objectKind}`,
    e,
  ]),
);

const ENTRY_BY_TUPLE_KEY: ReadonlyMap<string, SupportMatrixEntry> = new Map(
  FC008_SUPPORT_MATRIX.map((e) => [supportedTupleKey(e.tuple), e]),
);

/** Returns the matrix entry for a class index, or undefined when out of range. */
export function getSupportMatrixEntry(classIndex: number): SupportMatrixEntry | undefined {
  if (!Number.isInteger(classIndex)) {
    return undefined;
  }
  return FC008_SUPPORT_MATRIX[classIndex];
}

/**
 * Resolves the single supported tuple for a (verb, objectKind) pair.
 *
 * Under matrix version 1.0 the pair is unique across all thirteen rows, so the
 * transition is fully determined by the pair. This is asserted by
 * `verifySupportMatrixIntegrity` and is a material input to RQ1 interpretation:
 * the factorized transition head carries no information beyond verb and object
 * on the supported set.
 */
export function findSupportMatrixEntry(
  verb: string,
  objectKind: string,
): SupportMatrixEntry | undefined {
  return ENTRY_BY_VERB_OBJECT.get(`${verb.length}:${verb}/${objectKind}`);
}

/** True when the value is structurally and semantically a supported tuple. */
export function isSupportedTuple(value: unknown): value is SupportedTuple {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    readonly verb?: unknown;
    readonly objectKind?: unknown;
    readonly transition?: unknown;
  };
  if (typeof candidate.verb !== "string" || typeof candidate.objectKind !== "string") {
    return false;
  }
  const transition = candidate.transition;
  if (typeof transition !== "object" || transition === null) {
    return false;
  }
  const t = transition as {
    readonly property?: unknown;
    readonly from?: unknown;
    readonly to?: unknown;
  };
  if (typeof t.property !== "string" || typeof t.from !== "string" || typeof t.to !== "string") {
    return false;
  }
  const key = supportedTupleKey({
    verb: candidate.verb as ActionVerb,
    objectKind: candidate.objectKind as EntityKind,
    transition: {
      property: t.property as SupportedTransitionProperty,
      from: t.from,
      to: t.to,
    },
  });
  return ENTRY_BY_TUPLE_KEY.has(key);
}

/** Returns the canonical frozen tuple instance equal to the candidate, if any. */
export function resolveSupportedTuple(value: unknown): SupportedTuple | undefined {
  if (!isSupportedTuple(value)) {
    return undefined;
  }
  return ENTRY_BY_TUPLE_KEY.get(supportedTupleKey(value))?.tuple;
}

export interface SupportMatrixIntegrityIssue {
  readonly code: string;
  readonly message: string;
}

/**
 * Verifies the matrix against the canonical schema vocabulary and against its
 * own structural invariants. Called by tests rather than at module load so that
 * importing this module can never throw.
 */
export function verifySupportMatrixIntegrity(): readonly SupportMatrixIntegrityIssue[] {
  const issues: SupportMatrixIntegrityIssue[] = [];
  const validVerbs = new Set<string>(ACTION_VERBS);
  const validKinds = new Set<string>(KNOWN_ENTITY_KINDS);
  const validProperties = new Set<string>(SUPPORTED_TRANSITION_PROPERTIES);

  if (FC008_SUPPORT_MATRIX.length !== 13) {
    issues.push({
      code: "MATRIX_SIZE",
      message: `Support matrix must contain exactly 13 tuples, found ${FC008_SUPPORT_MATRIX.length}.`,
    });
  }

  const seenTupleKeys = new Set<string>();
  const seenVerbObject = new Set<string>();

  for (let i = 0; i < FC008_SUPPORT_MATRIX.length; i++) {
    const row = FC008_SUPPORT_MATRIX[i];
    if (row === undefined) {
      issues.push({ code: "MATRIX_HOLE", message: `Support matrix index ${i} is absent.` });
      continue;
    }
    const { classIndex, tuple } = row;

    if (row.classNumber !== i + 1) {
      issues.push({
        code: "CLASS_NUMBER_MISMATCH",
        message: `Row ${i} declares classNumber ${row.classNumber}; expected ${i + 1}.`,
      });
    }
    if (classIndex !== i) {
      issues.push({
        code: "CLASS_INDEX_MISMATCH",
        message: `Row ${i} declares classIndex ${classIndex}.`,
      });
    }
    if (!validVerbs.has(tuple.verb)) {
      issues.push({
        code: "UNKNOWN_VERB",
        message: `Verb "${tuple.verb}" is not a canonical ActionVerb.`,
      });
    }
    if (tuple.verb === "unknown") {
      issues.push({
        code: "UNKNOWN_IS_NOT_LEARNED",
        message: 'Verb "unknown" must never be a learned class.',
      });
    }
    if (!validKinds.has(tuple.objectKind)) {
      issues.push({
        code: "UNKNOWN_OBJECT_KIND",
        message: `Object kind "${tuple.objectKind}" is not a canonical KnownEntityKind.`,
      });
    }
    if (tuple.objectKind === "other") {
      issues.push({
        code: "OTHER_IS_NOT_LEARNED",
        message: 'Object kind "other" must never be a learned class.',
      });
    }
    if (!validProperties.has(tuple.transition.property)) {
      issues.push({
        code: "UNKNOWN_TRANSITION_PROPERTY",
        message: `Transition property "${tuple.transition.property}" is not declared.`,
      });
    }
    if (tuple.transition.from === tuple.transition.to) {
      issues.push({
        code: "DEGENERATE_TRANSITION",
        message: `Row ${i} transition does not change state.`,
      });
    }

    const tupleKey = supportedTupleKey(tuple);
    if (seenTupleKeys.has(tupleKey)) {
      issues.push({ code: "DUPLICATE_TUPLE", message: `Duplicate tuple at row ${i}.` });
    }
    seenTupleKeys.add(tupleKey);

    const verbObject = `${tuple.verb}/${tuple.objectKind}`;
    if (seenVerbObject.has(verbObject)) {
      issues.push({
        code: "AMBIGUOUS_VERB_OBJECT",
        message: `Pair "${verbObject}" appears more than once, so transition is not determined by verb and object.`,
      });
    }
    seenVerbObject.add(verbObject);
  }

  if (FC008_MATRIX_VERB_COUNT !== 10) {
    issues.push({
      code: "VERB_ROW_COUNT",
      message: `Factorized verb head must have 10 rows, found ${FC008_MATRIX_VERBS.length}.`,
    });
  }
  if (FC008_MATRIX_OBJECT_KIND_COUNT !== 9) {
    issues.push({
      code: "OBJECT_ROW_COUNT",
      message: `Factorized object head must have 9 rows, found ${FC008_MATRIX_OBJECT_KINDS.length}.`,
    });
  }
  if (FC008_MATRIX_TRANSITION_PROPERTY_COUNT !== 10) {
    issues.push({
      code: "TRANSITION_ROW_COUNT",
      message: `Factorized transition head must have 10 rows, found ${FC008_MATRIX_TRANSITION_PROPERTIES.length}.`,
    });
  }

  return issues;
}

/**
 * Frozen specificity oracle rule.
 *
 * Sprint 1 does NOT implement the dataset oracle. This constant exists so the
 * Sprint 2 oracle, dataset validation, and ambiguity-rejection tests all bind to
 * one authoritative statement of the rule rather than reimplementing it.
 */
export const FC008_SPECIFICITY_ORACLE_RULE_VERSION = "1.0" as const;

export const FC008_SPECIFICITY_ORACLE_RULE: readonly string[] = Object.freeze([
  "Ground truth describes the intended semantic state transition, not the UI mechanism used to invoke it.",
  "Determine which supported tuples are established by the fixture's authoritative scenario specification.",
  "If exactly one supported domain-specific tuple among classes 1..12 is established, assign that tuple even if the browser mechanism is form submission.",
  "Assign class 13 (submit/form/submission ready->submitted) only when submission itself is the supported semantic action and no class 1..12 transition is established.",
  "If more than one equally specific class 1..12 tuple applies and the fixture does not identify one primary transition, reject the sample as ambiguous rather than choosing arbitrarily.",
  "Scenario and oracle metadata remain separate from the sanitized observation and from feature projection.",
  "The resolved oracle class, fixture identifier, generator identifier, deterministic rule result, and any direct proxy for them must never enter model features.",
]);

/**
 * Canonical worked example of the rule. A GitHub repository visibility change is
 * invoked by a form submission but its ground truth is the specific access
 * transition, not the generic submission class.
 */
export const FC008_SPECIFICITY_ORACLE_EXAMPLE = Object.freeze({
  scenario: "repository visibility private to public, invoked via form submission",
  /** Canonical external class number. change-access / repository / visibility. */
  correctClassNumber: 8,
  /** Array position of the correct class. Equals correctClassNumber minus one. */
  correctClassIndex: 7,
  /** The generic submission class, which must NOT be assigned here. */
  incorrectClassNumber: FC008_LEAST_SPECIFIC_CLASS_NUMBER,
  incorrectClassIndex: FC008_LEAST_SPECIFIC_CLASS_INDEX,
  reason:
    "A class 1..12 transition (change-access/repository) is established, so the specific tuple wins over class 13 submit/form.",
} as const);
