/**
 * FC-008 Sprint 1 — deterministic typed input fingerprint.
 *
 * The fingerprint is a canonical, self-delimiting, type-tagged encoding of
 * POST-SANITIZATION data only. It is computed over Layer A (acquisition context)
 * and Layer B (observation semantics).
 *
 * Deliberately EXCLUDED, by contract and by signature:
 * - raw platform state, DOM, HTML, selectors, screenshots
 * - Layer C benchmark metadata (application family, template lineage, scenario)
 * - Layer D ephemeral display context (object label, surface title)
 * - provenance, redaction counters, and identifiers
 *
 * Encoding properties:
 * - Every atom is type-tagged, so the number 1 and the string "1" never collide.
 * - Every variable-length atom is length-prefixed, so concatenation is
 *   unambiguous and no delimiter can be smuggled through a value.
 * - Encoding is positional over a fixed schema, so object key insertion order
 *   cannot change the result.
 * - Unordered collections are canonically sorted, so a permutation of the same
 *   semantic content yields the same fingerprint.
 */

import type { AcquisitionContext, ObservationSemantics, SemanticToken } from "./observation.js";

export const FC008_FINGERPRINT_VERSION = "FP1" as const;

/** Maximum encoded sequence length. Comfortably above the total-token cap. */
export const FP_MAX_SEQUENCE_LENGTH = 256;

/** Maximum UTF-16 code-unit length of any single encoded string atom. */
export const FP_MAX_STRING_UNITS = 1_024;

export type FingerprintResult =
  | { readonly ok: true; readonly fingerprint: string }
  | { readonly ok: false; readonly error: string };

type Atom = string | { readonly error: string };

function isAtomError(atom: Atom): atom is { readonly error: string } {
  return typeof atom !== "string";
}

function encodeString(value: string): Atom {
  if (typeof value !== "string") {
    return { error: "FP_STRING_TYPE" };
  }
  if (value.length > FP_MAX_STRING_UNITS) {
    return { error: "FP_STRING_OVERFLOW" };
  }
  return `S${value.length}:${value}`;
}

function encodeNumber(value: number): Atom {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: "FP_NUMBER_TYPE" };
  }
  return `N:${JSON.stringify(value)}`;
}

function encodeBool(value: boolean): Atom {
  if (typeof value !== "boolean") {
    return { error: "FP_BOOL_TYPE" };
  }
  return value ? "B1" : "B0";
}

function encodeSeq(parts: readonly Atom[]): Atom {
  if (parts.length > FP_MAX_SEQUENCE_LENGTH) {
    return { error: "FP_SEQ_OVERFLOW" };
  }
  const encoded: string[] = [];
  for (const part of parts) {
    if (isAtomError(part)) {
      return part;
    }
    encoded.push(part);
  }
  return `L${encoded.length}:${encoded.join("")}`;
}

/** Canonical ordering for the token bag: channel first, then value. */
function compareTokens(a: SemanticToken, b: SemanticToken): number {
  if (a.channel !== b.channel) {
    return a.channel < b.channel ? -1 : 1;
  }
  if (a.value === b.value) {
    return 0;
  }
  return a.value < b.value ? -1 : 1;
}

function compareStrings(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function encodeSemantics(semantics: ObservationSemantics): Atom {
  const tokens = [...semantics.tokens].sort(compareTokens);
  const tokenAtoms = tokens.map((t) => encodeSeq([encodeString(t.channel), encodeString(t.value)]));

  const stateTokens = [...semantics.stateTokens].sort(compareStrings);
  const objectKindEvidence = [...semantics.objectKindEvidence].sort(compareStrings);

  return encodeSeq([
    encodeString(semantics.semanticsVersion),
    encodeSeq(tokenAtoms),
    encodeString(semantics.controlKind),
    encodeString(semantics.controlRole),
    encodeString(semantics.interactionKind),
    encodeString(semantics.surfaceKind),
    encodeString(semantics.formMethod),
    encodeSeq(stateTokens.map(encodeString)),
    encodeSeq(objectKindEvidence.map(encodeString)),
    encodeBool(semantics.destructiveStyle),
    encodeSeq([
      encodeBool(semantics.missingness.accessibleNameMissing),
      encodeBool(semantics.missingness.headingsMissing),
      encodeBool(semantics.missingness.nearbyLabelsMissing),
      encodeBool(semantics.missingness.stateTokensMissing),
      encodeBool(semantics.missingness.objectKindEvidenceMissing),
      encodeBool(semantics.missingness.redactionApplied),
    ]),
    encodeSeq([
      encodeNumber(semantics.structuralCounts.headingCount),
      encodeNumber(semantics.structuralCounts.nearbyLabelCount),
      encodeNumber(semantics.structuralCounts.stateTokenCount),
      encodeNumber(semantics.structuralCounts.surfaceDepth),
      encodeNumber(semantics.structuralCounts.siblingControlCount),
    ]),
  ]);
}

function encodeAcquisition(acquisition: AcquisitionContext): Atom {
  return encodeSeq([
    encodeString(acquisition.actor.kind),
    encodeString(acquisition.platform),
    encodeString(acquisition.environmentKind),
    encodeString(acquisition.localeTag),
    encodeBool(acquisition.topFrame),
    encodeBool(acquisition.acquisitionAuthorized),
  ]);
}

/**
 * Computes the canonical input fingerprint for a validated observation.
 *
 * The signature accepts only Layer A and Layer B, so Layer C and Layer D cannot
 * be fingerprinted even by mistake.
 */
export function computeObservationInputFingerprint(
  semantics: ObservationSemantics,
  acquisition: AcquisitionContext,
): FingerprintResult {
  const encoded = encodeSeq([encodeSemantics(semantics), encodeAcquisition(acquisition)]);
  if (isAtomError(encoded)) {
    return { ok: false, error: encoded.error };
  }
  return { ok: true, fingerprint: `${FC008_FINGERPRINT_VERSION}|${encoded}` };
}
