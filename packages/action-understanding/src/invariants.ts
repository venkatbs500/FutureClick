/**
 * FC-008 Sprint 1 — the frozen AI-1 … AI-24 architectural invariants.
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
 * Each invariant carries an honest Sprint-1 status, because several of these
 * are enforced by components that do not exist yet:
 *
 * - `pass`                The invariant holds for the surface Sprint 1 ships,
 *                         and that is demonstrated by tests.
 * - `partial-structural`  The structural guarantee is in place and tested, but
 *                         full enforcement needs a later-sprint component.
 * - `deferred`            Sprint 1 defines the invariant and ships no component
 *                         that could satisfy it yet. NOT a pass.
 *
 * `deferred` is reported as deferred. Marking an unimplemented invariant as
 * passing would make the whole table worthless as evidence.
 */

export type InvariantStatus = "pass" | "partial-structural" | "deferred";

export interface Fc008Invariant {
  /** Canonical frozen identifier, `AI-1` through `AI-24`. */
  readonly id: `AI-${number}`;
  /** Canonical frozen number, 1 through 24. */
  readonly number: number;
  /** Authoritative statement of the invariant. */
  readonly statement: string;
  readonly status: InvariantStatus;
  /** Why the status is what it is, including what a later sprint must add. */
  readonly basis: string;
}

function invariant(
  number: number,
  status: InvariantStatus,
  statement: string,
  basis: string,
): Fc008Invariant {
  return Object.freeze({ id: `AI-${number}` as const, number, statement, status, basis });
}

