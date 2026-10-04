/**
 * FC-007H — scoped V2 Settings visibility acquisition.
 *
 * Global: bounded main structural walk (retained-native pointers);
 * own-text only on H1–H6, exact single-token role=heading, and HTMLStrongElement.
 * Local: retained LI structural walk; own-text only on HTMLDivElement
 * for exact private-state proof.
 *
 * Unique <main> comes from the completed bounded document inventory —
 * never querySelectorAll("main").
 */

import {
  MAIN_MAX_ELEMENTS_V2,
  MAIN_MAX_NODE_VISITS_V2,
  PRIVATE_TO_LI_MAX_HOPS,
  RecognitionBudget,
  SETTINGS_ANCHOR_TEXT_MAX,
  VISIBILITY_LI_MAX_NODE_VISITS_V2,
  VISIBILITY_SECTION_MAX_ELEMENTS,
  VISIBILITY_SECTION_MAX_TEXT_UNITS,
} from "../budget.js";
import {
  FC007_NODE_ELEMENT,
  nativeContains,
  nativeFirstChild,
  nativeNextSibling,
  nativeNodeType,
  nativeParentElement,
} from "../native-dom.js";
import { normalizedOwnText } from "../own-text.js";
import { CURRENT_PRIVATE_TEXT, VISIBILITY_HEADING_TEXT } from "../visibility-section.js";
import type { DocumentInventoryResult } from "./document-inventory-v2.js";
import { inventoryDocumentV2 } from "./document-inventory-v2.js";

export { CURRENT_PRIVATE_TEXT, VISIBILITY_HEADING_TEXT };

export type VisibilityRecognizeResultV2 =
  | {
      readonly status: "matched";
      readonly value: {
        readonly main: HTMLElement;
        readonly section: HTMLLIElement;
        readonly privateStateElement: HTMLDivElement;
        readonly headingElement: Element;
      };
    }
  | { readonly status: "abstain"; readonly reason: string };

export type VisibilityRecognizeOptionsV2 = {
  /** Precomputed bounded document inventory (capture reuse). */
  readonly documentInventory?: DocumentInventoryResult;
};

/**
 * Resolve nearest HTMLLIElement within <=maxHops without crossing retained main.
 * Uses retained-native parent walks + contains.
 */
