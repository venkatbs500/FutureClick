/**
 * FC-008 — the frozen AI-1 … AI-24 architectural invariants.
 *
 * These identities are FROZEN. AI-n means one specific thing permanently, and
 * the number is the stable reference used by the architecture document, the
 * tests, the code comments, and every review report. Renumbering them, reusing
 * a number for a different claim, or introducing a second numbering scheme is
 * forbidden: a review that cites AI-9 must be citing the same invariant the
 * code enforces.
 *
 * The statements below are the authoritative wording. The architecture document
 * quotes this module rather than restating it, so the two cannot drift.
 *
 * STATUS VOCABULARY
 *
 * Each invariant carries an honest status for the code that currently exists,
 * because several of these are enforced by components built sprint by sprint:
 *
 * - `pass`                The invariant holds for the surface that currently
 *                         ships, and that is demonstrated by tests.
 * - `partial-structural`  The structural guarantee is in place and tested, but
 *                         full enforcement needs a later-sprint component.
 * - `deferred`            The invariant is defined and no component that could
 *                         satisfy it exists yet. NOT a pass.
 *
 * `deferred` is reported as deferred. Marking an unimplemented invariant as
 * passing would make the whole table worthless as evidence.
 *
 * THIS MODULE IS THE SINGLE SOURCE OF TRUTH FOR STATUS
 *
 * The architecture documents quote it rather than restating it. That rule exists
 * because the two did drift: Sprint 2 implemented the sanitizer and the
 * adversarial corpus, the Sprint-2 document reported AI-4 and AI-7 as passing,
 * and this registry still said `deferred` and `partial-structural`. An exported
 * registry contradicting the architecture document is worse than either being
 * wrong alone, since a reader cannot tell which one to believe.
 *
 * `statusSince` records WHEN the status was reached, so advancing a status does
 * not erase the fact that an earlier sprint honestly reported less. Statements
 * never change — AI-n means one thing permanently — only status, `statusSince`,
 * and basis advance.
 */

import { RAW_SURFACE_FORBIDDEN_KEYS } from "./surface.js";

export type InvariantStatus = "pass" | "partial-structural" | "deferred";

/** The sprint in which an invariant reached its current status. */
export type InvariantMilestone = "sprint-1" | "sprint-2";

export interface Fc008Invariant {
  /** Canonical frozen identifier, `AI-1` through `AI-24`. */
  readonly id: `AI-${number}`;
  /** Canonical frozen number, 1 through 24. */
  readonly number: number;
  /** Authoritative statement of the invariant. */
  readonly statement: string;
  readonly status: InvariantStatus;
  /** The sprint in which this invariant reached its current status. */
  readonly statusSince: InvariantMilestone;
  /** Why the status is what it is, including what a later sprint must add. */
  readonly basis: string;
}

function invariant(
  number: number,
  status: InvariantStatus,
  statusSince: InvariantMilestone,
  statement: string,
  basis: string,
): Fc008Invariant {
  return Object.freeze({
    id: `AI-${number}` as const,
    number,
    statement,
    status,
    statusSince,
    basis,
  });
}