export const FC008_INVARIANTS: readonly Fc008Invariant[] = Object.freeze([
  invariant(
    1,
    "pass",
    "Observation and hypothesis are inert serializable deeply-frozen data. No live DOM/capability/function references.",
    "Fail-closed validation rejects functions, accessors, symbols, and exotic objects; every published result is deeply frozen and asserted inert.",
  ),
  invariant(
    2,
    "pass",
    "Model output can never create, arm, or influence release authority.",
    "The package declares no dependency on, and imports nothing from, any FC-007 release path; the result union carries no capability, token, or executor.",
  ),
  invariant(
    3,
    "pass",
    "FC-008 model output is always PREDICTED and never VERIFIED.",
    "`evidenceMode` is the frozen constant `predicted`, the hypothesis validator rejects any other value, and no code path can set `verified`.",
  ),
  invariant(
    4,
    "deferred",
    "Privacy sanitization completes before fingerprinting, logging, serialization, persistence, and inference.",
    "The ordering is declared and the observation carries a sanitizer version and redaction record, but the real sanitizer is a Sprint 2 component. Sprint 1 ships no sanitizer, so this cannot yet be claimed as enforced.",
  ),
  invariant(
    5,
    "pass",
    "Stale inference cannot attach to changed state. Pre/post freshness checks are required.",
    "The runtime requires an injected freshness validator and checks it before inference (step 5) and again before publication (step 13).",
  ),
  invariant(
    6,
    "pass",
    "Invalid, unavailable, timed-out, mismatched, or crashed model fails closed without producing a hypothesis.",
    "Each condition maps to an operational failure code, and the tests assert that no such path can return a hypothesis.",
  ),
  invariant(
    7,
    "partial-structural",
    "Page/application content is untrusted data, never instructions.",
    "Layer B is a closed grammar of bounded categoricals and tokens with no free-text field, and the provider receives Layer B only. Full enforcement depends on the Sprint 2 extractor and sanitizer that produce Layer B from a real page.",
  ),
  invariant(
    8,
    "pass",
    "Thresholds and abstention policy are runtime-owned, validated, frozen, and cannot be influenced by page content or provider output.",
    "`AbstentionPolicy` is validated and frozen at construction; the provider scoring context carries version strings only, with no threshold, budget, or policy field.",
  ),
  invariant(
    9,
    "pass",
    "The model/provider has no tool, shell, filesystem, network mutation, browser-control, eval, or execution capability.",
    '`lib: ["ES2022"]` makes DOM types unnameable; the provider signature accepts inert data and returns inert data; the forbidden-API scan and the dependency allowlist are asserted.',
  ),
  invariant(
    10,
    "pass",
    "FC-008 imports nothing from FC-007 interception/release/native-click paths.",
    "Asserted by import-specifier scanning across the package, by the manifest dependency allowlist, and by the absence of any FC-007 entry in either.",
  ),
  invariant(
    11,
    "pass",
    "No remote transmission, remote model download, or remote model SDK exists in FC-008 V1.",
    "No network API is referenced, no remote URL appears in source, and the dependency allowlist contains no HTTP client or model SDK.",
  ),
  invariant(
    12,
    "pass",
    "No runtime training or weight mutation. Model artifacts are read-only.",
    "The runtime exposes no fit, train, or update entry point; the artifact descriptor is a frozen read-only record and the provider cannot replace it.",
  ),
  invariant(
    13,
    "pass",
    "Provider cannot accept itself. Provider returns scores only; runtime constructs decisions/hypotheses.",
    "The provider outcome union has no hypothesis, acceptance, probability, threshold, or support member, and outcome validation rejects any such key.",
  ),
  invariant(
    14,
    "pass",
    "FC-007 remains frozen: canonical seven source hashes + production bundle + regressions unchanged.",
    "Verified by hashing the canonical seven sources and the production bundle before and after this work, and by running the FC-007 regression suite.",
  ),
  invariant(
    15,
    "pass",
    "Site/application identity is excluded from primary model features.",
    "Hostname, origin, URL, referrer, application name, and route identity are unnameable on Layer B at the type level and unreachable at runtime.",
  ),
  invariant(
    16,
    "pass",
    "Object labels/private object names are excluded from primary model features.",
    "The object label lives only in the ephemeral display context, which is not a field of the observation, is refused by the observation validator, and throws if serialized.",
  ),
  invariant(
    17,
    "pass",
    "FC-008 does not mutate the authoritative ActionGraph and adds no graph node/relation vocabulary.",
    "The package declares no ActionGraph dependency and exports no node type, relation type, or mutation entry point.",
  ),
  invariant(
    18,
    "partial-structural",
    "Offline training dependencies are separated from browser/TypeScript runtime dependencies.",
    "The package manifest contains no training dependency and the allowlist test enforces that. The offline training environment itself is a Sprint 3 deliverable, so the separation is currently asserted on one side only.",
  ),
  invariant(
    19,
    "pass",
    "All prohibited feature families and oracle proxies are structurally unreachable by the primary feature projector.",
    "The projector signature accepts Layer B alone, so the other layers are unnameable; the prohibited-input list is asserted absent at the type level and by runtime key reachability.",
  ),
  invariant(
    20,
    "pass",
    "Operational failures are never represented as epistemic abstention.",
    "Operational and epistemic outcomes are separate union members with disjoint vocabularies; failures are excluded from selective statistics and step 13 does not relabel them.",
  ),
  invariant(
    21,
    "pass",
    "Novelty/support diagnostics are deterministic support evidence, never probabilities or calibrated confidence.",
    "Support assessment is a runtime-owned comparison against frozen vocabularies; the record carries no probability, score, logit, or distance field, and no distance or density measure is named anywhere.",
  ),
  invariant(
    22,
    "pass",
    "FC-008 captures no screenshots, images, clipboard, keystrokes, or accessibility-tree dumps.",
    "Passes for the surface Sprint 1 ships: no capture API is reachable and every such field is unnameable on Layer B. Extension-side capture is governed by the Sprint 2 extractor and is deferred to it.",
  ),
  invariant(
    23,
    "deferred",
    "The future research-mode indicator is inert, contains no predicted consequence content, and has no execution authority.",
    "No indicator exists in Sprint 1. The requirement is recorded here for Sprint 5 and is not claimed as satisfied.",
  ),
  invariant(
    24,
    "pass",
    "No persistence or production telemetry exists in FC-008 V1.",
    "Passes for the surface Sprint 1 ships: no storage, database, filesystem, or telemetry API is referenced, and the dependency allowlist contains no such client.",
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
