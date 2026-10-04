/**
 * FC-007 Sprint 2 security fix — early window-capture target resolution.
 *
 * ONE early decision at window capture using exact button identity + light-DOM
 * containment (native Node.prototype.contains via Reflect.apply).
 * No hop-limit fallback. No late button-capture security listener.
 */

import { FC007_NODE_ELEMENT, nativeNodeType, nativeParentElement } from "./native-dom.js";

export type Fc007TrustClickPredicate = (event: Event) => boolean;

/** Captured at module load — page cannot replace this binding in isolated world. */
const NATIVE_NODE_CONTAINS: ((this: Node, other: Node | null) => boolean) | null =
  typeof Node !== "undefined" && typeof Node.prototype.contains === "function"
    ? Node.prototype.contains
    : null;

/**
 * Production trust gate: native isTrusted + cancelable click.
 * Tests may supply a non-page-controllable predicate via controller options.
 */
export function passesTrustedActivationGates(
  event: Pick<Event, "type" | "isTrusted" | "cancelable" | "defaultPrevented">,
  trustPredicate?: Fc007TrustClickPredicate,
): boolean {
  if (event.type !== "click") return false;
  if (event.cancelable !== true) return false;
  if (event.defaultPrevented === true) return false;
  if (trustPredicate) return trustPredicate(event as Event);
  return event.isTrusted === true;
}

/**
 * Exact retained/block-guard button, or any light-DOM descendant (any depth).
 * Does not authorize via text/selector/class. Does not traverse into foreign
 * shadow trees (parentElement walk must reach the button).
 */
export function eventTargetsBlockButton(event: Event, blockButton: HTMLButtonElement): boolean {
  const target = event.target;
  if (target === blockButton) return true;
  if (typeof Node === "undefined" || !(target instanceof Node)) return false;

  if (NATIVE_NODE_CONTAINS) {
    let contained = false;
    try {
      contained = Reflect.apply(NATIVE_NODE_CONTAINS, blockButton, [target]) === true;
    } catch {
      contained = false;
    }
    if (!contained) return false;
  }

  // Light-DOM proof: walk parent elements to the exact button (stops at shadow).
  // Retained getters only — the chain is page-controlled and may contain a form.
  let cur: Element | null =
    nativeNodeType(target) === FC007_NODE_ELEMENT
      ? (target as Element)
      : nativeParentElement(target);
  while (cur) {
    if (cur === blockButton) return true;
    cur = nativeParentElement(cur);
  }
  return false;
}

/** @deprecated Prefer eventTargetsBlockButton — kept for transitional test imports. */
export function eventTargetsRetainedFinalButton(
  event: Event,
  retainedFinalButton: HTMLButtonElement,
): boolean {
  return eventTargetsBlockButton(event, retainedFinalButton);
}

/**
 * Synchronously block a supported activation. Call before any revalidation/async.
 */
export function blockSupportedActivationEvent(event: Event): void {
  if (typeof event.preventDefault === "function") {
    event.preventDefault();
  }
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
  if (typeof event.stopPropagation === "function") {
    event.stopPropagation();
  }
}
