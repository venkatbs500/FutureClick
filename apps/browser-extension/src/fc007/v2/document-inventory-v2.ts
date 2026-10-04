/**
 * FC-007 V2 — single bounded document inventory per capture.
 *
 * Retained-native firstChild/nextSibling pointer DFS from documentElement.
 * COMPLETE supported-document coverage: dialog interiors are traversed under
 * the same document node/element budgets (no global skip_descend on dialog).
 *
 * Early-exit only when invalidity is already proven (second main, 5th dialog,
 * budget exhausted, duplicate identity).
 *
 * Document-level siblings of documentElement (doctype, comments, PIs) are
 * counted against the same node budget: Chromium's form listed-element walk
 * from the Document scope visits them, so they are part of the bounded domain.
 *
 * On success the element array is frozen and marked as a completed inventory;
 * only marked arrays unlock native form.elements access.
 */

import {
  DIALOG_COLLECTION_MAX,
  DOCUMENT_MAX_ELEMENTS_V2,
  DOCUMENT_MAX_NODE_VISITS_V2,
} from "../budget.js";
import {
  FC007_NODE_ELEMENT,
  isNativeElement,
  markCompletedDocumentInventory,
  nativeFirstChild,
  nativeNextSibling,
  nativeNodeType,
  nativeTagName,
} from "../native-dom.js";

export type DocumentTraversalHook = () => void;

export interface DocumentInventoryOptions {
  /** Exact owned preview host — record/skip_descend; no interior walk. */
  readonly ownedPreviewHost?: HTMLDivElement;
  readonly onNodeVisit?: DocumentTraversalHook;
  readonly onElementVisit?: DocumentTraversalHook;
  readonly onFirstChildRead?: DocumentTraversalHook;
  readonly onNextSiblingRead?: DocumentTraversalHook;
}

export type DocumentInventoryResult =
  | {
      readonly status: "ok";
      readonly elements: readonly Element[];
      readonly mains: readonly HTMLElement[];
      readonly dialogs: readonly HTMLDialogElement[];
      readonly nodeVisitAttempts: number;
      readonly elementVisitAttempts: number;
      readonly firstChildReads: number;
      readonly nextSiblingReads: number;
    }
  | {
      readonly status: "abstain";
      readonly reason:
        | "DOCUMENT_NODE_BUDGET_EXHAUSTED"
        | "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED"
        | "DOCUMENT_ROOT_MISSING"
        | "DIALOG_COLLECTION_TOO_LARGE"
        | "MAIN_NOT_UNIQUE"
        | "DOCUMENT_DUPLICATE_NODE";
      readonly nodeVisitAttempts: number;
      readonly elementVisitAttempts: number;
      readonly firstChildReads: number;
      readonly nextSiblingReads: number;
      readonly mainsSeen: number;
      readonly dialogsSeen: number;
    };

/**
 * Complete bounded document inventory, or fail closed on budget / uniqueness overflow.
 * Traverses dialog interiors. Early-exits when dialog count > max or mains > 1.
 */
