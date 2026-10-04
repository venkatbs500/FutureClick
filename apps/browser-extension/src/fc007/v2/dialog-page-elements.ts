/**
 * FC-007 V2 — bounded page-controlled dialog element inventory.
 *
 * Retained-native Node.prototype firstChild / nextSibling via Reflect.apply.
 * Never uses ordinary inherited properties (form named-property safe).
 * Never uses HTMLCollection / Element child-list APIs / TreeWalker.
 */

import { DIALOG_MAX_ELEMENTS, DIALOG_MAX_NODE_VISITS } from "../budget.js";
import {
  FC007_NODE_ELEMENT,
  nativeFirstChild,
  nativeNextSibling,
  nativeNodeType,
  nativeParentElement,
} from "../native-dom.js";

export type DialogTraversalHook = () => void;

export interface DialogPageInventoryOptions {
  /**
   * Exact privately retained FutureClick preview host (object identity only).
   * Does not consume a page-controlled budget slot; no descent into it.
   */
  readonly ownedPreviewHost?: HTMLDivElement;
  /** Called once per total-node visit attempt (includes overflow-detecting visit). */
  readonly onNodeVisit?: DialogTraversalHook;
  /** Called once per page-controlled element visit attempt (includes overflow probe). */
  readonly onPageElementVisit?: DialogTraversalHook;
  /** Called once per native firstChild read. */
  readonly onFirstChildRead?: DialogTraversalHook;
  /** Called once per native nextSibling read. */
  readonly onNextSiblingRead?: DialogTraversalHook;
}

export type DialogPageInventoryResult =
  | {
      readonly status: "ok";
      /** Page-controlled elements only (owned host excluded), length ≤ DIALOG_MAX_ELEMENTS. */
      readonly elements: readonly Element[];
      readonly pageControlledCount: number;
      readonly elementVisitAttempts: number;
      readonly nodeVisitAttempts: number;
      readonly firstChildReads: number;
      readonly nextSiblingReads: number;
      readonly sawOwnedHost: boolean;
    }
  | {
      readonly status: "element_overflow";
      readonly elementVisitAttempts: number;
      readonly nodeVisitAttempts: number;
      readonly firstChildReads: number;
      readonly nextSiblingReads: number;
      readonly pageControlledSeen: number;
    }
  | {
      readonly status: "node_overflow";
      readonly elementVisitAttempts: number;
      readonly nodeVisitAttempts: number;
      readonly firstChildReads: number;
      readonly nextSiblingReads: number;
    }
  | {
      readonly status: "owned_host_missing";
      readonly elements: readonly Element[];
      readonly elementVisitAttempts: number;
      readonly nodeVisitAttempts: number;
      readonly firstChildReads: number;
      readonly nextSiblingReads: number;
    }
  | {
      readonly status: "duplicate_node";
      readonly elementVisitAttempts: number;
      readonly nodeVisitAttempts: number;
      readonly firstChildReads: number;
      readonly nextSiblingReads: number;
    };

/** 64 accepted page-controlled elements + 1 overflow-detecting visit. */
export const DIALOG_PAGE_ELEMENT_VISIT_ABORT_MAX = DIALOG_MAX_ELEMENTS + 1;

/** DIALOG_MAX_NODE_VISITS accepted + 1 overflow-detecting visit. */
export const DIALOG_NODE_VISIT_ABORT_MAX = DIALOG_MAX_NODE_VISITS + 1;

/**
 * Build a bounded page-controlled element list under `dialog`.
 *
 * DFS via explicit stack of individual node pointers using retained native
 * getters. Never seeds dialog.nextSibling. Fail closed on duplicate identity.
 */
export function inventoryDialogPageElements(
  dialog: Element,
  options?: DialogPageInventoryOptions,
): DialogPageInventoryResult {
  const ownedHost = options?.ownedPreviewHost;
  const onNode = options?.onNodeVisit;
  const onPage = options?.onPageElementVisit;
  const onFirstChild = options?.onFirstChildRead;
  const onNextSibling = options?.onNextSiblingRead;

  const elements: Element[] = [];
  let elementVisitAttempts = 0;
  let nodeVisitAttempts = 0;
  let firstChildReads = 0;
  let nextSiblingReads = 0;
  let sawOwnedHost = false;
  const seen = new Set<Node>();

  type Step = "continue" | "skip_descend" | "element_overflow" | "node_overflow" | "duplicate";

  const accountNode = (node: Node): Step => {
    nodeVisitAttempts += 1;
    onNode?.();
    if (nodeVisitAttempts > DIALOG_MAX_NODE_VISITS) {
      return "node_overflow";
    }
    if (seen.has(node)) {
      return "duplicate";
    }
    seen.add(node);

    if (nativeNodeType(node) === FC007_NODE_ELEMENT) {
      const el = node as Element;
      if (ownedHost && el === ownedHost) {
        sawOwnedHost = true;
        return "skip_descend";
      }
      elementVisitAttempts += 1;
      onPage?.();
      if (elementVisitAttempts > DIALOG_MAX_ELEMENTS) {
        return "element_overflow";
      }
      elements.push(el);
    }
    return "continue";
  };

  const readFirstChild = (node: Node): Node | null => {
    firstChildReads += 1;
    onFirstChild?.();
    return nativeFirstChild(node);
  };

  const readNextSibling = (node: Node): Node | null => {
    nextSiblingReads += 1;
    onNextSibling?.();
    return nativeNextSibling(node);
  };

  const stack: Node[] = [dialog];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;

    const step = accountNode(node);
    if (step === "duplicate") {
      return {
        status: "duplicate_node",
        elementVisitAttempts,
        nodeVisitAttempts,
        firstChildReads,
        nextSiblingReads,
      };
    }
    if (step === "node_overflow") {
      return {
        status: "node_overflow",
        elementVisitAttempts,
        nodeVisitAttempts,
        firstChildReads,
        nextSiblingReads,
      };
    }
    if (step === "element_overflow") {
      return {
        status: "element_overflow",
        elementVisitAttempts,
        nodeVisitAttempts,
        firstChildReads,
        nextSiblingReads,
        pageControlledSeen: elementVisitAttempts,
      };
    }

    if (step === "skip_descend") {
      if (node !== dialog) {
        const ns = readNextSibling(node);
        if (ns) stack.push(ns);
      }
      continue;
    }

    if (node !== dialog) {
      const ns = readNextSibling(node);
      if (ns) stack.push(ns);
    }
    const fc = readFirstChild(node);
    if (fc) stack.push(fc);
  }

  if (ownedHost && !sawOwnedHost) {
    // Chromium: owned host must appear in the native pointer walk when it is a
    // direct dialog child. No happy-dom missing-link fallback.
    void nativeParentElement(ownedHost);
    return {
      status: "owned_host_missing",
      elements,
      elementVisitAttempts,
      nodeVisitAttempts,
      firstChildReads,
      nextSiblingReads,
    };
  }

  return {
    status: "ok",
    elements,
    pageControlledCount: elements.length,
    elementVisitAttempts,
    nodeVisitAttempts,
    firstChildReads,
    nextSiblingReads,
    sawOwnedHost,
  };
}
