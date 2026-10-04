/**
 * The raw, pre-sanitization input to bounded extraction.
 *
 * WHY THIS IS NOT A DOM
 *
 * `tsconfig.base.json` sets `lib: ["ES2022"]`, so DOM types are unnameable in
 * this package, and that is deliberate. An extractor written against a live
 * `Element` would hold a capability: it could read anything on the page, and
 * nothing in its signature would say so. Instead, extraction consumes this inert
 * plain-data snapshot. A synthetic generator produces one directly; a future
 * browser adapter produces one from a real page and is the only component that
 * ever touches a DOM.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * There is no `url`, `hostname`, `origin`, `route`, `selector`, `xpath`,
 * `cssPath`, `title`, `html`, `screenshot`, `elementId`, or timestamp field here.
 * Those are not filtered out later: there is no field through which they could
 * arrive in the first place. A test asserts this surface declares no key naming a
 * prohibited input.
 *
 * TEXT IS NOT TRUSTED
 *
 * Every string arrives wrapped in a `RawTextSlot` carrying a `disposition`. The
 * producer declares what KIND of slot text came from; it does not declare that
 * the text is safe. Deciding safety belongs exclusively to the sanitizer.
 */

import type { EntityKind } from "@futureclick/action-schema";
import type { TextDisposition } from "@futureclick/privacy";
import type {
  ControlKind,
  ControlRole,
  FormMethod,
  InteractionKind,
  SurfaceKind,
} from "./observation.js";

/**
 * One raw string plus the kind of slot it came from.
 *
 * The producer cannot mark text as "safe". `disposition` says where the text came
 * from — a visible control label, a private object name, something the user
 * typed — and the sanitizer maps that origin to a decision.
 */
export interface RawTextSlot {
  readonly text: string;
  readonly disposition: TextDisposition;
}

/** Convenience constructor for ordinary visible semantic text. */
export function semanticText(text: string): RawTextSlot {
  return { text, disposition: "semantic" };
}

/** Convenience constructor for text that names a private object. */
export function nameLikeText(text: string): RawTextSlot {
  return { text, disposition: "name-like" };
}

/**
 * A raw categorical state signal observed on the surface.
 *
 * `property` is checked against the frozen transition properties during
 * extraction, so the state channel cannot grow uncontrolled free text.
 */
export interface RawStateSignal {
  readonly property: string;
  readonly value: string;
}

/** One candidate control enumerated during a surface scan. */
export interface RawControlCandidate {
  /** The control's own visible text. Becomes the `ctl` channel. */
  readonly ownText: RawTextSlot;
  /** Programmatic accessible name, if any. Becomes the `acc` channel. */
  readonly accessibleName: RawTextSlot | null;
  readonly controlKind: ControlKind;
  readonly controlRole: ControlRole;
  readonly interactionKind: InteractionKind;
  readonly formMethod: FormMethod;
  /**
   * Whether the control is styled as destructive. A weak signal only: styling is
   * a convention a surface may ignore or misuse, so it never decides anything on
   * its own.
   */
  readonly destructiveStyle: boolean;
  /** Nearby semantic labels. Becomes the `nb` channel. */
  readonly nearbyLabels: readonly RawTextSlot[];
  /** Ancestor hops from the surface root. Bounded during extraction. */
  readonly ancestorDepth: number;
}

/**
 * An inert snapshot of one interactive surface.
 *
 * Carries only what Layer B needs. `candidates` exists so that the sibling count
 * is derived from what was actually scanned rather than asserted by the producer.
 */
export interface RawSurface {
  readonly surfaceKind: SurfaceKind;
  /** Bounded heading / context text. Becomes the `hd` channel. */
  readonly headings: readonly RawTextSlot[];
  /** Closed categorical state signals. Becomes the `st` channel. */
  readonly stateSignals: readonly RawStateSignal[];
  /** Weak object-kind evidence. Never an object name. */
  readonly objectKindEvidence: readonly EntityKind[];
  /** Every control enumerated by the scan, including the target. */
  readonly candidates: readonly RawControlCandidate[];
  /** Index into `candidates` identifying the control being acted on. */
  readonly targetIndex: number;
}

/**
 * Keys this module must never declare, mirroring the feature-policy denylist.
 *
 * Kept here as data so the structural test can assert absence rather than relying
 * on review. If a future field named `url` were added, that test fails.
 */
export const RAW_SURFACE_FORBIDDEN_KEYS = Object.freeze([
  "url",
  "href",
  "hostname",
  "host",
  "origin",
  "domain",
  "route",
  "path",
  "pathname",
  "query",
  "search",
  "fragment",
  "hash",
  "selector",
  "cssPath",
  "xpath",
  "domId",
  "elementId",
  "nodeId",
  "title",
  "pageTitle",
  "html",
  "outerHTML",
  "innerHTML",
  "screenshot",
  "image",
  "clipboard",
  "keystrokes",
  "accessibilityTree",
  "axTree",
  "cookies",
  "storage",
  "localStorage",
  "sessionStorage",
  "timestamp",
  "capturedAt",
  "applicationName",
  "siteName",
  "objectLabel",
  "fixtureId",
  "generatorId",
  "scenarioId",
  "partition",
  "oracleClass",
  "groundTruth",
  "label",
] as const);