export function inventoryDocumentV2(
  doc: Document,
  options?: DocumentInventoryOptions,
): DocumentInventoryResult {
  const ownedHost = options?.ownedPreviewHost;
  const onNode = options?.onNodeVisit;
  const onEl = options?.onElementVisit;
  const onFc = options?.onFirstChildRead;
  const onNs = options?.onNextSiblingRead;

  const elements: Element[] = [];
  const mains: HTMLElement[] = [];
  const dialogs: HTMLDialogElement[] = [];
  let nodeVisitAttempts = 0;
  let elementVisitAttempts = 0;
  let firstChildReads = 0;
  let nextSiblingReads = 0;

  const seen = new Set<Node>();

  const readFirstChild = (node: Node): Node | null => {
    firstChildReads += 1;
    onFc?.();
    return nativeFirstChild(node);
  };
  const readNextSibling = (node: Node): Node | null => {
    nextSiblingReads += 1;
    onNs?.();
    return nativeNextSibling(node);
  };

  // documentElement semantics (the Document's sole element child) via retained
  // getters only — no ordinary property lookup on page-controlled nodes.
  let root: Element | null = null;
  let docChild = readFirstChild(doc);
  while (docChild) {
    if (root === null && nativeNodeType(docChild) === FC007_NODE_ELEMENT) {
      root = docChild as Element;
    } else {
      nodeVisitAttempts += 1;
      onNode?.();
      if (nodeVisitAttempts > DOCUMENT_MAX_NODE_VISITS_V2) {
        return {
          status: "abstain",
          reason: "DOCUMENT_NODE_BUDGET_EXHAUSTED",
          nodeVisitAttempts,
          elementVisitAttempts,
          firstChildReads,
          nextSiblingReads,
          mainsSeen: 0,
          dialogsSeen: 0,
        };
      }
    }
    docChild = readNextSibling(docChild);
  }
  if (!root) {
    return {
      status: "abstain",
      reason: "DOCUMENT_ROOT_MISSING",
      nodeVisitAttempts,
      elementVisitAttempts,
      firstChildReads,
      nextSiblingReads,
      mainsSeen: 0,
      dialogsSeen: 0,
    };
  }

  const stack: Node[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;

    nodeVisitAttempts += 1;
    onNode?.();
    if (nodeVisitAttempts > DOCUMENT_MAX_NODE_VISITS_V2) {
      return {
        status: "abstain",
        reason: "DOCUMENT_NODE_BUDGET_EXHAUSTED",
        nodeVisitAttempts,
        elementVisitAttempts,
        firstChildReads,
        nextSiblingReads,
        mainsSeen: mains.length,
        dialogsSeen: dialogs.length,
      };
    }

    if (seen.has(node)) {
      return {
        status: "abstain",
        reason: "DOCUMENT_DUPLICATE_NODE",
        nodeVisitAttempts,
        elementVisitAttempts,
        firstChildReads,
        nextSiblingReads,
        mainsSeen: mains.length,
        dialogsSeen: dialogs.length,
      };
    }
    seen.add(node);

    let skipDescend = false;

    if (nativeNodeType(node) === FC007_NODE_ELEMENT || isNativeElement(node)) {
      const el = node as Element;
      elementVisitAttempts += 1;
      onEl?.();
      if (elementVisitAttempts > DOCUMENT_MAX_ELEMENTS_V2) {
        return {
          status: "abstain",
          reason: "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED",
          nodeVisitAttempts,
          elementVisitAttempts,
          firstChildReads,
          nextSiblingReads,
          mainsSeen: mains.length,
          dialogsSeen: dialogs.length,
        };
      }
      elements.push(el);

      // Owned preview host: never descend into closed shadow / light children.
      if (ownedHost && el === ownedHost) {
        skipDescend = true;
      }

      const tag = nativeTagName(el).toUpperCase();
      if (tag === "MAIN" && el instanceof HTMLElement) {
        mains.push(el);
        if (mains.length > 1) {
          return {
            status: "abstain",
            reason: "MAIN_NOT_UNIQUE",
            nodeVisitAttempts,
            elementVisitAttempts,
            firstChildReads,
            nextSiblingReads,
            mainsSeen: mains.length,
            dialogsSeen: dialogs.length,
          };
        }
      }
      if (
        tag === "DIALOG" &&
        typeof HTMLDialogElement !== "undefined" &&
        el instanceof HTMLDialogElement
      ) {
        dialogs.push(el);
        if (dialogs.length > DIALOG_COLLECTION_MAX) {
          return {
            status: "abstain",
            reason: "DIALOG_COLLECTION_TOO_LARGE",
            nodeVisitAttempts,
            elementVisitAttempts,
            firstChildReads,
            nextSiblingReads,
            mainsSeen: mains.length,
            dialogsSeen: dialogs.length,
          };
        }
        // Dialog interiors ARE traversed — completeness under document budgets.
      }
    }

    if (node !== root) {
      const ns = readNextSibling(node);
      if (ns) stack.push(ns);
    }
    if (!skipDescend) {
      const fc = readFirstChild(node);
      if (fc) stack.push(fc);
    }
  }

  Object.freeze(elements);
  markCompletedDocumentInventory(elements);
  return {
    status: "ok",
    elements,
    mains,
    dialogs,
    nodeVisitAttempts,
    elementVisitAttempts,
    firstChildReads,
    nextSiblingReads,
  };
}
