/**
 * Bounded deterministic extraction (AI-4, AI-7, AI-15, AI-16, AI-22).
 *
 * Reduces a `RawSurface` to sanitized `ObservationSemantics`. Every cap comes
 * from the frozen `FC008_SAFETY_CAPS`; none is restated as a literal here.
 *
 * PIPELINE ORDER
 *
 * raw surface -> bounded extraction -> sanitizer -> sanitized semantics -> (caller)
 * fingerprint / projection / serialization / logging.
 *
 * The order is load-bearing, not stylistic. A fingerprint computed on raw
 * extracted text would be a durable derivative of unsanitized material that no
 * later redaction could undo. This module therefore never computes a fingerprint
 * and never logs; it returns sanitized semantics, and
 * `buildObservationFromSurface` is the only function that goes on to fingerprint,
 * so the ordering lives in code rather than in a convention a caller could forget.
 *
 * PAGE TEXT IS DATA
 *
 * Nothing in the extracted text can change how extraction behaves. There is no
 * directive, no escape, and no configuration channel reachable from surface
 * content: the caps are constants, the channel set is closed, and every string
 * follows the same path to the sanitizer. Text reading "ignore previous
 * instructions" is tokenized exactly like text reading "cancel".
 */

import type { EntityKind } from "@futureclick/action-schema";
import {
  type SanitizerFieldInput,
  type SanitizerRedactionReason,
  TEXT_SANITIZER_VERSION,
  sanitizeFields,
  truncateUtf8,
} from "@futureclick/privacy";
import { FC008_SAFETY_CAPS } from "./bounds.js";
import { computeObservationInputFingerprint } from "./fingerprint.js";
import type { FreshnessBinding } from "./freshness.js";
import {
  type AcquisitionContext,
  type BenchmarkMetadata,
  OBSERVATION_SEMANTICS_VERSION,
  type ObservationSemantics,
  type RedactionReport,
  STATE_TOKEN_REGEX,
  type SemanticToken,
  type TokenChannel,
} from "./observation.js";
import type { RawControlCandidate, RawSurface, RawTextSlot } from "./surface.js";
import { SUPPORTED_TRANSITION_PROPERTIES } from "./support-matrix.js";

/** Extractor identity, recorded in observation provenance. */
export const FC008_EXTRACTOR_ID = "fc008-bounded-surface-extractor";
export const FC008_EXTRACTOR_VERSION = "1.0";

/**
 * Channel fill order.
 *
 * The total-token budget is spent in this order so that the most semantically
 * load-bearing channels are never starved by a surface padded with nearby text.
 * A page cannot reorder this.
 */
export const CHANNEL_FILL_ORDER: readonly TokenChannel[] = Object.freeze([
  "ctl",
  "acc",
  "st",
  "hd",
  "nb",
] as const);

/** Why extraction refused to produce semantics at all. */
export const EXTRACTION_REFUSALS = Object.freeze([
  "no-candidate-controls",
  "target-index-out-of-range",
  "candidate-limit-exceeded",
  "no-retained-semantic-tokens",
  "fingerprint-unavailable",
] as const);
export type ExtractionRefusal = (typeof EXTRACTION_REFUSALS)[number];

export interface ExtractionDiagnostics {
  /** Candidate controls actually scanned, after the hard cap. */
  readonly scannedCandidateCount: number;
  /** Candidates present on the surface beyond the cap, which were not scanned. */
  readonly skippedCandidateCount: number;
  /** Headings dropped by the per-surface cap. */
  readonly skippedHeadingCount: number;
  /** Nearby labels dropped by the per-control cap. */
  readonly skippedNearbyLabelCount: number;
  /** State signals dropped by the cap or by failing the closed grammar. */
  readonly skippedStateSignalCount: number;
  /** Tokens dropped because a channel was full. */
  readonly channelOverflowTokenCount: number;
  /** Tokens dropped because the total budget was exhausted. */
  readonly totalBudgetOverflowTokenCount: number;
  /** Sanitizer reasons observed, closed categorical set. */
  readonly redactionReasons: readonly SanitizerRedactionReason[];
}

export type ExtractionResult =
  | {
      readonly ok: true;
      readonly semantics: ObservationSemantics;
      readonly redaction: RedactionReport;
      readonly diagnostics: ExtractionDiagnostics;
    }
  | { readonly ok: false; readonly refusal: ExtractionRefusal };

