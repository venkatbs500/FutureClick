/**
 * Browser DOM Event Capture and Allowlisted Metadata Snapshot (Sprint FC-005)
 *
 * Epistemological Boundary:
 * Captures synchronous snapshots of allowlisted metadata on native buttons.
 *
 * Invariants:
 * - NEVER calls preventDefault(), stopPropagation(), or stopImmediatePropagation().
 * - Only authorized on exact origin http://127.0.0.1:4173 and pathname /fc005/repository-visibility.html.
 * - Supports ONLY native <button type="button"> activation.
 * - Reads allowlisted data-futureclick-* attributes individually; zero dataset enumeration.
 * - Produces detached, immutable BrowserObservation instances.
 */

import {
  type BrowserObservation,
  assessControlPrivacy,
  authorizeFixtureLocation,
  validateBrowserObservation,
} from "@futureclick/browser-adapter";
import { type IsoTimestamp, currentIsoTimestamp, generateEntityId } from "@futureclick/shared";

export const ATTR_FIXTURE_CONTRACT = "data-futureclick-fixture-contract";
export const ATTR_OPERATION = "data-futureclick-operation";
export const ATTR_ENTITY_KEY = "data-futureclick-entity-key";
export const ATTR_CURRENT_VISIBILITY = "data-futureclick-current-visibility";
export const ATTR_REQUESTED_VISIBILITY = "data-futureclick-requested-visibility";

/**
 * Verifies that the current browser window location is strictly authorized for FC-005 capture.
 */
export function isLocationAuthorized(location: Location): boolean {
  const auth = authorizeFixtureLocation({
    protocol: location.protocol,
    hostname: location.hostname,
    port: location.port,
    pathname: location.pathname,
  });
  return auth.authorized;
}

export const MAX_ACTIVATION_ANCESTOR_HOPS = 4;

export function isNodeContentEditable(node: unknown): boolean {
  if (typeof HTMLElement !== "undefined" && node instanceof HTMLElement) {
    if (node.isContentEditable) {
      return true;
    }
    const attr = node.getAttribute("contenteditable");
    if (attr !== null && attr.toLowerCase() !== "false") {
      return true;
    }
  }
  return false;
}

/**
 * Conservatively resolves the activation target to a supported native button element.
 * Rejects detached nodes, disabled buttons, non-buttons, contenteditable elements,
 * and controls beyond the bounded ancestor depth (Finding M4).
 */
export function resolveActivationButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!target || typeof Node === "undefined" || !(target instanceof Node)) {
    return null;
  }

  // Reject detached nodes
  if (!target.isConnected) {
    return null;
  }

  // Ensure target belongs to active document
  if (typeof document !== "undefined" && target.ownerDocument !== document) {
    return null;
  }

  // Check if target itself is contenteditable
  if (isNodeContentEditable(target)) {
    return null;
  }

  // Bounded ancestor resolution (Finding M4: max 4 hops, ordinary light DOM only, no closest("button"))
  let curr: Node | null = target;
  let hops = 0;
  let buttonElem: HTMLButtonElement | null = null;

  while (curr !== null && hops <= MAX_ACTIVATION_ANCESTOR_HOPS) {
    // Check if any traversed ancestor is contenteditable
    if (isNodeContentEditable(curr)) {
      return null;
    }

    if (typeof HTMLButtonElement !== "undefined" && curr instanceof HTMLButtonElement) {
      buttonElem = curr;
      break;
    }

    // Light DOM parent traversal only (do not cross shadow roots or foreign documents)
    if (typeof Element !== "undefined" && curr instanceof Element) {
      curr = curr.parentElement;
    } else {
      curr = curr.parentNode;
      if (curr !== null && typeof Element !== "undefined" && !(curr instanceof Element)) {
        return null;
      }
    }
    hops++;
  }

  if (!buttonElem) {
    return null;
  }

  // Target must be connected to current document
  if (
    !buttonElem.isConnected ||
    (typeof document !== "undefined" && buttonElem.ownerDocument !== document)
  ) {
    return null;
  }

  // Must be native <button type="button"> (not submit, reset, or default)
  if (buttonElem.type !== "button") {
    return null;
  }

  // Check disabled state
  if (buttonElem.disabled) {
    return null;
  }

  // Button itself must not be contenteditable
  if (isNodeContentEditable(buttonElem)) {
    return null;
  }

  // Assess control privacy using pure boundary checks
  const privacy = assessControlPrivacy({
    tagName: buttonElem.tagName,
    inputType: buttonElem.type,
    id: buttonElem.id,
    name: buttonElem.name,
    className: buttonElem.className,
    ariaRole: buttonElem.getAttribute("role") ?? undefined,
  });

  if (!privacy.permitted) {
    return null;
  }

  return buttonElem;
}

export interface CaptureObservationOptions {
  readonly timestampProvider?: () => IsoTimestamp;
}

/**
 * Synchronously captures an allowlisted metadata snapshot from a clicked button.
 * Returns null if location is unauthorized, required metadata is absent, or validation fails.
 */
export function captureButtonObservation(
  button: HTMLButtonElement,
  location: Location,
  options?: CaptureObservationOptions,
): BrowserObservation | null {
  // 1. Strict location authorization
  const auth = authorizeFixtureLocation({
    protocol: location.protocol,
    hostname: location.hostname,
    port: location.port,
    pathname: location.pathname,
  });

  if (!auth.authorized || !auth.origin || !auth.routeId) {
    return null;
  }

  // 2. Allowlisted attribute extraction (read individually; no dataset enumeration)
  const fixtureContract = button.getAttribute(ATTR_FIXTURE_CONTRACT);
  const operation = button.getAttribute(ATTR_OPERATION);
  const entityKey = button.getAttribute(ATTR_ENTITY_KEY);
  const currentVisibility = button.getAttribute(ATTR_CURRENT_VISIBILITY);
  const requestedVisibility = button.getAttribute(ATTR_REQUESTED_VISIBILITY);

  // If button has no semantic fixture metadata (e.g. text-only "Make public"), yield no observation
  if (!fixtureContract && !operation && !entityKey) {
    return null;
  }

  const timeProvider = options?.timestampProvider ?? currentIsoTimestamp;
  const capturedAt = timeProvider();
  const observationId = generateEntityId<"BrowserObservationId">("obs");

  const candidate = {
    schemaVersion: "1.0",
    id: observationId,
    capturedAt,
    page: {
      origin: auth.origin,
      routeId: auth.routeId,
    },
    interaction: {
      kind: "activate",
    },
    element: {
      kind: "button",
      role: "button",
      buttonType: button.type || "button",
    },
    metadata: {
      fixtureContract: fixtureContract ?? "",
      operation: operation ?? "",
      entityKey: entityKey ?? "",
      ...(currentVisibility !== null ? { currentVisibility } : {}),
      ...(requestedVisibility !== null ? { requestedVisibility } : {}),
    },
  };

  const validation = validateBrowserObservation(candidate);
  if (!validation.ok) {
    return null;
  }

  return validation.value;
}
