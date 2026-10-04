/**
 * FC-007 Sprint 1 — Settings visibility section recognition.
 */

import {
  MAIN_MAX_ELEMENTS,
  PRIVATE_TO_LI_MAX_HOPS,
  RecognitionBudget,
  SETTINGS_MAX_TEXT_UNITS,
  VISIBILITY_SECTION_MAX_ELEMENTS,
  VISIBILITY_SECTION_MAX_TEXT_UNITS,
} from "./budget.js";
import { normalizedOwnText } from "./own-text.js";

export const VISIBILITY_HEADING_TEXT = "Change repository visibility";
export const CURRENT_PRIVATE_TEXT = "This repository is currently private.";

export interface VisibilitySectionRecognition {
  readonly main: HTMLElement;
  readonly section: HTMLLIElement;
  readonly privateStateElement: HTMLDivElement;
  readonly headingElement: Element;
}

export type VisibilityRecognizeResult =
  | { readonly status: "matched"; readonly value: VisibilitySectionRecognition }
  | { readonly status: "abstain"; readonly reason: string };

function nearestLiWithinHops(el: Element, maxHops: number): HTMLLIElement | null {
  let cur: Element | null = el;
  for (let hops = 0; hops <= maxHops; hops += 1) {
    if (!cur) return null;
    if (cur instanceof HTMLLIElement) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function elementBelongsToLi(el: Element, li: HTMLLIElement, maxHops: number): boolean {
  let cur: Element | null = el;
  for (let hops = 0; hops <= maxHops; hops += 1) {
    if (!cur) return false;
    if (cur === li) return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Completely inspect one LI visibility section. Uniqueness asserted only if walk finishes.
 */
export function inspectVisibilityLiComplete(
  li: HTMLLIElement,
  settingsBudget?: RecognitionBudget,
  retainedMain?: HTMLElement,
): VisibilityRecognizeResult {
  const local = new RecognitionBudget(
    VISIBILITY_SECTION_MAX_ELEMENTS,
    VISIBILITY_SECTION_MAX_TEXT_UNITS,
  );

  let heading: Element | null = null;
  let privateDiv: HTMLDivElement | null = null;
  let headingCount = 0;
  let privateCount = 0;

  const walker = li.ownerDocument.createTreeWalker(li, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;

  while (node) {
    if (!(node instanceof Element)) {
      node = walker.nextNode();
      continue;
    }
    if (!local.visitElement()) {
      return { status: "abstain", reason: "VISIBILITY_SECTION_BUDGET_EXHAUSTED" };
    }

    const own = normalizedOwnText(node, local);
    if (own.status === "over_budget") {
      return { status: "abstain", reason: "VISIBILITY_SECTION_OWN_TEXT_OVER_BUDGET" };
    }
    if (own.status === "ok") {
      if (own.text === VISIBILITY_HEADING_TEXT) {
        headingCount += 1;
        heading = node;
      }
      if (node instanceof HTMLDivElement && own.text === CURRENT_PRIVATE_TEXT) {
        privateCount += 1;
        privateDiv = node;
      }
    }

    node = walker.nextNode();
  }

  if (local.isOverflowed) {
    return { status: "abstain", reason: "VISIBILITY_SECTION_INCOMPLETE" };
  }
  if (headingCount !== 1 || !heading) {
    return { status: "abstain", reason: "VISIBILITY_HEADING_COUNT" };
  }
  if (privateCount !== 1 || !privateDiv) {
    return { status: "abstain", reason: "VISIBILITY_PRIVATE_COUNT" };
  }
  if (!elementBelongsToLi(heading, li, PRIVATE_TO_LI_MAX_HOPS)) {
    return { status: "abstain", reason: "VISIBILITY_HEADING_NOT_IN_SECTION" };
  }
  if (nearestLiWithinHops(privateDiv, PRIVATE_TO_LI_MAX_HOPS) !== li) {
    return { status: "abstain", reason: "VISIBILITY_PRIVATE_LI_MISMATCH" };
  }

  if (settingsBudget && !settingsBudget.consumeTextUnits(local.textUnitCount)) {
    return { status: "abstain", reason: "SETTINGS_TEXT_BUDGET_EXHAUSTED" };
  }

  let main: HTMLElement;
  if (retainedMain) {
    main = retainedMain;
  } else {
    const found = li.ownerDocument.querySelector("main");
    if (!(found instanceof HTMLElement)) {
      return { status: "abstain", reason: "MAIN_ABSENT" };
    }
    main = found;
  }

  return {
    status: "matched",
    value: {
      main,
      section: li,
      privateStateElement: privateDiv,
      headingElement: heading,
    },
  };
}

/**
 * Acquire main and recognize exactly one visibility section.
 */
export function recognizeVisibilitySection(doc: Document): VisibilityRecognizeResult {
  const main = doc.querySelector("main");
  if (!(main instanceof HTMLElement)) {
    return { status: "abstain", reason: "MAIN_ABSENT" };
  }

  const budget = new RecognitionBudget(MAIN_MAX_ELEMENTS, SETTINGS_MAX_TEXT_UNITS);
  const privateCandidates: HTMLDivElement[] = [];

  const walker = doc.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;

  while (node) {
    if (!(node instanceof Element)) {
      node = walker.nextNode();
      continue;
    }
    if (!budget.visitElement()) {
      return { status: "abstain", reason: "MAIN_ELEMENT_BUDGET_EXHAUSTED" };
    }

    const own = normalizedOwnText(node, budget);
    if (own.status === "over_budget") {
      return { status: "abstain", reason: "SETTINGS_OWN_TEXT_OVER_BUDGET" };
    }
    if (
      own.status === "ok" &&
      node instanceof HTMLDivElement &&
      own.text === CURRENT_PRIVATE_TEXT
    ) {
      privateCandidates.push(node);
    }

    node = walker.nextNode();
  }

  if (budget.isOverflowed) {
    return { status: "abstain", reason: "MAIN_TRAVERSAL_INCOMPLETE" };
  }

  if (privateCandidates.length === 0) {
    return { status: "abstain", reason: "VISIBILITY_PRIVATE_NOT_FOUND" };
  }
  if (privateCandidates.length > 1) {
    // May still resolve to same LI — check.
    const lis = new Set<HTMLLIElement>();
    for (const div of privateCandidates) {
      const li = nearestLiWithinHops(div, PRIVATE_TO_LI_MAX_HOPS);
      if (!li) return { status: "abstain", reason: "VISIBILITY_PRIVATE_LI_HOPS" };
      lis.add(li);
    }
    if (lis.size !== 1) {
      return { status: "abstain", reason: "DUPLICATE_VISIBILITY_PRIVATE" };
    }
  }

  const firstPrivate = privateCandidates[0];
  if (!firstPrivate) {
    return { status: "abstain", reason: "VISIBILITY_PRIVATE_NOT_FOUND" };
  }
  const section = nearestLiWithinHops(firstPrivate, PRIVATE_TO_LI_MAX_HOPS);
  if (!section) {
    return { status: "abstain", reason: "VISIBILITY_PRIVATE_LI_HOPS" };
  }

  // Complete local LI inspection asserts heading+private uniqueness inside section.
  // Pass the already-retained main — do not re-query.
  return inspectVisibilityLiComplete(section, budget, main);
}
