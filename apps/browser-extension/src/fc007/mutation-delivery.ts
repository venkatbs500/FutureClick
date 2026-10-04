/**
 * FC-007 Sprint 1 — bounded MutationObserver delivery processing.
 *
 * Budgets are enforced BEFORE materializing or fully iterating untrusted
 * NodeLists. No Array.from / spread of addedNodes/removedNodes.
 *
 * Classification precedence: OVERFLOW > RELEVANT > IRRELEVANT.
 * Early dialog discovery does NOT skip complete candidate traversal.
 */

import {
  MUTATION_CANDIDATE_MAX_ELEMENTS,
  MUTATION_DELIVERY_MAX_ELEMENTS,
  MUTATION_ROOT_MAX,
  RecognitionBudget,
} from "./budget.js";
import {
  FC007_NODE_ELEMENT,
  nativeFirstElementChild,
  nativeNextElementSibling,
  nativeNodeType,
  nativeTagName,
} from "./native-dom.js";

/** Conservative gate on MutationRecord array length (distinct from root count). */
export const MUTATION_RECORD_MAX = 32;

export type MutationDeliveryResult =
  | { readonly status: "irrelevant" }
  | { readonly status: "relevant"; readonly hadRemovals: boolean }
  | { readonly status: "overflow"; readonly reason: string };

export interface MutationDeliveryOptions {
  /**
   * Optional instrumentation seam for tests (e.g. count NodeList.item calls).
   * Production passes nothing.
   */
  readonly onAddedNodeItem?: (index: number) => void;
}

/**
 * Read addedNodes[i] without materializing the NodeList.
 * Prefer NodeList.item; fall back to index access for array-like hosts.
 */
function addedNodeAt(added: NodeList, index: number): Node | null {
  if (typeof added.item === "function") {
    return added.item(index);
  }
  const node = (added as unknown as ArrayLike<Node | null | undefined>)[index];
  return node ?? null;
}

/**
 * Process one MutationObserver delivery under root/candidate/total budgets.
 */
export function processMutationDelivery(
  records: MutationRecord[],
  options?: MutationDeliveryOptions,
): MutationDeliveryResult {
  if (records.length > MUTATION_RECORD_MAX) {
    return { status: "overflow", reason: "MUTATION_RECORD_COUNT" };
  }

  const delivery = new RecognitionBudget(MUTATION_DELIVERY_MAX_ELEMENTS, Number.POSITIVE_INFINITY);
  let rootsUsed = 0;
  let relevant = false;
  let hadRemovals = false;

  for (let r = 0; r < records.length; r += 1) {
    const record = records[r];
    if (!record) continue;

    if (record.type === "attributes") {
      if (rootsUsed >= MUTATION_ROOT_MAX) {
        return { status: "overflow", reason: "MUTATION_ROOT_BUDGET" };
      }
      const target = record.target;
      if (!target) continue;
      rootsUsed += 1;
      if (!delivery.visitElement()) {
        return { status: "overflow", reason: "MUTATION_DELIVERY_BUDGET" };
      }
      const hit = classifyCandidateSubtree(target, delivery);
      if (hit === "overflow") {
        return { status: "overflow", reason: "MUTATION_SUBTREE_OVERFLOW" };
      }
      if (hit === "yes") relevant = true;
      continue;
    }

    if (record.type !== "childList") continue;

    // Conservative V1: ANY removal is potentially relevant. Read length only.
    if (record.removedNodes.length > 0) {
      hadRemovals = true;
      relevant = true;
    }

    const added = record.addedNodes;
    const addedLength = added.length;
    const remainingRoots = MUTATION_ROOT_MAX - rootsUsed;

    // If the collection itself exceeds remaining root capacity, fail closed
    // without iterating every node.
    if (addedLength > remainingRoots) {
      return { status: "overflow", reason: "MUTATION_ADDED_NODES_EXCEED_ROOT_BUDGET" };
    }

    for (let i = 0; i < addedLength; i += 1) {
      options?.onAddedNodeItem?.(i);
      const node = addedNodeAt(added, i);
      if (!node) continue;

      if (rootsUsed >= MUTATION_ROOT_MAX) {
        return { status: "overflow", reason: "MUTATION_ROOT_BUDGET" };
      }
      rootsUsed += 1;

      if (!delivery.visitElement()) {
        return { status: "overflow", reason: "MUTATION_DELIVERY_BUDGET" };
      }

      const hit = classifyCandidateSubtree(node, delivery);
      if (hit === "overflow") {
        return { status: "overflow", reason: "MUTATION_SUBTREE_OVERFLOW" };
      }
      if (hit === "yes") relevant = true;
    }
  }

  if (relevant) {
    return { status: "relevant", hadRemovals };
  }
  return { status: "irrelevant" };
}

/**
 * Complete bounded candidate classification.
 * Early dialog discovery does NOT return early — overflow always wins.
 */
export function classifyCandidateSubtree(
  root: Node,
  deliveryBudget: RecognitionBudget,
): "yes" | "no" | "overflow" {
  // Retained getters only: mutated subtrees are page-controlled and may contain
  // forms, whose ordinary property lookups enter the named-property cache path.
  if (nativeNodeType(root) !== FC007_NODE_ELEMENT) {
    return "no";
  }

  const rootEl = root as Element;
  let foundPotentialDialog = nativeTagName(rootEl).toUpperCase() === "DIALOG";

  const local = new RecognitionBudget(MUTATION_CANDIDATE_MAX_ELEMENTS, Number.POSITIVE_INFINITY);

  // Count root toward per-candidate budget (delivery already counted entry visit).
  if (!local.visitElement()) {
    deliveryBudget.markOverflow("elements");
    return "overflow";
  }

  // Element-children walk in document order — visit before descent; complete unless overflow.
  const stack: { next: Element | null }[] = [{ next: nativeFirstElementChild(rootEl) }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (!frame) break;
    const child = frame.next;
    if (!child) {
      stack.pop();
      continue;
    }
    frame.next = nativeNextElementSibling(child);

    if (!local.visitElement() || !deliveryBudget.visitElement()) {
      deliveryBudget.markOverflow("elements");
      return "overflow";
    }
    if (nativeTagName(child).toUpperCase() === "DIALOG") {
      foundPotentialDialog = true;
      // Continue — do not return early.
    }
    stack.push({ next: nativeFirstElementChild(child) });
  }

  if (local.isOverflowed || deliveryBudget.isOverflowed) {
    return "overflow";
  }
  return foundPotentialDialog ? "yes" : "no";
}

/** @deprecated Use classifyCandidateSubtree — kept as alias for older tests. */
export const subtreeMayContainDialog = classifyCandidateSubtree;
