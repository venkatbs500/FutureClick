/**
 * FC-007 Sprint 3A — bounded Stage-D effects-region semantic projection.
 *
 * Authority comes only from the exact V2-recognized effects HTMLDivElement.
 * Supported closed structure: DIV[role=region] with ordered direct Text and/or
 * approved carrier elements.
 *
 * Work budgets are enforced BEFORE attacker-proportional child enumeration.
 * NO global prose sweep, NO innerHTML dump, NO unbounded walker.
 */

import { encodeSeq, encodeString } from "./decision-fingerprint.js";
import { EFFECTS_ARIA_LABEL } from "./v2/effects-region.js";

/** Small domain bounds for the Stage-D effects region only. */
export const EFFECTS_REGION_MAX_ELEMENTS = 16;
export const EFFECTS_REGION_MAX_TEXT_NODES = 24;
export const EFFECTS_REGION_MAX_ITEMS = 12;
export const EFFECTS_REGION_MAX_TEXT_UNITS = 1_024;
/**
 * Max direct children of any inspected node (elements + text + comments).
 * Derived from element+text budgets; comments count as structural work.
 */
export const EFFECTS_REGION_MAX_DIRECT_CHILDREN =
  EFFECTS_REGION_MAX_ELEMENTS + EFFECTS_REGION_MAX_TEXT_NODES;
/** Max nodes visited during structural walk (elements+text+comments+slack). */
export const EFFECTS_REGION_MAX_VISITED =
  EFFECTS_REGION_MAX_ELEMENTS + EFFECTS_REGION_MAX_TEXT_NODES + EFFECTS_REGION_MAX_DIRECT_CHILDREN;
/** Max nodes that may be pending on the traversal stack. */
export const EFFECTS_REGION_MAX_PENDING = EFFECTS_REGION_MAX_DIRECT_CHILDREN + 8;

/** Ordered semantic units preserving document order of mixed text/elements. */
export type Fc007EffectsUnit =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "element"; readonly tag: string; readonly text: string };

export interface Fc007EffectsSnapshot {
  readonly ariaLabel: typeof EFFECTS_ARIA_LABEL;
  /** Ordered normalized semantic units (root text + approved carriers). */
  readonly units: readonly Fc007EffectsUnit[];
}

export type EffectsSemanticsResult =
  | { readonly status: "ok"; readonly snapshot: Fc007EffectsSnapshot; readonly fingerprint: string }
  | { readonly status: "invalid"; readonly reason: string };

export type EffectsProjectionOptions = {
  /**
   * Test-only: incremented once per NodeList.item / index access.
   * Length precheck does not increment.
   */
  readonly inspectionCounter?: { count: number };
};

const APPROVED_CARRIER_TAGS = new Set([
  "P",
  "UL",
  "OL",
  "LI",
  "SPAN",
  "STRONG",
  "EM",
  "B",
  "I",
  "CODE",
  "A",
  "BR",
]);

function deepFreezeOwned<T extends object>(value: T): T {
  if (Object.isFrozen(value)) return value;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (child !== null && typeof child === "object") {
      deepFreezeOwned(child as object);
    }
  }
  return Object.freeze(value);
}

function collapseWhitespace(raw: string): string {
  return raw.replace(/[\t\n\r\f\v ]+/g, " ").trim();
}

function isApprovedCarrier(el: Element): boolean {
  return APPROVED_CARRIER_TAGS.has(el.tagName);
}

function childItem(
  kids: NodeListOf<ChildNode>,
  index: number,
  counter?: { count: number },
): ChildNode | null {
  if (counter) counter.count += 1;
  return kids.item(index);
}

/**
 * Project reviewed effects semantics from the exact Stage-D effects region.
 * Includes direct root Text nodes in document order.
 */
