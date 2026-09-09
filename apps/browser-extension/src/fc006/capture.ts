/**
 * FC-006 Local Capture & Authorization Boundary
 *
 * Epistemological Boundary:
 * Extension-local capture for the FC-006 interception fixture.
 * Produces frozen BrowserObservation v1.0 using public validators.
 *
 * Sprint 1 invariants:
 * - NEVER calls preventDefault(), stopPropagation(), or stopImmediatePropagation().
 * - No preview, lifecycle, Cancel, Continue, or continuation.
 * - Exact authorized location only.
 * - Allowlisted data-futureclick-* attributes individually; zero dataset enumeration.
 */

import {
  type BrowserObservation,
  assessControlPrivacy,
  validateBrowserObservation,
} from "@futureclick/browser-adapter";
import { type IsoTimestamp, currentIsoTimestamp, generateEntityId } from "@futureclick/shared";
import {
  FC006_FIXTURE_CONTRACT,
  FC006_ORIGIN,
  FC006_ROUTE_ID,
} from "./synthetic-repository-interception-adapter.js";

export const ATTR_FIXTURE_CONTRACT = "data-futureclick-fixture-contract";
export const ATTR_OPERATION = "data-futureclick-operation";
export const ATTR_ENTITY_KEY = "data-futureclick-entity-key";
export const ATTR_CURRENT_VISIBILITY = "data-futureclick-current-visibility";
export const ATTR_REQUESTED_VISIBILITY = "data-futureclick-requested-visibility";

export const FC006_AUTHORIZED_PATHNAME = "/fc006/repository-visibility-interception.html";
/** Max hops from event target down/up to the candidate button (unchanged). */
export const MAX_ACTIVATION_ANCESTOR_HOPS = 4;
/**
 * Max Element ancestors inspected ABOVE a resolved button for disabled-fieldset /
 * editable exclusions. Exceeding this bound before the light-DOM root fails closed.
 *
 * Definition: successive `parentElement` Element nodes starting at
 * `button.parentElement`. `documentElement` / body / wrappers all count.
 * Termination: `parentElement === null` (light-DOM document/root boundary).
 * Theoretical maximum `parentElement` reads per inspection: MAX + 1 (= 9).
 */
export const MAX_BUTTON_ANCESTOR_INSPECTION_HOPS = 8;

export interface Fc006UrlAuthorizationComponents {
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
}

export interface Fc006UrlAuthorizationResult {
  readonly authorized: boolean;
  readonly origin?: string | undefined;
  readonly routeId?: string | undefined;
  readonly rejectionReason?: string | undefined;
}

/**
 * Authorizes a location strictly against the exact local FC-006 fixture boundary.
 * Never retains query strings, fragments, or credentials.
 */
export function authorizeFc006FixtureLocation(
  components: Fc006UrlAuthorizationComponents,
): Fc006UrlAuthorizationResult {
  if (components.protocol !== "http:") {
    return { authorized: false, rejectionReason: "UNAUTHORIZED_PROTOCOL" };
  }
  if (components.hostname !== "127.0.0.1") {
    return { authorized: false, rejectionReason: "UNAUTHORIZED_HOSTNAME" };
  }
  if (components.port !== "4173") {
    return { authorized: false, rejectionReason: "UNAUTHORIZED_PORT" };
  }
  if (components.pathname !== FC006_AUTHORIZED_PATHNAME) {
    return { authorized: false, rejectionReason: "UNAUTHORIZED_PATHNAME" };
  }

  return {
    authorized: true,
    origin: FC006_ORIGIN,
    routeId: FC006_ROUTE_ID,
  };
}

export function isFc006LocationAuthorized(location: Location): boolean {
  return authorizeFc006FixtureLocation({
    protocol: location.protocol,
    hostname: location.hostname,
    port: location.port,
    pathname: location.pathname,
  }).authorized;
}

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

function isDisabledFieldset(node: Element): boolean {
  if (typeof HTMLFieldSetElement !== "undefined" && node instanceof HTMLFieldSetElement) {
    return node.disabled;
  }
  if (node.tagName.toLowerCase() === "fieldset") {
    return (node as HTMLFieldSetElement).disabled === true;
  }
  return false;
}

export interface ButtonAncestorInspectionResult {
  readonly ok: boolean;
  /** Number of `parentElement` reads performed during this inspection. */
  readonly ancestorReads: number;
  readonly rejectionReason?:
    | "DISABLED_FIELDSET_ANCESTOR"
    | "EDITABLE_ANCESTOR"
    | "ANCESTRY_DEPTH_EXCEEDED"
    | "UNSUPPORTED_BOUNDARY"
    | undefined;
}

export interface ButtonAncestorInspectionOptions {
  /** Invoked once per `parentElement` read with the resulting parent (may be null). */
  readonly onParentRead?: ((parent: Element | null, readIndex: number) => void) | undefined;
}