/** Truncates one raw slot to the label character cap before sanitization. */
function boundSlot(slot: RawTextSlot): SanitizerFieldInput {
  const byteBounded = truncateUtf8(slot.text, FC008_SAFETY_CAPS.maxStringUtf8Bytes);
  const charBounded = byteBounded.text.slice(0, FC008_SAFETY_CAPS.maxLabelChars);
  return { text: charBounded, disposition: slot.disposition };
}

interface ChannelPlan {
  readonly channel: TokenChannel;
  readonly slots: readonly RawTextSlot[];
}

/**
 * Collects the raw text destined for each channel, applying the structural caps
 * that bound HOW MUCH is read before any of it is sanitized.
 */
function planChannels(
  surface: RawSurface,
  target: RawControlCandidate,
): { plans: readonly ChannelPlan[]; skippedHeadings: number; skippedNearby: number } {
  const headings = surface.headings.slice(0, FC008_SAFETY_CAPS.maxHeadingsPerSurface);
  const nearby = target.nearbyLabels.slice(0, FC008_SAFETY_CAPS.maxNearbyLabels);
  return {
    plans: [
      { channel: "ctl", slots: [target.ownText] },
      { channel: "acc", slots: target.accessibleName === null ? [] : [target.accessibleName] },
      { channel: "hd", slots: headings },
      { channel: "nb", slots: nearby },
    ],
    skippedHeadings: surface.headings.length - headings.length,
    skippedNearby: target.nearbyLabels.length - nearby.length,
  };
}

/** Closed set of frozen transition properties, for state-signal admission. */
const ALLOWED_STATE_PROPERTIES: ReadonlySet<string> = new Set<string>(
  SUPPORTED_TRANSITION_PROPERTIES,
);

/**
 * Builds the state channel.
 *
 * State tokens are `property:value` over the FROZEN transition properties, so a
 * surface cannot introduce a new state namespace. A signal naming an unknown
 * property is skipped rather than coerced into a neighbouring one.
 */
function buildStateTokens(surface: RawSurface): { tokens: readonly string[]; skipped: number } {
  const tokens: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const signal of surface.stateSignals) {
    if (tokens.length >= FC008_SAFETY_CAPS.maxStateTokens) {
      skipped += 1;
      continue;
    }
    if (!ALLOWED_STATE_PROPERTIES.has(signal.property)) {
      skipped += 1;
      continue;
    }
    const candidate = `${signal.property}:${signal.value}`;
    if (!STATE_TOKEN_REGEX.test(candidate) || seen.has(candidate)) {
      skipped += 1;
      continue;
    }
    seen.add(candidate);
    tokens.push(candidate);
  }
  return { tokens, skipped };
}

/**
 * Extracts sanitized Layer B semantics from an inert surface snapshot.
 *
 * Returns semantics and the redaction report together: a caller cannot obtain the
 * semantics without also receiving the evidence of what sanitization cost, which
 * is what lets the runtime later make a deterministic
 * `EXCESSIVE_PRIVACY_REDACTION` decision.
 */
