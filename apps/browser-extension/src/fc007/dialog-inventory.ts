/**
 * FC-007 Sprint 1 — bounded dialog inventory + Contract V1 dialog recognition.
 */

import {
  DIALOG_COLLECTION_MAX,
  DIALOG_MAX_ELEMENTS,
  DIALOG_MAX_TEXT_UNITS,
  FORM_TO_DIALOG_MAX_HOPS,
  RecognitionBudget,
} from "./budget.js";
import { type FormContractRecognition, recognizeFormContract } from "./form-contract.js";
import { type Fc007RepoIdentity, parseOwnerRepoText } from "./identity.js";
import { normalizedOwnText } from "./own-text.js";

export type ModalPredicate = (el: Element) => boolean;

const REJECT_ARIA_ROLES = new Set([
  "button",
  "checkbox",
  "radio",
  "switch",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "spinbutton",
  "slider",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "link",
  "tab",
  "treeitem",
  "gridcell",
]);

/** Explicitly allowed non-interactive role tokens for V1 structure only. */
const KNOWN_NON_INTERACTIVE_ROLES = new Set(["presentation", "none"]);

/**
 * Production uses Element.matches(":modal").
 * Tests may inject a seam when jsdom/happy-dom lacks :modal support.
 */
export function defaultMatchesModal(el: Element): boolean {
  try {
    return el.matches(":modal");
  } catch {
    throw new Error("FC007_MODAL_PSEUDO_UNSUPPORTED");
  }
}

export interface DialogContractRecognition {
  readonly dialog: HTMLDialogElement;
  readonly identityText: string;
  readonly transitionHeading: string;
  readonly finalButton: HTMLButtonElement;
  readonly form: HTMLFormElement;
  readonly formContract: FormContractRecognition;
  readonly closeButton: HTMLButtonElement | null;
}

export type DialogInventoryResult =
  | { readonly status: "matched"; readonly value: DialogContractRecognition }
  | { readonly status: "abstain"; readonly reason: string };

function nativeDialog(el: Element): HTMLDialogElement | null {
  if (typeof HTMLDialogElement === "undefined") return null;
  if (!(el instanceof HTMLDialogElement)) return null;
  return el;
}

function nativeButton(el: Element): HTMLButtonElement | null {
  if (typeof HTMLButtonElement === "undefined") return null;
  if (!(el instanceof HTMLButtonElement)) return null;
  return el;
}

function nativeForm(el: Element | HTMLFormElement | null): HTMLFormElement | null {
  if (!el) return null;
  if (typeof HTMLFormElement === "undefined") return null;
  if (!(el instanceof HTMLFormElement)) return null;
  return el;
}

