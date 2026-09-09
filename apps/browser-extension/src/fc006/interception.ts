/**
 * FC-006 Synchronous Interception Eligibility (Sprint 2B)
 *
 * Epistemological Boundary:
 * Pure helpers for trusted click gating and exact FC-006 candidate resolution.
 *
 * Sprint 2B: no composedPath / unbounded ancestor scans for pending matching
 * or owned-control discovery. Pending protection uses exact identity plus a
 * hard-bounded ≤4 hop parentElement walk at the window listener; deep
 * descendants are blocked by a capture listener on pending.element itself.
 */

import type { BrowserObservation } from "@futureclick/browser-adapter";
import {
  captureFc006ButtonObservation,
  isFc006LocationAuthorized,
  MAX_ACTIVATION_ANCESTOR_HOPS,
  resolveFc006ActivationButton,
} from "./capture.js";
import {
  assessFc006RepositoryVisibilityObservation,
  type Fc006ApplicabilityResult,
} from "./synthetic-repository-interception-adapter.js";

export type Fc006LifecycleKind =
  | "off"
  | "observing"
  | "evaluating"
  | "preview-ready"
  | "abstention"
  | "stale"
  | "continuing";

export interface Fc006ExactCandidate {
  readonly button: HTMLButtonElement;
  readonly observation: BrowserObservation;
  readonly applicability: Extract<Fc006ApplicabilityResult, { status: "matched" }>;
}

export interface PendingMatchOptions {
  /** Invoked once per parentElement read during the bounded hop walk. */
  readonly onParentRead?: (() => void) | undefined;
}

/**
 * Gates required to begin a NEW preview from a page activation.
 * Does not cover pending-target protection (handled separately).
 */
export function passesNewPreviewEventGates(
  event: Pick<Event, "type" | "isTrusted" | "cancelable" | "defaultPrevented">,
  lifecycle: Fc006LifecycleKind,
): boolean {
  return (
    lifecycle === "observing" &&
    event.type === "click" &&
    event.isTrusted === true &&
    event.cancelable === true &&
    event.defaultPrevented === false
  );
}

/**
 * Synchronously resolves an exact FC-006 supported private→public candidate.
 * Capture alone is insufficient — shared applicability must return matched.
 */
export function resolveExactFc006SupportedCandidate(
  target: EventTarget | null,
  location: Location,
): Fc006ExactCandidate | null {
  if (!isFc006LocationAuthorized(location)) {
    return null;
  }

  const button = resolveFc006ActivationButton(target);
  if (!button) {
    return null;
  }

  const observation = captureFc006ButtonObservation(button, location);
  if (!observation) {
    return null;
  }

  const applicability = assessFc006RepositoryVisibilityObservation(observation);
  if (applicability.status !== "matched") {
    return null;
  }

  return { button, observation, applicability };
}

/**
 * Window-level pending fast path: exact target identity or ≤4 Element hops.
 * Does NOT use composedPath. Deeper descendants are blocked by the direct
 * pending.element capture listener (constant FutureClick JS work).
 *
 * Maximum parentElement reads: MAX_ACTIVATION_ANCESTOR_HOPS (= 4).
 */
export function eventTargetsPendingElement(
  event: Event,
  pendingElement: HTMLButtonElement,
  options?: PendingMatchOptions,
): boolean {
  if (event.target === pendingElement) {
    return true;
  }

  if (typeof Element === "undefined" || !(event.target instanceof Element)) {
    return false;
  }

  let curr: Element | null = event.target;
  let hops = 0;
  while (curr !== null && hops < MAX_ACTIVATION_ANCESTOR_HOPS) {
    const parent: Element | null = curr.parentElement;
    options?.onParentRead?.();
    hops += 1;
    if (parent === pendingElement) {
      return true;
    }
    curr = parent;
  }

  return false;
}

/**
 * Pending / secondary block helper:
 * always stopImmediatePropagation when supported;
 * preventDefault only when cancelable and not already prevented.
 */
export function blockPendingActivationEvent(event: Event): void {
  if (typeof (event as MouseEvent).stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }

  if (event.cancelable === true && event.defaultPrevented === false) {
    if (typeof (event as MouseEvent).preventDefault === "function") {
      event.preventDefault();
    }
  }
}