export function extractObservationSemantics(surface: RawSurface): ExtractionResult {
  if (surface.candidates.length === 0) {
    return { ok: false, refusal: "no-candidate-controls" };
  }
  if (
    !Number.isInteger(surface.targetIndex) ||
    surface.targetIndex < 0 ||
    surface.targetIndex >= surface.candidates.length
  ) {
    return { ok: false, refusal: "target-index-out-of-range" };
  }

  // The scan cap bounds work before anything is read, and the target must fall
  // inside the scanned window: a target beyond the cap was never scanned, so
  // silently extracting it would misreport what the scan actually covered.
  const scanned = surface.candidates.slice(0, FC008_SAFETY_CAPS.maxCandidateControlsPerScan);
  if (surface.targetIndex >= scanned.length) {
    return { ok: false, refusal: "candidate-limit-exceeded" };
  }
  const target = scanned[surface.targetIndex] as RawControlCandidate;

  const { plans, skippedHeadings, skippedNearby } = planChannels(surface, target);

  // ---- SANITIZE -----------------------------------------------------------
  // One batched call over every text slot, so the report aggregates the whole
  // surface rather than per-channel fragments. Nothing below this line sees a raw
  // string: `sanitized.fields` is positionally aligned with `flatSlots`.
  const flatSlots: { channel: TokenChannel; input: SanitizerFieldInput }[] = [];
  for (const plan of plans) {
    for (const slot of plan.slots) {
      flatSlots.push({ channel: plan.channel, input: boundSlot(slot) });
    }
  }
  const sanitized = sanitizeFields(
    flatSlots.map((entry) => entry.input),
    {
      maxStringUtf8Bytes: FC008_SAFETY_CAPS.maxStringUtf8Bytes,
      maxTokens: FC008_SAFETY_CAPS.maxTokensPerChannel,
    },
  );

  const state = buildStateTokens(surface);

  // ---- ASSEMBLE CHANNELS --------------------------------------------------
  const perChannel = new Map<TokenChannel, string[]>();
  for (const channel of CHANNEL_FILL_ORDER) {
    perChannel.set(channel, []);
  }

  // The state channel and the state-token list are deliberately different shapes.
  //
  // `stateTokens` keeps the property-scoped `property:value` form, which is what the
  // projector needs in order to tell `access:private` from `visibility:private`. The
  // `st` CHANNEL cannot carry that form, because every entry in `tokens` must match
  // the normalized token grammar and that grammar has no colon in it.
  //
  // So the channel carries the VALUE segment only, and specifically NOT the property
  // name. Emitting the property would scatter the canonical transition vocabulary —
  // "existence", "container", "visibility" — into free text, which is the exact
  // shape of generator self-leakage the dataset audits look for, and it would buy
  // nothing: the scoped state token already encodes the property unambiguously.
  const stateChannelTokens: string[] = [];
  const seenStateValues = new Set<string>();
  for (const stateToken of state.tokens) {
    const match = STATE_TOKEN_REGEX.exec(stateToken);
    const value = match?.[2];
    if (value === undefined || seenStateValues.has(value)) {
      continue;
    }
    if (stateChannelTokens.length >= FC008_SAFETY_CAPS.maxTokensPerChannel) {
      break;
    }
    seenStateValues.add(value);
    stateChannelTokens.push(value);
  }
  perChannel.set("st", stateChannelTokens);

  let channelOverflow = 0;
  const seenPerChannel = new Map<TokenChannel, Set<string>>();
  for (const channel of CHANNEL_FILL_ORDER) {
    seenPerChannel.set(channel, new Set<string>());
  }
  for (const [index, entry] of flatSlots.entries()) {
    const field = sanitized.fields[index];
    if (field === undefined) {
      continue;
    }
    const bucket = perChannel.get(entry.channel) as string[];
    const seen = seenPerChannel.get(entry.channel) as Set<string>;
    for (const token of field.tokens) {
      if (seen.has(token)) {
        continue;
      }
      if (bucket.length >= FC008_SAFETY_CAPS.maxTokensPerChannel) {
        channelOverflow += 1;
        continue;
      }
      seen.add(token);
      bucket.push(token);
    }
  }

  // ---- SPEND THE TOTAL BUDGET IN CHANNEL PRIORITY ORDER -------------------
  const tokens: SemanticToken[] = [];
  let totalOverflow = 0;
  for (const channel of CHANNEL_FILL_ORDER) {
    for (const value of perChannel.get(channel) ?? []) {
      if (tokens.length >= FC008_SAFETY_CAPS.maxTotalTokens) {
        totalOverflow += 1;
        continue;
      }
      tokens.push({ channel, value });
    }
  }

  const objectKindEvidence: readonly EntityKind[] = surface.objectKindEvidence.slice(
    0,
    FC008_SAFETY_CAPS.maxObjectKindEvidence,
  );

  const retainedStateTokens = state.tokens;

  // `headingCount` and `nearbyLabelCount` count FIELDS, not tokens. Their Sprint-1
  // bounds are 8 and 12 — the structural caps on how many headings and nearby
  // labels may be read — whereas a single heading can legitimately normalize to
  // several tokens under the 64-per-channel token cap. Counting tokens here would
  // report 19 nearby labels for a surface that has three, and the validator would
  // reject semantics that are in fact within every bound.
  let headingFieldCount = 0;
  let nearbyFieldCount = 0;
  for (const [index, entry] of flatSlots.entries()) {
    const field = sanitized.fields[index];
    if (field === undefined || field.tokens.length === 0) {
      continue;
    }
    if (entry.channel === "hd") {
      headingFieldCount += 1;
    } else if (entry.channel === "nb") {
      nearbyFieldCount += 1;
    }
  }

  const headingTokens = perChannel.get("hd") ?? [];
  const nearbyTokens = perChannel.get("nb") ?? [];
  const accessibleTokens = perChannel.get("acc") ?? [];

  if (tokens.length === 0) {
    // Everything was redacted or dropped. Emitting semantics with no vocabulary
    // would look like a successful observation of an empty surface, which is a
    // different claim from "this surface could not be observed safely".
    return { ok: false, refusal: "no-retained-semantic-tokens" };
  }

  const semantics: ObservationSemantics = {
    semanticsVersion: OBSERVATION_SEMANTICS_VERSION,
    tokens,
    controlKind: target.controlKind,
    controlRole: target.controlRole,
    interactionKind: target.interactionKind,
    surfaceKind: surface.surfaceKind,
    formMethod: target.formMethod,
    stateTokens: retainedStateTokens,
    objectKindEvidence,
    destructiveStyle: target.destructiveStyle,
    missingness: {
      accessibleNameMissing: accessibleTokens.length === 0,
      headingsMissing: headingFieldCount === 0,
      nearbyLabelsMissing: nearbyFieldCount === 0,
      stateTokensMissing: retainedStateTokens.length === 0,
      objectKindEvidenceMissing: objectKindEvidence.length === 0,
      redactionApplied:
        sanitized.report.droppedFieldCount > 0 || sanitized.report.redactedTokenCount > 0,
    },
    structuralCounts: {
      headingCount: headingFieldCount,
      nearbyLabelCount: nearbyFieldCount,
      stateTokenCount: retainedStateTokens.length,
      surfaceDepth: Math.min(target.ancestorDepth, FC008_SAFETY_CAPS.maxTraversalDepth),
      siblingControlCount: scanned.length,
    },
  };

  const redaction: RedactionReport = {
    redactedTokenCount: sanitized.report.redactedTokenCount,
    droppedTokenCount: sanitized.report.droppedFieldCount,
    truncatedStringCount: sanitized.report.truncatedStringCount,
    credentialPatternDetected: sanitized.report.credentialPatternDetected,
    nameLikePatternDropped: sanitized.report.nameLikeDroppedCount,
    retainedRatio: sanitized.report.retainedRatio,
    sanitizerVersion: TEXT_SANITIZER_VERSION,
  };

  return {
    ok: true,
    semantics,
    redaction,
    diagnostics: {
      scannedCandidateCount: scanned.length,
      skippedCandidateCount: surface.candidates.length - scanned.length,
      skippedHeadingCount: skippedHeadings,
      skippedNearbyLabelCount: skippedNearby,
      skippedStateSignalCount: state.skipped,
      channelOverflowTokenCount: channelOverflow,
      totalBudgetOverflowTokenCount: totalOverflow,
      redactionReasons: sanitized.report.reasons,
    },
  };
}