export function projectEffectsSemantics(
  region: HTMLDivElement,
  options?: EffectsProjectionOptions,
): EffectsSemanticsResult {
  if (!(region instanceof HTMLDivElement)) {
    return { status: "invalid", reason: "EFFECTS_NOT_DIV" };
  }
  const aria = (region.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
  if (aria !== EFFECTS_ARIA_LABEL) {
    return { status: "invalid", reason: "EFFECTS_ARIA_MISMATCH" };
  }

  const counter = options?.inspectionCounter;
  let elementCount = 0;
  let textNodeCount = 0;
  let rawUnits = 0;
  const units: Fc007EffectsUnit[] = [];

  // Count the region root as one element.
  elementCount += 1;
  if (elementCount > EFFECTS_REGION_MAX_ELEMENTS) {
    return { status: "invalid", reason: "EFFECTS_ELEMENT_BUDGET" };
  }

  const children = region.childNodes;
  // Cardinality precheck BEFORE any indexed child access.
  if (children.length > EFFECTS_REGION_MAX_DIRECT_CHILDREN) {
    return { status: "invalid", reason: "EFFECTS_DIRECT_CHILD_BUDGET" };
  }

  for (let i = 0; i < children.length; i += 1) {
    const node = childItem(children, i, counter);
    if (!node) return { status: "invalid", reason: "EFFECTS_CHILD_MISSING" };

    if (node.nodeType === Node.COMMENT_NODE) {
      // Comments are structurally allowed but carry no semantic text.
      // They already consumed a direct-child budget slot via length precheck.
      continue;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      textNodeCount += 1;
      if (textNodeCount > EFFECTS_REGION_MAX_TEXT_NODES) {
        return { status: "invalid", reason: "EFFECTS_TEXT_NODE_BUDGET" };
      }
      const data = node.nodeValue ?? "";
      rawUnits += data.length;
      if (rawUnits > EFFECTS_REGION_MAX_TEXT_UNITS) {
        return { status: "invalid", reason: "EFFECTS_UTF16_BUDGET" };
      }
      const text = collapseWhitespace(data);
      if (text.length === 0) continue;
      if (units.length >= EFFECTS_REGION_MAX_ITEMS) {
        return { status: "invalid", reason: "EFFECTS_ITEMS_EXCEEDED" };
      }
      units.push({ kind: "text", text });
      continue;
    }

    if (node.nodeType === Node.ELEMENT_NODE && node instanceof Element) {
      if (!isApprovedCarrier(node)) {
        return { status: "invalid", reason: "EFFECTS_UNSUPPORTED_ELEMENT" };
      }

      const walked = walkCarrierBounded(node, {
        elementCount,
        textNodeCount,
        rawUnits,
        ...(counter ? { counter } : {}),
      });
      if (walked.status === "invalid") return walked;
      elementCount = walked.elementCount;
      textNodeCount = walked.textNodeCount;
      rawUnits = walked.rawUnits;

      if (node.tagName === "BR") {
        continue;
      }

      const own = carrierOwnText(node);
      if (own.status === "invalid") return own;
      if (own.text.length === 0) continue;
      if (units.length >= EFFECTS_REGION_MAX_ITEMS) {
        return { status: "invalid", reason: "EFFECTS_ITEMS_EXCEEDED" };
      }
      units.push({ kind: "element", tag: node.tagName.toLowerCase(), text: own.text });
      continue;
    }

    return { status: "invalid", reason: "EFFECTS_UNSUPPORTED_NODE" };
  }

  const snapshot: Fc007EffectsSnapshot = deepFreezeOwned({
    ariaLabel: EFFECTS_ARIA_LABEL,
    units: Object.freeze(units.map((u) => deepFreezeOwned({ ...u }))),
  });
  return {
    status: "ok",
    snapshot,
    fingerprint: fingerprintEffectsSemantics(snapshot),
  };
}

function walkCarrierBounded(
  root: Element,
  counts: {
    elementCount: number;
    textNodeCount: number;
    rawUnits: number;
    counter?: { count: number };
  },
):
  | {
      readonly status: "ok";
      elementCount: number;
      textNodeCount: number;
      rawUnits: number;
    }
  | { readonly status: "invalid"; readonly reason: string } {
  const doc = root.ownerDocument;
  if (!doc) return { status: "invalid", reason: "EFFECTS_NO_DOCUMENT" };

  const stack: Node[] = [root];
  let elementCount = counts.elementCount;
  let textNodeCount = counts.textNodeCount;
  let rawUnits = counts.rawUnits;
  let visited = 0;
  const counter = counts.counter;

  while (stack.length > 0) {
    visited += 1;
    if (visited > EFFECTS_REGION_MAX_VISITED) {
      return { status: "invalid", reason: "EFFECTS_VISIT_BUDGET" };
    }
    const node = stack.pop();
    if (!node) continue;

    if (node.nodeType === Node.ELEMENT_NODE && node instanceof Element) {
      if (node !== root && !isApprovedCarrier(node)) {
        return { status: "invalid", reason: "EFFECTS_UNSUPPORTED_ELEMENT" };
      }
      elementCount += 1;
      if (elementCount > EFFECTS_REGION_MAX_ELEMENTS) {
        return { status: "invalid", reason: "EFFECTS_ELEMENT_BUDGET" };
      }

      const kids = node.childNodes;
      // Cardinality precheck BEFORE any indexed child access / stack growth.
      if (kids.length > EFFECTS_REGION_MAX_DIRECT_CHILDREN) {
        return { status: "invalid", reason: "EFFECTS_DIRECT_CHILD_BUDGET" };
      }
      if (stack.length + kids.length > EFFECTS_REGION_MAX_PENDING) {
        return { status: "invalid", reason: "EFFECTS_PENDING_BUDGET" };
      }

      // Reverse indexed push preserves document order for DFS validation.
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        const child = childItem(kids, i, counter);
        if (!child) return { status: "invalid", reason: "EFFECTS_CHILD_MISSING" };
        stack.push(child);
      }
      continue;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      textNodeCount += 1;
      if (textNodeCount > EFFECTS_REGION_MAX_TEXT_NODES) {
        return { status: "invalid", reason: "EFFECTS_TEXT_NODE_BUDGET" };
      }
      const data = node.nodeValue ?? "";
      rawUnits += data.length;
      if (rawUnits > EFFECTS_REGION_MAX_TEXT_UNITS) {
        return { status: "invalid", reason: "EFFECTS_UTF16_BUDGET" };
      }
      continue;
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      // Structural only — already bounded by direct-child / pending / visit caps.
      continue;
    }
    return { status: "invalid", reason: "EFFECTS_UNSUPPORTED_NODE" };
  }

  return { status: "ok", elementCount, textNodeCount, rawUnits };
}