/**
 * Single bounded light-DOM ancestry inspection above a resolved button.
 * Checks disabled-fieldset and editable exclusions in one pass.
 * Fail-closed if ancestry depth exceeds MAX_BUTTON_ANCESTOR_INSPECTION_HOPS
 * before reaching the document/root boundary (`parentElement === null`).
 */
export function inspectResolvedButtonAncestors(
  button: Element,
  options?: ButtonAncestorInspectionOptions,
): ButtonAncestorInspectionResult {
  let ancestorReads = 0;
  let inspected = 0;

  let curr: Element | null = button.parentElement;
  ancestorReads += 1;
  options?.onParentRead?.(curr, ancestorReads);

  while (curr !== null) {
    inspected += 1;
    if (inspected > MAX_BUTTON_ANCESTOR_INSPECTION_HOPS) {
      return {
        ok: false,
        ancestorReads,
        rejectionReason: "ANCESTRY_DEPTH_EXCEEDED",
      };
    }

    if (!(curr instanceof Element)) {
      return {
        ok: false,
        ancestorReads,
        rejectionReason: "UNSUPPORTED_BOUNDARY",
      };
    }

    if (isDisabledFieldset(curr)) {
      return {
        ok: false,
        ancestorReads,
        rejectionReason: "DISABLED_FIELDSET_ANCESTOR",
      };
    }

    if (isNodeContentEditable(curr)) {
      return {
        ok: false,
        ancestorReads,
        rejectionReason: "EDITABLE_ANCESTOR",
      };
    }

    const next: Element | null = curr.parentElement;
    ancestorReads += 1;
    options?.onParentRead?.(next, ancestorReads);
    curr = next;
  }

  return { ok: true, ancestorReads };
}

/**
 * Conservatively resolves the activation target to a supported native button element.
 * Rejects detached nodes, disabled buttons/fieldset children, non-buttons,
 * contenteditable elements/ancestors, and controls beyond the bounded ancestor depth.
 * Light DOM only; does not use Element.closest().
 */
export function resolveFc006ActivationButton(target: EventTarget | null): HTMLButtonElement | null {
  if (!target || typeof Node === "undefined" || !(target instanceof Node)) {
    return null;
  }

  if (!target.isConnected) {
    return null;
  }

  if (typeof document !== "undefined" && target.ownerDocument !== document) {
    return null;
  }

  if (isNodeContentEditable(target)) {
    return null;
  }

  let curr: Node | null = target;
  let hops = 0;
  let buttonElem: HTMLButtonElement | null = null;

  while (curr !== null && hops <= MAX_ACTIVATION_ANCESTOR_HOPS) {
    if (isNodeContentEditable(curr)) {
      return null;
    }

    if (typeof HTMLButtonElement !== "undefined" && curr instanceof HTMLButtonElement) {
      buttonElem = curr;
      break;
    }

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

  if (
    !buttonElem.isConnected ||
    (typeof document !== "undefined" && buttonElem.ownerDocument !== document)
  ) {
    return null;
  }

  if (buttonElem.type !== "button") {
    return null;
  }

  if (buttonElem.disabled) {
    return null;
  }

  if (isNodeContentEditable(buttonElem)) {
    return null;
  }

  // Single bounded post-button ancestry inspection (fieldset + editable).
  const ancestry = inspectResolvedButtonAncestors(buttonElem);
  if (!ancestry.ok) {
    return null;
  }

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

export interface CaptureFc006ObservationOptions {
  readonly timestampProvider?: (() => IsoTimestamp) | undefined;
}

/**
 * Synchronously captures an allowlisted metadata snapshot from an FC-006 button.
 * Returns null if location is unauthorized, metadata absent, or validation fails.
 */
export function captureFc006ButtonObservation(
  button: HTMLButtonElement,
  location: Location,
  options?: CaptureFc006ObservationOptions,
): BrowserObservation | null {
  const auth = authorizeFc006FixtureLocation({
    protocol: location.protocol,
    hostname: location.hostname,
    port: location.port,
    pathname: location.pathname,
  });

  if (!auth.authorized || !auth.origin || !auth.routeId) {
    return null;
  }

  const fixtureContract = button.getAttribute(ATTR_FIXTURE_CONTRACT);
  const operation = button.getAttribute(ATTR_OPERATION);
  const entityKey = button.getAttribute(ATTR_ENTITY_KEY);
  const currentVisibility = button.getAttribute(ATTR_CURRENT_VISIBILITY);
  const requestedVisibility = button.getAttribute(ATTR_REQUESTED_VISIBILITY);

  if (!fixtureContract && !operation && !entityKey) {
    return null;
  }

  // Sprint 1 capture is FC-006-specific; reject non-FC-006 contracts early.
  if (fixtureContract !== null && fixtureContract !== FC006_FIXTURE_CONTRACT) {
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