// ============================================================================
// OBSERVATION ASSEMBLY — THE ONLY PLACE A FINGERPRINT IS COMPUTED
// ============================================================================

export interface ObservationAssemblyInput {
  readonly surface: RawSurface;
  readonly acquisition: AcquisitionContext;
  readonly benchmark: BenchmarkMetadata | null;
  readonly freshness: FreshnessBinding;
  readonly observationId: string;
}

export type ObservationAssemblyResult =
  | { readonly ok: true; readonly observation: Record<string, unknown> }
  | { readonly ok: false; readonly refusal: ExtractionRefusal };

/**
 * Assembles a complete observation payload from a raw surface.
 *
 * This is the single place where sanitized semantics meet a fingerprint, and it
 * can only reach the fingerprint through `extractObservationSemantics`, whose
 * output is sanitized by construction. There is no code path that fingerprints a
 * raw surface, which is how AI-4 is enforced structurally rather than by review.
 *
 * Returns a plain payload rather than a validated `ActionObservation` so that the
 * result must still pass `validateActionObservation`. Constructing an observation
 * that bypasses the validator would create a second admission path.
 */
export function buildObservationFromSurface(
  input: ObservationAssemblyInput,
): ObservationAssemblyResult {
  const extracted = extractObservationSemantics(input.surface);
  if (!extracted.ok) {
    return { ok: false, refusal: extracted.refusal };
  }
  const fingerprint = computeObservationInputFingerprint(extracted.semantics, input.acquisition);
  if (!fingerprint.ok) {
    return { ok: false, refusal: "fingerprint-unavailable" };
  }
  return {
    ok: true,
    observation: {
      schemaVersion: "1.0",
      id: input.observationId,
      semantics: extracted.semantics,
      acquisition: input.acquisition,
      benchmark: input.benchmark,
      redaction: extracted.redaction,
      freshness: input.freshness,
      provenance: {
        extractorId: FC008_EXTRACTOR_ID,
        extractorVersion: FC008_EXTRACTOR_VERSION,
        sanitizerVersion: TEXT_SANITIZER_VERSION,
        source: "adapter",
        synthetic: true,
      },
      inputFingerprint: fingerprint.fingerprint,
    },
  };
}
