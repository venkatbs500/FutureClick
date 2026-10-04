/**
 * FC-007 Sprint 1D V2 — bounded dialog inventory + stage B/C/D recognition.
 */

import {
  DIALOG_COLLECTION_MAX,
  DIALOG_MAX_ELEMENTS,
  DIALOG_MAX_TEXT_UNITS,
  FORM_TO_DIALOG_MAX_HOPS,
  RecognitionBudget,
} from "../budget.js";
import { type ModalPredicate, defaultMatchesModal } from "../dialog-inventory.js";
import { type Fc007RepoIdentity, parseOwnerRepoText } from "../identity.js";
import {
  nativeButtonForm,
  nativeGetAttribute,
  nativeHasAttribute,
  nativeParentElement,
} from "../native-dom.js";
import { normalizedOwnText } from "../own-text.js";
import { ownedPreviewHostInvariantFailure } from "../preview-host.js";
import { isApprovedCloseControlV2, isStageBcCloseControl } from "./close-v2.js";
import {
  type DialogPageInventoryResult,
  type DialogTraversalHook,
  inventoryDialogPageElements,
} from "./dialog-page-elements.js";
import { type DocumentInventoryResult, inventoryDocumentV2 } from "./document-inventory-v2.js";
import { findExactEffectsRegionInElements } from "./effects-region.js";
import { type FormContractRecognitionV2, recognizeFormContractV2 } from "./form-contract-v2.js";

export type { ModalPredicate };

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

const KNOWN_NON_INTERACTIVE_ROLES = new Set(["presentation", "none", "region"]);

export const STAGE_B_ACK_TEXT = "I want to make this repository public";
export const STAGE_C_ACK_TEXT = "I have read and understand these effects";
export const STAGE_D_FINAL_TEXT = "Make this repository public";

export interface StageDRecognition {
  readonly dialog: HTMLDialogElement;
  readonly identityText: string;
  readonly transitionHeading: string;
  readonly finalButton: HTMLButtonElement;
  readonly form: HTMLFormElement;
  readonly formContract: FormContractRecognitionV2;
  readonly closeButton: HTMLButtonElement;
  readonly effectsRegion: HTMLDivElement;
}

export interface StageBcRecognition {
  readonly dialog: HTMLDialogElement;
  readonly identityText: string;
  readonly transitionHeading: string;
  readonly acknowledgementButton: HTMLButtonElement;
  readonly closeButton: HTMLButtonElement | null;
  readonly effectsRegion: HTMLDivElement | null;
}

export type StageRecognitionResult<T> =
  | { readonly status: "matched"; readonly value: T }
  | { readonly status: "abstain"; readonly reason: string };

export type StageRecognitionOptions = {
  readonly matchesModal?: ModalPredicate;
  readonly retainedDocument?: Document;
  /**
   * Exact privately retained FutureClick preview host. Object identity only.
   * Does not raise the page-controlled DIALOG_MAX_ELEMENTS budget.
   */
  readonly ownedPreviewHost?: HTMLDivElement;
  /** Precomputed bounded page-controlled inventory (capture reuse). */
  readonly pageElements?: readonly Element[];
  /** Precomputed bounded document element list (exteriors; form association). */
  readonly documentElements?: readonly Element[];
  readonly onNodeVisit?: DialogTraversalHook;
  readonly onPageElementVisit?: DialogTraversalHook;
  readonly onFirstChildRead?: DialogTraversalHook;
  readonly onNextSiblingRead?: DialogTraversalHook;
};

const BUDGET_ABSTAIN_REASONS = new Set([
  "DIALOG_ELEMENT_BUDGET_EXHAUSTED",
  "DIALOG_NODE_BUDGET_EXHAUSTED",
  "DIALOG_TRAVERSAL_INCOMPLETE",
  "DIALOG_DUPLICATE_NODE",
  "DOCUMENT_NODE_BUDGET_EXHAUSTED",
  "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED",
  "DOCUMENT_DUPLICATE_NODE",
  "OWNED_HOST_NOT_IN_DIALOG",
  "OWNED_HOST_LIGHT_CHILDREN",
  "OWNED_HOST_DIV_UNAVAILABLE",
  "OWNED_HOST_NOT_DIV",
  "OWNED_HOST_DOCUMENT",
  "OWNED_HOST_DISCONNECTED",
  "OWNED_HOST_PARENT",
  "OWNED_HOST_ATTRIBUTES",
  "DIALOG_CLASSIFY_BUDGET",
]);