function nearestLiWithinMainHops(
  el: Element,
  retainedMain: HTMLElement,
  maxHops: number,
): HTMLLIElement | null {
  let cur: Element | null = el;
  for (let hops = 0; hops <= maxHops; hops += 1) {
    if (!cur) return null;
    if (cur === retainedMain) return null;
    if (!nativeContains(retainedMain, cur)) return null;
    if (cur instanceof HTMLLIElement) {
      return nativeContains(retainedMain, cur) ? cur : null;
    }
    cur = nativeParentElement(cur);
  }
  return null;
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

/** Approved global visibility-anchor carriers only (no HTMLDivElement). */
function isGlobalAnchorCarrier(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  if (/^H[1-6]$/.test(tag)) return true;
  if (tag === "STRONG") return true;
  const tokens = normalizeRoleTokens(el.getAttribute("role"));
  return tokens.length === 1 && tokens[0] === "heading";
}

function mapGlobalAnchorOwnTextOverBudget(reason: string): string {
  if (reason === "GLOBAL_TEXT_BUDGET") return "SETTINGS_ANCHOR_TEXT_BUDGET_EXHAUSTED";
  return "SETTINGS_ANCHOR_OWN_TEXT_OVER_BUDGET";
}

function mapLocalDivOwnTextOverBudget(reason: string): string {
  if (reason === "GLOBAL_TEXT_BUDGET") return "VISIBILITY_LOCAL_TEXT_BUDGET_EXHAUSTED";
  return "VISIBILITY_LOCAL_OWN_TEXT_OVER_BUDGET";
}

/**
 * Bounded pointer walk under `root` with element + total-node caps.
 * Calls `onElement` for each element; returns abstain reason on overflow.
 */
function walkSubtreeBounded(
  root: Element,
  maxElements: number,
  maxNodes: number,
  onElement: (el: Element) => string | null,
): string | null {
  let nodeVisits = 0;
  let elementVisits = 0;
  const stack: Node[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;

    nodeVisits += 1;
    if (nodeVisits > maxNodes) {
      return "NODE_BUDGET";
    }

    if (nativeNodeType(node) === FC007_NODE_ELEMENT) {
      const el = node as Element;
      elementVisits += 1;
      if (elementVisits > maxElements) {
        return "ELEMENT_BUDGET";
      }
      const early = onElement(el);
      if (early) return early;
    }

    if (node !== root) {
      const ns = nativeNextSibling(node);
      if (ns) stack.push(ns);
    }
    const fc = nativeFirstChild(node);
    if (fc) stack.push(fc);
  }
  return null;
}

/**
 * Complete bounded LI walk: structural visits for every node;
 * own-text only on HTMLDivElement for private-state uniqueness.
 */
function inspectVisibilityLiLocalV2(
  li: HTMLLIElement,
  retainedMain: HTMLElement,
  retainedAnchor: Element,
): VisibilityRecognizeResultV2 {
  if (!nativeContains(retainedMain, li) || !nativeContains(retainedMain, retainedAnchor)) {
    return { status: "abstain", reason: "VISIBILITY_CONTAINER_LI_MISMATCH" };
  }
  if (nearestLiWithinMainHops(retainedAnchor, retainedMain, PRIVATE_TO_LI_MAX_HOPS) !== li) {
    return { status: "abstain", reason: "VISIBILITY_CONTAINER_LI_MISMATCH" };
  }

  const local = new RecognitionBudget(
    VISIBILITY_SECTION_MAX_ELEMENTS,
    VISIBILITY_SECTION_MAX_TEXT_UNITS,
  );

  const privateMatches: HTMLDivElement[] = [];

  const overflow = walkSubtreeBounded(
    li,
    VISIBILITY_SECTION_MAX_ELEMENTS,
    VISIBILITY_LI_MAX_NODE_VISITS_V2,
    (node) => {
      if (!local.visitElement()) {
        return "VISIBILITY_LOCAL_ELEMENT_BUDGET_EXHAUSTED";
      }
      if (node instanceof HTMLDivElement) {
        const own = normalizedOwnText(node, local);
        if (own.status === "over_budget") {
          return mapLocalDivOwnTextOverBudget(own.reason);
        }
        if (own.status === "ok" && own.text === CURRENT_PRIVATE_TEXT) {
          privateMatches.push(node);
        }
      }
      return null;
    },
  );

  if (overflow === "NODE_BUDGET") {
    return { status: "abstain", reason: "VISIBILITY_LOCAL_NODE_BUDGET_EXHAUSTED" };
  }
  if (overflow === "ELEMENT_BUDGET" || overflow === "VISIBILITY_LOCAL_ELEMENT_BUDGET_EXHAUSTED") {
    return { status: "abstain", reason: "VISIBILITY_LOCAL_ELEMENT_BUDGET_EXHAUSTED" };
  }
  if (overflow) {
    return { status: "abstain", reason: overflow };
  }

  if (local.isOverflowed) {
    return { status: "abstain", reason: "VISIBILITY_LOCAL_ELEMENT_BUDGET_EXHAUSTED" };
  }

  if (privateMatches.length !== 1) {
    return { status: "abstain", reason: "VISIBILITY_PRIVATE_SIGNAL_NOT_UNIQUE" };
  }

  const privateDiv = privateMatches[0];
  if (!privateDiv) {
    return { status: "abstain", reason: "VISIBILITY_PRIVATE_SIGNAL_NOT_UNIQUE" };
  }

  if (
    !nativeContains(retainedMain, privateDiv) ||
    !nativeContains(li, privateDiv) ||
    nearestLiWithinMainHops(privateDiv, retainedMain, PRIVATE_TO_LI_MAX_HOPS) !== li
  ) {
    return { status: "abstain", reason: "VISIBILITY_CONTAINER_LI_MISMATCH" };
  }

  return {
    status: "matched",
    value: {
      main: retainedMain,
      section: li,
      privateStateElement: privateDiv,
      headingElement: retainedAnchor,
    },
  };
}

function resolveUniqueMain(
  doc: Document,
  options?: VisibilityRecognizeOptionsV2,
): VisibilityRecognizeResultV2 | { readonly status: "main"; readonly main: HTMLElement } {
  const inv = options?.documentInventory ?? inventoryDocumentV2(doc);
  if (inv.status === "abstain") {
    if (inv.reason === "MAIN_NOT_UNIQUE") {
      return { status: "abstain", reason: "MAIN_NOT_UNIQUE" };
    }
    if (inv.reason === "DIALOG_COLLECTION_TOO_LARGE") {
      // Document overflow on dialogs before unique main proven — still fail closed.
      return { status: "abstain", reason: inv.reason };
    }
    return { status: "abstain", reason: inv.reason };
  }
  if (inv.mains.length === 0) {
    return { status: "abstain", reason: "MAIN_ABSENT" };
  }
  if (inv.mains.length !== 1) {
    return { status: "abstain", reason: "MAIN_NOT_UNIQUE" };
  }
  const main = inv.mains[0];
  if (!(main instanceof HTMLElement)) {
    return { status: "abstain", reason: "MAIN_ABSENT" };
  }
  return { status: "main", main };
}

/**
 * FC-007H scoped V2 acquisition: unique main + complete structural walk +
 * unique anchor + nearest in-main LI + local private DIV uniqueness.
 */
export function recognizeVisibilitySectionV2(
  doc: Document,
  options?: VisibilityRecognizeOptionsV2,
): VisibilityRecognizeResultV2 {
  const mainResult = resolveUniqueMain(doc, options);
  if (mainResult.status !== "main") return mainResult;
  const main = mainResult.main;

  const budget = new RecognitionBudget(MAIN_MAX_ELEMENTS_V2, SETTINGS_ANCHOR_TEXT_MAX);
  const anchorMatches: Element[] = [];

  const overflow = walkSubtreeBounded(
    main,
    MAIN_MAX_ELEMENTS_V2,
    MAIN_MAX_NODE_VISITS_V2,
    (node) => {
      if (!budget.visitElement()) {
        return "MAIN_ELEMENT_BUDGET_EXHAUSTED";
      }
      if (isGlobalAnchorCarrier(node)) {
        const own = normalizedOwnText(node, budget);
        if (own.status === "over_budget") {
          return mapGlobalAnchorOwnTextOverBudget(own.reason);
        }
        if (own.status === "ok" && own.text === VISIBILITY_HEADING_TEXT) {
          anchorMatches.push(node);
        }
      }
      return null;
    },
  );

  if (overflow === "NODE_BUDGET") {
    return { status: "abstain", reason: "MAIN_NODE_BUDGET_EXHAUSTED" };
  }
  if (overflow === "ELEMENT_BUDGET" || overflow === "MAIN_ELEMENT_BUDGET_EXHAUSTED") {
    return { status: "abstain", reason: "MAIN_ELEMENT_BUDGET_EXHAUSTED" };
  }
  if (overflow) {
    return { status: "abstain", reason: overflow };
  }

  if (budget.isOverflowed) {
    return { status: "abstain", reason: "MAIN_ELEMENT_BUDGET_EXHAUSTED" };
  }

  if (anchorMatches.length === 0) {
    return { status: "abstain", reason: "VISIBILITY_ANCHOR_NOT_FOUND" };
  }
  if (anchorMatches.length !== 1) {
    return { status: "abstain", reason: "VISIBILITY_ANCHOR_NOT_UNIQUE" };
  }

  const anchor = anchorMatches[0];
  if (!anchor || !nativeContains(main, anchor)) {
    return { status: "abstain", reason: "VISIBILITY_ANCHOR_NOT_FOUND" };
  }

  const section = nearestLiWithinMainHops(anchor, main, PRIVATE_TO_LI_MAX_HOPS);
  if (!section || !nativeContains(main, section)) {
    return { status: "abstain", reason: "VISIBILITY_CONTAINER_LI_MISMATCH" };
  }

  return inspectVisibilityLiLocalV2(section, main, anchor);
}
