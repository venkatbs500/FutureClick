/**
 * FC-007 Sprint 1D V2 — Effects acknowledgement region predicate.
 *
 * Uniqueness is evaluated only over a bounded page-controlled element list.
 * Callers must not invoke an unbounded dialog walk before this.
 */

import {
  inventoryDialogPageElements,
  type DialogPageInventoryOptions,
} from "./dialog-page-elements.js";

function normalizeAriaLabel(raw: string | null): string | null {
  if (raw == null) return null;
  return raw.replace(/\s+/g, " ").trim();
}

function normalizeRoleTokens(raw: string | null): string[] {
  if (raw == null || raw.trim() === "") return [];
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter((t) => t.length > 0);
}

export const EFFECTS_ARIA_LABEL = "Effects of making this repository public";

export function isExactEffectsRegionElement(
  node: Element,
  retainedDocument: Document,
): node is HTMLDivElement {
  if (!(node instanceof HTMLDivElement)) return false;
  if (node.ownerDocument !== retainedDocument) return false;
  const roles = normalizeRoleTokens(node.getAttribute("role"));
  const tabindex = node.getAttribute("tabindex");
  const aria = normalizeAriaLabel(node.getAttribute("aria-label"));
  return (
    roles.length === 1 && roles[0] === "region" && tabindex === "-1" && aria === EFFECTS_ARIA_LABEL
  );
}

/**
 * Exactly one HTMLDivElement with role=region, exact aria-label, tabindex="-1"
 * among the provided (already bounded) elements.
 */
export function findExactEffectsRegionInElements(
  elements: readonly Element[],
  retainedDocument: Document,
): HTMLDivElement | null {
  const matches: HTMLDivElement[] = [];
  for (const node of elements) {
    if (isExactEffectsRegionElement(node, retainedDocument)) {
      matches.push(node);
      if (matches.length > 1) return null;
    }
  }
  if (matches.length !== 1) return null;
  return matches[0] ?? null;
}

/**
 * Bounded effects-region discovery: inventory page-controlled dialog elements
 * (DIALOG_MAX_ELEMENTS + overflow abort) before uniqueness matching.
 */
export function findExactEffectsRegion(
  dialog: Element,
  retainedDocument: Document,
  options?: DialogPageInventoryOptions,
): HTMLDivElement | null {
  const inv = inventoryDialogPageElements(dialog, options);
  if (inv.status !== "ok") return null;
  return findExactEffectsRegionInElements(inv.elements, retainedDocument);
}