function isBudgetAbstainReason(reason: string): boolean {
  return BUDGET_ABSTAIN_REASONS.has(reason) || reason.startsWith("OWNED_HOST_");
}

function resolvePageElements(
  dialog: HTMLDialogElement,
  options?: StageRecognitionOptions,
): StageRecognitionResult<readonly Element[]> {
  if (options?.pageElements) {
    if (options.pageElements.length > DIALOG_MAX_ELEMENTS) {
      return { status: "abstain", reason: "DIALOG_ELEMENT_BUDGET_EXHAUSTED" };
    }
    return { status: "matched", value: options.pageElements };
  }
  const inv: DialogPageInventoryResult = inventoryDialogPageElements(dialog, {
    ...(options?.ownedPreviewHost ? { ownedPreviewHost: options.ownedPreviewHost } : {}),
    ...(options?.onNodeVisit ? { onNodeVisit: options.onNodeVisit } : {}),
    ...(options?.onPageElementVisit ? { onPageElementVisit: options.onPageElementVisit } : {}),
    ...(options?.onFirstChildRead ? { onFirstChildRead: options.onFirstChildRead } : {}),
    ...(options?.onNextSiblingRead ? { onNextSiblingRead: options.onNextSiblingRead } : {}),
  });
  if (inv.status === "element_overflow") {
    return { status: "abstain", reason: "DIALOG_ELEMENT_BUDGET_EXHAUSTED" };
  }
  if (inv.status === "node_overflow") {
    return { status: "abstain", reason: "DIALOG_NODE_BUDGET_EXHAUSTED" };
  }
  if (inv.status === "duplicate_node") {
    return { status: "abstain", reason: "DIALOG_DUPLICATE_NODE" };
  }
  if (inv.status === "owned_host_missing") {
    return { status: "abstain", reason: "OWNED_HOST_NOT_IN_DIALOG" };
  }
  return { status: "matched", value: inv.elements };
}

export type SoleModalResult =
  | { readonly status: "matched"; readonly value: HTMLDialogElement }
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

function isActualModal(
  dialog: HTMLDialogElement,
  retainedDocument: Document,
  matchesModal: ModalPredicate,
): boolean {
  if (!dialog.isConnected) return false;
  if (dialog.ownerDocument !== retainedDocument) return false;
  if (dialog.open !== true) return false;
  if (dialog.hidden) return false;
  if (dialog.inert) return false;
  return matchesModal(dialog) === true;
}

function formWithinDialogHops(form: HTMLFormElement, dialog: HTMLDialogElement): boolean {
  let cur: Element | null = form;
  for (let hops = 0; hops <= FORM_TO_DIALOG_MAX_HOPS; hops += 1) {
    if (!cur) return false;
    if (cur === dialog) return true;
    cur = nativeParentElement(cur);
  }
  return false;
}

function hasRejectableTabIndex(el: Element): boolean {
  if (!nativeHasAttribute(el, "tabindex")) return false;
  const raw = nativeGetAttribute(el, "tabindex");
  if (raw == null) return false;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0;
}

function classifyDialogInteractiveV2(
  el: Element,
  retainedDocument: Document,
  dialog: HTMLDialogElement,
  ctx: {
    readonly finalButton: HTMLButtonElement | null;
    readonly closeButton: HTMLButtonElement | null;
    readonly ackButton: HTMLButtonElement | null;
    readonly effectsRegion: HTMLDivElement | null;
    readonly retainedForm: HTMLFormElement | null;
    readonly stageMode: "b" | "c" | "d";
  },
): "ok" | "reject" {
  if (ctx.finalButton && el === ctx.finalButton) return "ok";
  if (ctx.closeButton && el === ctx.closeButton) return "ok";
  if (ctx.ackButton && el === ctx.ackButton) return "ok";
  if (ctx.effectsRegion && el === ctx.effectsRegion) return "ok";

  const localName = el.localName || el.tagName.toLowerCase();
  if (localName.includes("-")) return "reject";

  const tag = el.tagName.toUpperCase();
  if (
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "FIELDSET" ||
    tag === "OBJECT" ||
    tag === "OUTPUT"
  ) {
    return "reject";
  }
  if (tag === "A" && nativeHasAttribute(el, "href")) return "reject";

  if (tag === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    if (type === "hidden") return "ok";
    return "reject";
  }

  if (el instanceof HTMLElement && el.isContentEditable) return "reject";

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
    const button = nativeButton(el);
    if (!button) return "reject";
    if (ctx.stageMode === "d" && ctx.retainedForm) {
      if (isApprovedCloseControlV2(button, retainedDocument, ctx.retainedForm, ctx.finalButton)) {
        return "ok";
      }
    }
    if (isStageBcCloseControl(button, retainedDocument, dialog, ctx.finalButton)) {
      return "ok";
    }
    return "reject";
  }

  if (hasRejectableTabIndex(el)) return "reject";

  return "ok";
}

