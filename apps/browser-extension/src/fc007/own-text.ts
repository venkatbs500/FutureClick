/**
 * FC-007 Sprint 1 — bounded direct-child own-text extraction.
 *
 * Never uses subtree textContent / innerText for recognition.
 * Never silently truncates then compares.
 * Never uses childNodes.length — walks retained-native firstChild/nextSibling.
 */

import {
  OWN_TEXT_MAX_CHILD_NODES,
  OWN_TEXT_MAX_RAW_UNITS,
  OWN_TEXT_MAX_TEXT_NODES,
  type RecognitionBudget,
} from "./budget.js";
import {
  FC007_NODE_TEXT,
  nativeFirstChild,
  nativeNextSibling,
  nativeNodeType,
  nativeParentNode,
  nativeTextData,
} from "./native-dom.js";

export type OwnTextResult =
  | { readonly status: "ok"; readonly text: string }
  | { readonly status: "empty" }
  | { readonly status: "over_budget"; readonly reason: string };

function collapseWhitespace(raw: string): string {
  return raw.replace(/[\t\n\r\f\v ]+/g, " ").trim();
}

export type OwnTextOptions = {
  /**
   * Exact privately retained FutureClick preview host. When it is a direct
   * child of `element`, it does not consume OWN_TEXT child-node limits or
   * RecognitionBudget child inspections (ownership accounting only).
   */
  readonly excludeChild?: Node | null;
  /**
   * Test-only: incremented once per direct-child visit during enumeration.
   */
  readonly inspectionCounter?: { count: number };
};

/**
 * Extract normalized own-text from DIRECT Text-node children only.
 * Counts every inspected direct child Node toward optional parent budget.
 */
export function normalizedOwnText(
  element: Element,
  budget?: RecognitionBudget,
  options?: OwnTextOptions,
): OwnTextResult {
  const exclude = options?.excludeChild ?? null;
  const counter = options?.inspectionCounter;

  const excludeIsDirect = exclude != null && nativeParentNode(exclude) === element ? exclude : null;

  let pageChildCount = 0;
  let textNodeCount = 0;
  let rawUnits = 0;
  let raw = "";
  let visited = 0;

  // Direct children only via retained-native sibling chain.
  let child: Node | null = nativeFirstChild(element);
  while (child) {
    visited += 1;
    if (counter) counter.count += 1;

    // Hard stop: too many direct children (including owned host allowance).
    const maxRaw = excludeIsDirect ? OWN_TEXT_MAX_CHILD_NODES + 1 : OWN_TEXT_MAX_CHILD_NODES;
    if (visited > maxRaw) {
      budget?.markOverflow("child-nodes");
      return { status: "over_budget", reason: "CHILD_NODES_EXCEEDED" };
    }

    if (excludeIsDirect && child === excludeIsDirect) {
      child = nativeNextSibling(child);
      continue;
    }

    pageChildCount += 1;
    if (pageChildCount > OWN_TEXT_MAX_CHILD_NODES) {
      budget?.markOverflow("child-nodes");
      return { status: "over_budget", reason: "CHILD_NODES_EXCEEDED" };
    }

    if (budget && !budget.inspectChildNode()) {
      return { status: "over_budget", reason: "GLOBAL_CHILD_NODE_BUDGET" };
    }

    if (nativeNodeType(child) === FC007_NODE_TEXT) {
      textNodeCount += 1;
      if (textNodeCount > OWN_TEXT_MAX_TEXT_NODES) {
        budget?.markOverflow("text-units");
        return { status: "over_budget", reason: "TEXT_NODES_EXCEEDED" };
      }
      const data = nativeTextData(child);
      const units = data.length;
      rawUnits += units;
      if (rawUnits > OWN_TEXT_MAX_RAW_UNITS) {
        budget?.markOverflow("text-units");
        return { status: "over_budget", reason: "RAW_TEXT_EXCEEDED" };
      }
      if (budget && !budget.consumeTextUnits(units)) {
        return { status: "over_budget", reason: "GLOBAL_TEXT_BUDGET" };
      }
      raw += data;
    }

    child = nativeNextSibling(child);
  }

  if (rawUnits === 0) {
    return { status: "empty" };
  }

  const text = collapseWhitespace(raw);
  if (text.length === 0) {
    return { status: "empty" };
  }
  return { status: "ok", text };
}

export function ownTextEquals(
  element: Element,
  expected: string,
  budget?: RecognitionBudget,
  options?: OwnTextOptions,
): OwnTextResult | { readonly status: "mismatch"; readonly text: string } {
  const result = normalizedOwnText(element, budget, options);
  if (result.status !== "ok") return result;
  if (result.text !== expected) {
    return { status: "mismatch", text: result.text };
  }
  return result;
}