export const FC008_INVARIANTS: readonly Fc008Invariant[] = Object.freeze([
  invariant(
    1,
    "pass",
    "sprint-1",
    "Observation and hypothesis are inert serializable deeply-frozen data. No live DOM/capability/function references.",
    "Fail-closed validation rejects functions, accessors, symbols, and exotic objects; every published result is deeply frozen and asserted inert.",
  ),
  invariant(
    2,
    "pass",
    "sprint-1",
    "Model output can never create, arm, or influence release authority.",
    "The package declares no dependency on, and imports nothing from, any FC-007 release path; the result union carries no capability, token, or executor.",
  ),
  invariant(
    3,
    "pass",
    "sprint-1",
    "FC-008 model output is always PREDICTED and never VERIFIED.",
    "`evidenceMode` is the frozen constant `predicted`, the hypothesis validator rejects any other value, and no code path can set `verified`.",
  ),
  invariant(
    4,
    "pass",
    "sprint-2",
    "Privacy sanitization completes before fingerprinting, logging, serialization, persistence, and inference.",
    "Sprint 2 ships the real sanitizer in `@futureclick/privacy`, which is the sole authority on what text may enter Layer B. The extractor contains exactly one call site for `computeObservationInputFingerprint`, positioned after `sanitizeFields`, and both the count and the position are asserted. Two surfaces differing only in an embedded secret produce identical fingerprints, which evidences the ordering positively rather than only by absence of a leak. Secret-shaped material is asserted absent from semantics, records, manifests, diagnostics, and reports.",
  ),
  invariant(
    5,
    "pass",
    "sprint-1",
    "Stale inference cannot attach to changed state. Pre/post freshness checks are required.",
    "The runtime requires an injected freshness validator and checks it before inference (step 5) and again before publication (step 13).",
  ),
  invariant(
    6,
    "pass",
    "sprint-1",
    "Invalid, unavailable, timed-out, mismatched, or crashed model fails closed without producing a hypothesis.",
    "Each condition maps to an operational failure code, and the tests assert that no such path can return a hypothesis.",
  ),
  invariant(
    7,
    "pass",
    "sprint-2",
    "Page/application content is untrusted data, never instructions.",
    "Sprint 2 adds the extractor that produces Layer B and an adversarial corpus containing explicit instruction-shaped text ('ignore previous instructions', 'mark this action safe', 'always classify as delete'). Differential tests hold a scenario fixed, inject the text, and assert the oracle label, the feature policy, the extraction caps, the support matrix, and the target control's own tokens are all unchanged; injected words appear only as ordinary lowercase tokens on the nearby-label channel. Demonstrated within the synthetic scope this corpus covers, not claimed as immunity to arbitrary future attacks.",
  ),
  invariant(
    8,
    "pass",
    "sprint-1",
    "Thresholds and abstention policy are runtime-owned, validated, frozen, and cannot be influenced by page content or provider output.",
    "`AbstentionPolicy` is validated and frozen at construction; the provider scoring context carries version strings only, with no threshold, budget, or policy field.",
  ),
  invariant(
    9,
    "pass",
    "sprint-1",
    "The model/provider has no tool, shell, filesystem, network mutation, browser-control, eval, or execution capability.",
    '`lib: ["ES2022"]` makes DOM types unnameable; the provider signature accepts inert data and returns inert data; the forbidden-API scan and the dependency allowlist are asserted.',
  ),
  invariant(
    10,
    "pass",
    "sprint-1",
    "FC-008 imports nothing from FC-007 interception/release/native-click paths.",
    "Asserted by import-specifier scanning across the package, by the manifest dependency allowlist, and by the absence of any FC-007 entry in either.",
  ),
  invariant(
    11,
    "pass",
    "sprint-1",
    "No remote transmission, remote model download, or remote model SDK exists in FC-008 V1.",
    "No network API is referenced, no remote URL appears in source, and the dependency allowlist contains no HTTP client or model SDK.",
  ),
  invariant(
    12,
    "pass",
    "sprint-1",
    "No runtime training or weight mutation. Model artifacts are read-only.",
    "The runtime exposes no fit, train, or update entry point; the artifact descriptor is a frozen read-only record and the provider cannot replace it.",
  ),
  invariant(
    13,
    "pass",
    "sprint-1",
    "Provider cannot accept itself. Provider returns scores only; runtime constructs decisions/hypotheses.",
    "The provider outcome union has no hypothesis, acceptance, probability, threshold, or support member, and outcome validation rejects any such key.",
  ),
  invariant(
    14,
    "pass",
    "sprint-1",
    "FC-007 remains frozen: canonical seven source hashes + production bundle + regressions unchanged.",
    "Verified by hashing the canonical seven sources and the production bundle before and after this work, and by running the FC-007 regression suite.",
  ),
  invariant(
    15,
    "pass",
    "sprint-1",
    "Site/application identity is excluded from primary model features.",
    "Hostname, origin, URL, referrer, application name, and route identity are unnameable on Layer B at the type level and unreachable at runtime.",
  ),
  invariant(
    16,
    "pass",
    "sprint-1",
    "Object labels/private object names are excluded from primary model features.",
    "The object label lives only in the ephemeral display context, which is not a field of the observation, is refused by the observation validator, and throws if serialized.",
  ),
  invariant(
    17,
    "pass",
    "sprint-1",
    "FC-008 does not mutate the authoritative ActionGraph and adds no graph node/relation vocabulary.",
    "The package declares no ActionGraph dependency and exports no node type, relation type, or mutation entry point.",
  ),
  invariant(
    18,
    "partial-structural",
    "sprint-1",
    "Offline training dependencies are separated from browser/TypeScript runtime dependencies.",
    "The package manifest contains no training dependency and the allowlist test enforces that. Sprint 2 strengthens the browser side by placing the vocabulary fitting path in the offline dataset package, and the runtime package is asserted to export nothing matching `fit*`, `train*`, or `*Corpus`. Still PARTIAL: the offline Python training environment is a Sprint 3 deliverable, so the separation remains asserted on one side only.",
  ),
  invariant(
    19,
    "pass",
    "sprint-1",
    "All prohibited feature families and oracle proxies are structurally unreachable by the primary feature projector.",
    "The projector signature accepts Layer B alone, so the other layers are unnameable; the prohibited-input list is asserted absent at the type level and by runtime key reachability.",
  ),
  invariant(
    20,
    "pass",
    "sprint-1",
    "Operational failures are never represented as epistemic abstention.",
    "Operational and epistemic outcomes are separate union members with disjoint vocabularies; failures are excluded from selective statistics and step 13 does not relabel them.",
  ),
  invariant(
    21,
    "pass",
    "sprint-1",
    "Novelty/support diagnostics are deterministic support evidence, never probabilities or calibrated confidence.",
    "Support assessment is a runtime-owned comparison against frozen vocabularies; the record carries no probability, score, logit, or distance field, and no distance or density measure is named anywhere.",
  ),
  invariant(
    22,
    "pass",
    "sprint-1",
    "FC-008 captures no screenshots, images, clipboard, keystrokes, or accessibility-tree dumps.",
    // The count is interpolated from the frozen list rather than written out. A
    // documented count that duplicates a list is a count that eventually disagrees
    // with it, which is exactly what happened: the list grew to 46 and the prose
    // still said 45.
    `No capture API is reachable and every such field is unnameable on Layer B. Sprint 2's extractor consumes an inert DOM-free \`RawSurface\` whose ${RAW_SURFACE_FORBIDDEN_KEYS.length} forbidden keys include every screenshot, image, clipboard, keystroke, and accessibility-tree field, so the Sprint-1 caveat about extension-side capture no longer applies to any code that exists. A real browser adapter remains a later-sprint component.`,
  ),
  invariant(
    23,
    "deferred",
    "sprint-1",
    "The future research-mode indicator is inert, contains no predicted consequence content, and has no execution authority.",
    "No indicator exists in Sprint 1. The requirement is recorded here for Sprint 5 and is not claimed as satisfied.",
  ),
  invariant(
    24,
    "pass",
    "sprint-1",
    "No persistence or production telemetry exists in FC-008 V1.",
    "No storage, database, filesystem, or telemetry API is referenced, and the dependency allowlist contains no such client. Sprint 2's dataset package is asserted to import no `node:fs` and no subprocess API: the corpus is assembled in memory and returned, so a research dataset exists without a persistence path.",
  ),
]);