function dialogShellValid(
  dialog: HTMLDialogElement,
  retainedDocument: Document,
  matchesModal: ModalPredicate,
): string | null {
  if (typeof HTMLDialogElement === "undefined") return "NATIVE_DIALOG_UNAVAILABLE";
  if (!(dialog instanceof HTMLDialogElement)) return "NOT_NATIVE_DIALOG";
  if (!isActualModal(dialog, retainedDocument, matchesModal)) return "DIALOG_NOT_ACTUAL_MODAL";
  if (dialog.getAttribute("aria-modal") !== "true") return "DIALOG_ARIA_MODAL";
  return null;
}

export function inventorySoleActualModal(
  doc: Document,
  matchesModal: ModalPredicate = defaultMatchesModal,
  options?: { readonly documentInventory?: DocumentInventoryResult },
): SoleModalResult {
  if (typeof HTMLDialogElement === "undefined") {
    return { status: "abstain", reason: "NATIVE_DIALOG_UNAVAILABLE" };
  }

  const inv = options?.documentInventory ?? inventoryDocumentV2(doc);
  if (inv.status === "abstain") {
    if (inv.reason === "DIALOG_COLLECTION_TOO_LARGE") {
      return { status: "abstain", reason: "DIALOG_COLLECTION_TOO_LARGE" };
    }
    // Document budget/main uniqueness failures: no dialog discovery authority.
    return { status: "abstain", reason: inv.reason };
  }

  if (inv.dialogs.length > DIALOG_COLLECTION_MAX) {
    return { status: "abstain", reason: "DIALOG_COLLECTION_TOO_LARGE" };
  }

  const actualModals: HTMLDialogElement[] = [];
  for (const dialogEl of inv.dialogs) {
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
  if (!sole) return { status: "abstain", reason: "NO_ACTUAL_MODAL" };
  return { status: "matched", value: sole };
}

export function recognizeStageD(
  dialog: HTMLDialogElement,
  expected: Fc007RepoIdentity,
  options?: StageRecognitionOptions,
): StageRecognitionResult<StageDRecognition> {
  const matchesModal = options?.matchesModal ?? defaultMatchesModal;
  const retainedDocument = options?.retainedDocument ?? dialog.ownerDocument;
  const shell = dialogShellValid(dialog, retainedDocument, matchesModal);
  if (shell) return { status: "abstain", reason: shell };

  const ownedHost = options?.ownedPreviewHost;
  if (ownedHost) {
    const inv = ownedPreviewHostInvariantFailure(ownedHost, dialog, retainedDocument);
    if (inv) return { status: "abstain", reason: inv };
  }

  const pageEls = resolvePageElements(dialog, options);
  if (pageEls.status !== "matched") return pageEls;

  const expectedIdentity = `${expected.ownerDisplay}/${expected.repoDisplay}`;
  const expectedTransition = `Make ${expected.ownerDisplay}/${expected.repoDisplay} public`;

  const effectsRegion = findExactEffectsRegionInElements(pageEls.value, retainedDocument);
  if (!effectsRegion) {
    return { status: "abstain", reason: "EFFECTS_REGION_MISSING" };
  }

  // Semantic scan over the already-bounded inventory (text budget only).
  const budget = new RecognitionBudget(DIALOG_MAX_ELEMENTS, DIALOG_MAX_TEXT_UNITS);
  let identityCount = 0;
  let transitionCount = 0;
  let identityText = "";
  let transitionHeading = "";
  const submitButtons: HTMLButtonElement[] = [];
  let closeButton: HTMLButtonElement | null = null;

  for (const node of pageEls.value) {
    if (!budget.visitElement()) {
      return { status: "abstain", reason: "DIALOG_ELEMENT_BUDGET_EXHAUSTED" };
    }

    const ownOpts = ownedHost ? { excludeChild: ownedHost } : undefined;
    const own = normalizedOwnText(node, budget, ownOpts);
    if (own.status === "over_budget") {
      return { status: "abstain", reason: "DIALOG_OWN_TEXT_OVER_BUDGET" };
    }

    const tag = node.tagName.toUpperCase();
    if (own.status === "ok") {
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
      if (!button) return { status: "abstain", reason: "NATIVE_BUTTON_UNAVAILABLE" };
      const btnOwn = own.status === "ok" ? own : normalizedOwnText(node, budget, ownOpts);
      if (btnOwn.status === "over_budget") {
        return { status: "abstain", reason: "DIALOG_BUTTON_TEXT_OVER_BUDGET" };
      }
      if (
        btnOwn.status === "ok" &&
        btnOwn.text === STAGE_D_FINAL_TEXT &&
        button.type === "submit"
      ) {
        submitButtons.push(button);
      }
    }
  }

  if (budget.isOverflowed) {
    return { status: "abstain", reason: "DIALOG_TRAVERSAL_INCOMPLETE" };
  }
  if (identityCount !== 1) return { status: "abstain", reason: "DIALOG_IDENTITY_COUNT" };
  if (transitionCount !== 1) return { status: "abstain", reason: "DIALOG_TRANSITION_COUNT" };
  if (submitButtons.length !== 1) {
    return { status: "abstain", reason: "DIALOG_FINAL_BUTTON_COUNT" };
  }

  const finalButton = submitButtons[0];
  if (!finalButton) return { status: "abstain", reason: "DIALOG_FINAL_BUTTON_COUNT" };

  const form = nativeForm(
    (() => {
      try {
        return nativeButtonForm(finalButton);
      } catch {
        return null;
      }
    })(),
  );
  if (!form) return { status: "abstain", reason: "BUTTON_FORM_MISSING" };
  if (!formWithinDialogHops(form, dialog)) {
    return { status: "abstain", reason: "FORM_DIALOG_HOPS" };
  }

  for (const node of pageEls.value) {
    const button = nativeButton(node);
    if (!button || button.type !== "button") continue;
    if (isApprovedCloseControlV2(button, retainedDocument, form, finalButton)) {
      if (closeButton && closeButton !== button) {
        return { status: "abstain", reason: "DIALOG_DUPLICATE_CLOSE" };
      }
      closeButton = button;
    }
  }
  if (!closeButton) return { status: "abstain", reason: "DIALOG_CLOSE_MISSING" };

  const formResult = recognizeFormContractV2(
    finalButton,
    form,
    expected,
    retainedDocument,
    closeButton,
    options?.documentElements ? { documentElements: options.documentElements } : undefined,
  );
  if (formResult.status !== "matched") {
    return { status: "abstain", reason: formResult.reason };
  }

  const classifyBudget = new RecognitionBudget(DIALOG_MAX_ELEMENTS, DIALOG_MAX_TEXT_UNITS);
  for (const n2 of pageEls.value) {
    if (!classifyBudget.visitElement()) {
      return { status: "abstain", reason: "DIALOG_CLASSIFY_BUDGET" };
    }
    if (
      classifyDialogInteractiveV2(n2, retainedDocument, dialog, {
        finalButton,
        closeButton,
        ackButton: null,
        effectsRegion,
        retainedForm: form,
        stageMode: "d",
      }) === "reject"
    ) {
      return { status: "abstain", reason: "DIALOG_UNSUPPORTED_INTERACTIVE" };
    }
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
      effectsRegion,
    },
  };
}