/**
 * Carrier own-text: concatenate descendant text of an approved carrier
 * in document order with whitespace collapse. Structure already budget-checked.
 */
function carrierOwnText(
  el: Element,
):
  | { readonly status: "ok"; readonly text: string }
  | { readonly status: "invalid"; readonly reason: string } {
  const doc = el.ownerDocument;
  if (!doc) return { status: "invalid", reason: "EFFECTS_NO_DOCUMENT" };
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let raw = "";
  let node: Node | null = walker.nextNode();
  let steps = 0;
  while (node) {
    steps += 1;
    if (steps > EFFECTS_REGION_MAX_TEXT_NODES) {
      return { status: "invalid", reason: "EFFECTS_TEXT_NODE_BUDGET" };
    }
    raw += node.nodeValue ?? "";
    node = walker.nextNode();
  }
  return { status: "ok", text: collapseWhitespace(raw) };
}

export function fingerprintEffectsSemantics(snapshot: Fc007EffectsSnapshot): string {
  const aria = encodeString(snapshot.ariaLabel);
  if (typeof aria !== "string") return `INVALID:${aria.error}`;
  const unitParts: string[] = [];
  for (const unit of snapshot.units) {
    if (unit.kind === "text") {
      const t = encodeString(unit.text);
      if (typeof t !== "string") return `INVALID:${t.error}`;
      const enc = encodeSeq(["T", t]);
      if (typeof enc !== "string") return `INVALID:${enc.error}`;
      unitParts.push(enc);
    } else {
      const tag = encodeString(unit.tag);
      if (typeof tag !== "string") return `INVALID:${tag.error}`;
      const t = encodeString(unit.text);
      if (typeof t !== "string") return `INVALID:${t.error}`;
      const enc = encodeSeq(["E", tag, t]);
      if (typeof enc !== "string") return `INVALID:${enc.error}`;
      unitParts.push(enc);
    }
  }
  const unitsEnc = encodeSeq(unitParts);
  if (typeof unitsEnc !== "string") return `INVALID:${unitsEnc.error}`;
  const full = encodeSeq([aria, unitsEnc]);
  return typeof full === "string" ? full : `INVALID:${full.error}`;
}
