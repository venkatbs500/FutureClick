/**
 * FC-007 Sprint 2 — exact privately retained preview-host contract.
 *
 * Ownership is exact object identity only. No tag/class/id/text exemption.
 * Empty light DOM is O(1) via retained-native firstChild === null.
 */

import { nativeFirstChild, nativeParentElement } from "./native-dom.js";

/** Approved page-controlled dialog element budget (unchanged). */
export { DIALOG_MAX_ELEMENTS as FC007_DIALOG_PAGE_ELEMENT_MAX } from "./budget.js";

/**
 * Strict invariant for the ONE FutureClick-owned preview host.
 * Returns null when valid; otherwise an abstain reason.
 */
export function ownedPreviewHostInvariantFailure(
  host: Element,
  expectedDialog: HTMLDialogElement,
  retainedDocument: Document,
): string | null {
  if (typeof HTMLDivElement === "undefined") return "OWNED_HOST_DIV_UNAVAILABLE";
  if (!(host instanceof HTMLDivElement)) return "OWNED_HOST_NOT_DIV";
  if (host.ownerDocument !== retainedDocument) return "OWNED_HOST_DOCUMENT";
  if (!host.isConnected) return "OWNED_HOST_DISCONNECTED";
  if (nativeParentElement(host) !== expectedDialog) return "OWNED_HOST_PARENT";
  // O(1): any light-DOM child fails — never enumerate descendants.
  if (nativeFirstChild(host) !== null) return "OWNED_HOST_LIGHT_CHILDREN";
  // No externally meaningful attributes (styling via :host in closed shadow).
  if (host.attributes.length !== 0) return "OWNED_HOST_ATTRIBUTES";
  return null;
}

export function isValidOwnedPreviewHost(
  host: Element,
  expectedDialog: HTMLDialogElement,
  retainedDocument: Document,
): boolean {
  return ownedPreviewHostInvariantFailure(host, expectedDialog, retainedDocument) === null;
}