export function recognizeStageC(
  dialog: HTMLDialogElement,
  expected: Fc007RepoIdentity,
  options?: StageRecognitionOptions,
): StageRecognitionResult<StageBcRecognition> {
  const matchesModal = options?.matchesModal ?? defaultMatchesModal;
  const retainedDocument = options?.retainedDocument ?? dialog.ownerDocument;
  const shell = dialogShellValid(dialog, retainedDocument, matchesModal);
  if (shell) return { status: "abstain", reason: shell };

  const stageD = recognizeStageD(dialog, expected, options);
  if (stageD.status === "matched") {
    return { status: "abstain", reason: "STAGE_D_CONTRACT_PRESENT" };
  }
  if (isBudgetAbstainReason(stageD.reason)) {
    return { status: "abstain", reason: stageD.reason };
  }

  const pageEls = resolvePageElements(dialog, options);
  if (pageEls.status !== "matched") return pageEls;

  const expectedIdentity = `${expected.ownerDisplay}/${expected.repoDisplay}`;
  const expectedTransition = `Make ${expected.ownerDisplay}/${expected.repoDisplay} public`;
  const effectsRegion = findExactEffectsRegionInElements(pageEls.value, retainedDocument);
  if (!effectsRegion) {
    return { status: "abstain", reason: "EFFECTS_REGION_MISSING" };
  }

  const budget = new RecognitionBudget(DIALOG_MAX_ELEMENTS, DIALOG_MAX_TEXT_UNITS);
  let identityCount = 0;
  let transitionCount = 0;
  let identityText = "";
  let transitionHeading = "";
  const ackButtons: HTMLButtonElement[] = [];
  let closeButton: HTMLButtonElement | null = null;

  for (const node of pageEls.value) {
    if (!budget.visitElement()) {
      return { status: "abstain", reason: "DIALOG_ELEMENT_BUDGET_EXHAUSTED" };
    }
    const own = normalizedOwnText(node, budget);
    if (own.status === "over_budget") {
      return { status: "abstain", reason: "DIALOG_OWN_TEXT_OVER_BUDGET" };
    }
    const tag = node.tagName.toUpperCase();
    if (own.status === "ok") {
      if (tag === "P" && own.text === expectedIdentity) {
        identityCount += 1;
        identityText = own.text;
      }
      if (tag === "H1" && own.text === expectedTransition) {
        transitionCount += 1;
        transitionHeading = own.text;
      }
    }
    if (tag === "BUTTON") {
      const button = nativeButton(node);
      if (!button) return { status: "abstain", reason: "NATIVE_BUTTON_UNAVAILABLE" };
      const btnOwn = own.status === "ok" ? own : normalizedOwnText(node, budget);
      if (btnOwn.status === "over_budget") {
        return { status: "abstain", reason: "DIALOG_BUTTON_TEXT_OVER_BUDGET" };
      }
      if (btnOwn.status === "ok" && btnOwn.text === STAGE_C_ACK_TEXT && button.type === "button") {
        ackButtons.push(button);
      } else if (isStageBcCloseControl(button, retainedDocument, dialog, null)) {
        if (closeButton && closeButton !== button) {
          return { status: "abstain", reason: "DIALOG_DUPLICATE_CLOSE" };
        }
        closeButton = button;
      } else if (button.type === "submit") {
        return { status: "abstain", reason: "STAGE_C_FINAL_SUBMIT_PRESENT" };
      } else {
        return { status: "abstain", reason: "DIALOG_UNSUPPORTED_INTERACTIVE" };
      }
    } else if (
      classifyDialogInteractiveV2(node, retainedDocument, dialog, {
        finalButton: null,
        closeButton,
        ackButton: ackButtons[0] ?? null,
        effectsRegion,
        retainedForm: null,
        stageMode: "c",
      }) === "reject"
    ) {
      return { status: "abstain", reason: "DIALOG_UNSUPPORTED_INTERACTIVE" };
    }
  }

  if (budget.isOverflowed) return { status: "abstain", reason: "DIALOG_TRAVERSAL_INCOMPLETE" };
  if (identityCount !== 1) return { status: "abstain", reason: "DIALOG_IDENTITY_COUNT" };
  if (transitionCount !== 1) return { status: "abstain", reason: "DIALOG_TRANSITION_COUNT" };
  if (ackButtons.length !== 1) return { status: "abstain", reason: "STAGE_C_ACK_COUNT" };

  const acknowledgementButton = ackButtons[0];
  if (!acknowledgementButton) return { status: "abstain", reason: "STAGE_C_ACK_COUNT" };

  return {
    status: "matched",
    value: {
      dialog,
      identityText,
      transitionHeading,
      acknowledgementButton,
      closeButton,
      effectsRegion,
    },
  };
}