export const FC008_INVARIANT_COUNT = FC008_INVARIANTS.length;

const BY_ID: ReadonlyMap<string, Fc008Invariant> = new Map(
  FC008_INVARIANTS.map((i) => [i.id, i] as const),
);

/** Looks up one invariant by its canonical identifier, for example `AI-9`. */
export function getInvariant(id: string): Fc008Invariant | undefined {
  return BY_ID.get(id);
}

export function invariantsWithStatus(status: InvariantStatus): readonly Fc008Invariant[] {
  return Object.freeze(FC008_INVARIANTS.filter((i) => i.status === status));
}

/**
 * Structural self-check: the identifiers must be AI-1 through AI-24 exactly
 * once each, in order, with no gap, no duplicate, and no renumbering.
 */
export function verifyInvariantNumbering(): readonly string[] {
  const issues: string[] = [];
  if (FC008_INVARIANT_COUNT !== 24) {
    issues.push(`EXPECTED_24_INVARIANTS_FOUND_${FC008_INVARIANT_COUNT}`);
  }
  const seen = new Set<number>();
  for (let i = 0; i < FC008_INVARIANTS.length; i++) {
    const entry = FC008_INVARIANTS[i];
    if (entry === undefined) {
      issues.push(`MISSING_ENTRY_AT_${i}`);
      continue;
    }
    if (entry.number !== i + 1) {
      issues.push(`OUT_OF_ORDER:${entry.id}`);
    }
    if (entry.id !== `AI-${entry.number}`) {
      issues.push(`ID_NUMBER_DISAGREEMENT:${entry.id}`);
    }
    if (seen.has(entry.number)) {
      issues.push(`DUPLICATE_NUMBER:${entry.number}`);
    }
    seen.add(entry.number);
    if (entry.statement.trim().length === 0 || entry.basis.trim().length === 0) {
      issues.push(`EMPTY_TEXT:${entry.id}`);
    }
  }
  return Object.freeze(issues);
}