function* walkElements(root: Element): Generator<Element> {
  // Indexed children walk: visit each node before descending.
  // Prefer children.item over nextElementSibling — happy-dom can fail to
  // update nextElementSibling after late appendChild.
  yield root;
  const stack: { readonly el: Element; index: number }[] = [{ el: root, index: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (!frame) break;
    const len = frame.el.children.length;
    if (frame.index >= len) {
      stack.pop();
      continue;
    }
    const child = frame.el.children.item(frame.index);
    frame.index += 1;
    if (!child) continue;
    yield child;
    stack.push({ el: child, index: 0 });
  }
}

function isActualModal(
  dialog: HTMLDialogElement,
  retainedDocument: Document,
  matchesModal: ModalPredicate,
): boolean {
  if (!dialog.isConnected) return false;
  if (dialog.ownerDocument !== retainedDocument) return false;
  if (dialog.open !== true) return false;
  return matchesModal(dialog) === true;
}

function formWithinDialogHops(form: HTMLFormElement, dialog: HTMLDialogElement): boolean {
  let cur: Element | null = form;
  for (let hops = 0; hops <= FORM_TO_DIALOG_MAX_HOPS; hops += 1) {
    if (!cur) return false;
    if (cur === dialog) return true;
    cur = cur.parentElement;
  }
  return false;
}

function normalizeAriaLabel(raw: string | null): string | null {
  if (raw == null) return null;
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Positive narrow V1 close-control predicate.
 * Exact aria-label "Close" only — not "any form-less button".
 */
export function isApprovedCloseControl(
  el: Element,
  retainedDocument: Document,
  finalButton: HTMLButtonElement | null,
): boolean {
  const button = nativeButton(el);
  if (!button) return false;
  if (button.type !== "button") return false;
  if (button.form != null) return false;
  if (!button.isConnected || button.ownerDocument !== retainedDocument) return false;
  if (finalButton && button === finalButton) return false;
  return normalizeAriaLabel(button.getAttribute("aria-label")) === "Close";
}

function hasRejectableTabIndex(el: Element): boolean {
  if (!el.hasAttribute("tabindex")) return false;
  const raw = el.getAttribute("tabindex");
  if (raw == null) return false;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0;
}

function classifyDialogInteractive(
  el: Element,
  retainedDocument: Document,
  finalButton: HTMLButtonElement | null,
  closeButton: HTMLButtonElement | null,
): "ok" | "reject" {
  if (finalButton && el === finalButton) return "ok";
  if (closeButton && el === closeButton) return "ok";

  // Conservative V1: any custom element (localName contains "-") is unsupported.
  const localName = el.localName || el.tagName.toLowerCase();
  if (localName.includes("-")) {
    return "reject";
  }

  const tag = el.tagName.toUpperCase();

  if (tag === "TEXTAREA" || tag === "SELECT") return "reject";
  if (tag === "A" && el.hasAttribute("href")) return "reject";

  if (tag === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    if (type === "hidden") return "ok";
    return "reject";
  }

  if (el instanceof HTMLElement && el.isContentEditable) return "reject";

  // Role tokenization: inspect every token; interactive OR unknown → reject.
  const roleAttr = el.getAttribute("role");
  if (roleAttr != null && roleAttr.trim() !== "") {
    const tokens = roleAttr
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .split(" ")
      .filter((t) => t.length > 0);
    for (const token of tokens) {
      if (REJECT_ARIA_ROLES.has(token)) return "reject";
      if (!KNOWN_NON_INTERACTIVE_ROLES.has(token)) return "reject";
    }
  }

  if (tag === "BUTTON") {
    if (isApprovedCloseControl(el, retainedDocument, finalButton)) return "ok";
    return "reject";
  }

  // Unknown nonnegative tabindex interaction surface.
  if (hasRejectableTabIndex(el)) return "reject";

  // form-associated custom elements / unexpected form controls
  const formAssociated = (el as HTMLElement & { form?: unknown }).form;
  if (formAssociated != null && tag !== "INPUT") return "reject";

  return "ok";
}

export function recognizeDialogContract(
  dialog: HTMLDialogElement,
  expected: Fc007RepoIdentity,
  options?: {
    readonly matchesModal?: ModalPredicate;
    readonly retainedDocument?: Document;
  },
): DialogInventoryResult {
  if (typeof HTMLDialogElement === "undefined") {
    return { status: "abstain", reason: "NATIVE_DIALOG_UNAVAILABLE" };
  }
  if (!(dialog instanceof HTMLDialogElement)) {
    return { status: "abstain", reason: "NOT_NATIVE_DIALOG" };
  }

  const matchesModal = options?.matchesModal ?? defaultMatchesModal;
  const retainedDocument = options?.retainedDocument ?? dialog.ownerDocument;

  if (!isActualModal(dialog, retainedDocument, matchesModal)) {
    return { status: "abstain", reason: "DIALOG_NOT_ACTUAL_MODAL" };
  }
  if (dialog.getAttribute("aria-modal") !== "true") {
    return { status: "abstain", reason: "DIALOG_ARIA_MODAL" };
  }
  if (dialog.hidden) {
    return { status: "abstain", reason: "DIALOG_HIDDEN" };
  }
  if (dialog.inert) {
    return { status: "abstain", reason: "DIALOG_INERT" };
  }

  const budget = new RecognitionBudget(DIALOG_MAX_ELEMENTS, DIALOG_MAX_TEXT_UNITS);
  const expectedIdentity = `${expected.ownerDisplay}/${expected.repoDisplay}`;
  const expectedTransition = `Make ${expected.ownerDisplay}/${expected.repoDisplay} public`;
  const finalButtonText = "Make this repository public";

  let identityCount = 0;
  let transitionCount = 0;
  let identityText = "";
  let transitionHeading = "";
  const submitButtons: HTMLButtonElement[] = [];
  let closeButton: HTMLButtonElement | null = null;

  for (const node of walkElements(dialog)) {
    if (!budget.visitElement()) {
      return { status: "abstain", reason: "DIALOG_ELEMENT_BUDGET_EXHAUSTED" };
    }

    const own = normalizedOwnText(node, budget);
    if (own.status === "over_budget") {
      return { status: "abstain", reason: "DIALOG_OWN_TEXT_OVER_BUDGET" };
    }

    const tag = node.tagName.toUpperCase();

    if (own.status === "ok") {
      // Semantic categories: identity = P, transition = H1.
      if (tag === "P") {
        if (own.text === expectedIdentity) {
          identityCount += 1;
          identityText = own.text;
        } else {
          const parsed = parseOwnerRepoText(own.text, {
            ownerNormalized: expected.ownerNormalized,
            repoNormalized: expected.repoNormalized,
          });
          if (parsed && own.text === `${parsed.ownerDisplay}/${parsed.repoDisplay}`) {
            identityCount += 1;
            identityText = own.text;
          }
        }
      }
      if (tag === "H1" && own.text === expectedTransition) {
        transitionCount += 1;
        transitionHeading = own.text;
      }
    }

    if (tag === "BUTTON") {
      const button = nativeButton(node);
      if (!button) {
        return { status: "abstain", reason: "NATIVE_BUTTON_UNAVAILABLE" };
      }
      const btnOwn = own.status === "ok" ? own : normalizedOwnText(node, budget);
      if (btnOwn.status === "over_budget") {
        return { status: "abstain", reason: "DIALOG_BUTTON_TEXT_OVER_BUDGET" };
      }
      if (btnOwn.status === "ok" && btnOwn.text === finalButtonText && button.type === "submit") {
        submitButtons.push(button);
      } else if (isApprovedCloseControl(button, retainedDocument, null)) {
        if (closeButton && closeButton !== button) {
          return { status: "abstain", reason: "DIALOG_DUPLICATE_CLOSE" };
        }
        closeButton = button;
      } else {
        return { status: "abstain", reason: "DIALOG_UNSUPPORTED_INTERACTIVE" };
      }
    } else if (classifyDialogInteractive(node, retainedDocument, null, null) === "reject") {
      return { status: "abstain", reason: "DIALOG_UNSUPPORTED_INTERACTIVE" };
    }
  }

  if (budget.isOverflowed) {
    return { status: "abstain", reason: "DIALOG_TRAVERSAL_INCOMPLETE" };
  }

  if (identityCount !== 1) {
    return { status: "abstain", reason: "DIALOG_IDENTITY_COUNT" };
  }
  if (transitionCount !== 1) {
    return { status: "abstain", reason: "DIALOG_TRANSITION_COUNT" };
  }
  if (submitButtons.length !== 1) {
    return { status: "abstain", reason: "DIALOG_FINAL_BUTTON_COUNT" };
  }

  const finalButton = submitButtons[0];
  if (!finalButton) {
    return { status: "abstain", reason: "DIALOG_FINAL_BUTTON_COUNT" };
  }

  const classifyBudget = new RecognitionBudget(DIALOG_MAX_ELEMENTS, DIALOG_MAX_TEXT_UNITS);
  for (const n2 of walkElements(dialog)) {
    if (!classifyBudget.visitElement()) {
      return { status: "abstain", reason: "DIALOG_CLASSIFY_BUDGET" };
    }
    if (classifyDialogInteractive(n2, retainedDocument, finalButton, closeButton) === "reject") {
      return { status: "abstain", reason: "DIALOG_UNSUPPORTED_INTERACTIVE" };
    }
  }

  const form = nativeForm(finalButton.form);
  if (!form) {
    return { status: "abstain", reason: "BUTTON_FORM_MISSING" };
  }
  if (!formWithinDialogHops(form, dialog)) {
    return { status: "abstain", reason: "FORM_DIALOG_HOPS" };
  }

  const formResult = recognizeFormContract(finalButton, form, expected, retainedDocument);
  if (formResult.status !== "matched") {
    return { status: "abstain", reason: formResult.reason };
  }

  return {
    status: "matched",
    value: {
      dialog,
      identityText,
      transitionHeading,
      finalButton,
      form,
      formContract: formResult.value,
      closeButton,
    },
  };
}

export function inventorySupportedVisibilityDialog(
  doc: Document,
  expected: Fc007RepoIdentity,
  options?: { readonly matchesModal?: ModalPredicate },
): DialogInventoryResult {
  if (typeof HTMLDialogElement === "undefined") {
    return { status: "abstain", reason: "NATIVE_DIALOG_UNAVAILABLE" };
  }

  const matchesModal = options?.matchesModal ?? defaultMatchesModal;
  const collection = doc.getElementsByTagName("dialog");
  const length = collection.length;
  if (length > DIALOG_COLLECTION_MAX) {
    return { status: "abstain", reason: "DIALOG_COLLECTION_TOO_LARGE" };
  }

  const actualModals: HTMLDialogElement[] = [];
  for (let i = 0; i < length; i += 1) {
    const el = collection.item(i);
    if (!el) continue;
    const dialogEl = nativeDialog(el);
    if (!dialogEl) continue;
    try {
      if (isActualModal(dialogEl, doc, matchesModal)) {
        actualModals.push(dialogEl);
      }
    } catch {
      return { status: "abstain", reason: "MODAL_PSEUDO_UNSUPPORTED" };
    }
  }

  if (actualModals.length === 0) {
    return { status: "abstain", reason: "NO_ACTUAL_MODAL" };
  }
  if (actualModals.length > 1) {
    return { status: "abstain", reason: "MULTIPLE_ACTUAL_MODALS" };
  }

  const sole = actualModals[0];
  if (!sole) {
    return { status: "abstain", reason: "NO_ACTUAL_MODAL" };
  }

  return recognizeDialogContract(sole, expected, { matchesModal, retainedDocument: doc });
}