export function recognizeStageB(
  dialog: HTMLDialogElement,
  expected: Fc007RepoIdentity,
  options?: StageRecognitionOptions,
): StageRecognitionResult<StageBcRecognition> {
  const matchesModal = options?.matchesModal ?? defaultMatchesModal;
  const retainedDocument = options?.retainedDocument ?? dialog.ownerDocument;
  const shell = dialogShellValid(dialog, retainedDocument, matchesModal);
  if (shell) return { status: "abstain", reason: shell };

  const stageD = recognizeStageD(dialog, expected, options);
  if (stageD.status === "matched") {
    return { status: "abstain", reason: "STAGE_D_CONTRACT_PRESENT" };
  }
  if (isBudgetAbstainReason(stageD.reason)) {
    return { status: "abstain", reason: stageD.reason };
  }

  const pageEls = resolvePageElements(dialog, options);
  if (pageEls.status !== "matched") return pageEls;

  const expectedIdentity = `${expected.ownerDisplay}/${expected.repoDisplay}`;
  const expectedTransition = `Make ${expected.ownerDisplay}/${expected.repoDisplay} public`;

  const budget = new RecognitionBudget(DIALOG_MAX_ELEMENTS, DIALOG_MAX_TEXT_UNITS);
  let identityCount = 0;
  let transitionCount = 0;
  let identityText = "";
  let transitionHeading = "";
  const ackButtons: HTMLButtonElement[] = [];
  let closeButton: HTMLButtonElement | null = null;

  for (const node of pageEls.value) {
    if (!budget.visitElement()) {
      return { status: "abstain", reason: "DIALOG_ELEMENT_BUDGET_EXHAUSTED" };
    }
    const own = normalizedOwnText(node, budget);
    if (own.status === "over_budget") {
      return { status: "abstain", reason: "DIALOG_OWN_TEXT_OVER_BUDGET" };
    }
    const tag = node.tagName.toUpperCase();
    if (own.status === "ok") {
      if (tag === "P" && own.text === expectedIdentity) {
        identityCount += 1;
        identityText = own.text;
      }
      if (tag === "H1" && own.text === expectedTransition) {
        transitionCount += 1;
        transitionHeading = own.text;
      }
    }
    if (tag === "BUTTON") {
      const button = nativeButton(node);
      if (!button) return { status: "abstain", reason: "NATIVE_BUTTON_UNAVAILABLE" };
      const btnOwn = own.status === "ok" ? own : normalizedOwnText(node, budget);
      if (btnOwn.status === "over_budget") {
        return { status: "abstain", reason: "DIALOG_BUTTON_TEXT_OVER_BUDGET" };
      }
      if (btnOwn.status === "ok" && btnOwn.text === STAGE_B_ACK_TEXT && button.type === "button") {
        ackButtons.push(button);
      } else if (isStageBcCloseControl(button, retainedDocument, dialog, null)) {
        if (closeButton && closeButton !== button) {
          return { status: "abstain", reason: "DIALOG_DUPLICATE_CLOSE" };
        }
        closeButton = button;
      } else if (
        btnOwn.status === "ok" &&
        btnOwn.text === STAGE_D_FINAL_TEXT &&
        button.type === "submit"
      ) {
        return { status: "abstain", reason: "STAGE_B_FINAL_SUBMIT_PRESENT" };
      } else {
        return { status: "abstain", reason: "DIALOG_UNSUPPORTED_INTERACTIVE" };
      }
    } else if (
      classifyDialogInteractiveV2(node, retainedDocument, dialog, {
        finalButton: null,
        closeButton,
        ackButton: ackButtons[0] ?? null,
        effectsRegion: null,
        retainedForm: null,
        stageMode: "b",
      }) === "reject"
    ) {
      return { status: "abstain", reason: "DIALOG_UNSUPPORTED_INTERACTIVE" };
    }
  }

  if (budget.isOverflowed) return { status: "abstain", reason: "DIALOG_TRAVERSAL_INCOMPLETE" };
  if (identityCount !== 1) return { status: "abstain", reason: "DIALOG_IDENTITY_COUNT" };
  if (transitionCount !== 1) return { status: "abstain", reason: "DIALOG_TRANSITION_COUNT" };
  if (ackButtons.length !== 1) return { status: "abstain", reason: "STAGE_B_ACK_COUNT" };

  const acknowledgementButton = ackButtons[0];
  if (!acknowledgementButton) return { status: "abstain", reason: "STAGE_B_ACK_COUNT" };

  return {
    status: "matched",
    value: {
      dialog,
      identityText,
      transitionHeading,
      acknowledgementButton,
      closeButton,
      effectsRegion: null,
    },
  };
}
