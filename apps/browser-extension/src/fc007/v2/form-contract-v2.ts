/**
 * FC-007 Sprint 1D V2 — Stage D POST form contract (form-associated Close).
 *
 * Associated-control authority is the UNION of:
 *   A. built-in controls whose retained native `.form` equals the retained form,
 *      discovered from the completed bounded document inventory
 *   B. browser-native form.elements entries (FACE / browser-listed controls)
 *
 * form.elements is NOT a complete authority (e.g. input[type=image] is omitted).
 * form.elements access occurs ONLY AFTER a successful complete bounded document
 * inventory. Explicit item probes are capped at FORM_ELEMENTS_MAX+1; native
 * association-cache construction may walk the already-bounded document
 * population (DOCUMENT_MAX_ELEMENTS_V2) — NOT arbitrary page size / O(25).
 *
 * Never collection.length. Base-target: inventory + retained native attributes.
 */

import { DOCUMENT_MAX_ELEMENTS_V2, FORM_ELEMENTS_MAX } from "../budget.js";
import { isButtonEffectivelyEnabled } from "../form-contract.js";
import type { Fc007RepoIdentity } from "../identity.js";
import { asciiLower } from "../location.js";
import {
  isCompletedDocumentInventory,
  isNativeBuiltInFormAssociatedElement,
  iterateNativeFormControls,
  nativeBuiltInAssociatedForm,
  nativeButtonForm,
  nativeGetAttribute,
  nativeHasAttribute,
} from "../native-dom.js";
import { isApprovedCloseControlV2 } from "./close-v2.js";
import { inventoryDocumentV2 } from "./document-inventory-v2.js";

export interface FormContractRecognitionV2 {
  readonly form: HTMLFormElement;
  readonly button: HTMLButtonElement;
  readonly closeButton: HTMLButtonElement;
  readonly method: "post";
  readonly actionOrigin: string;
  readonly actionPathname: string;
  readonly enctype: string;
  readonly hiddenInputCount: number;
}

export type FormContractResultV2 =
  | { readonly status: "matched"; readonly value: FormContractRecognitionV2 }
  | { readonly status: "abstain"; readonly reason: string };

export type FormContractOptionsV2 = {
  /**
   * Complete bounded document element list from a successful inventoryDocumentV2
   * (the marked frozen array itself — copies are rejected).
   * When omitted, a fresh bounded document inventory is taken BEFORE any
   * form.elements access.
   */
  readonly documentElements?: readonly Element[];
};

function hasOverrideAttr(el: Element, name: string): boolean {
  return nativeHasAttribute(el, name);
}

function classifyAssociatedControl(
  el: Element,
  button: HTMLButtonElement,
  form: HTMLFormElement,
  retainedDocument: Document,
): "hidden" | "submit" | "close" | "unsupported" {
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    if ((input.type || "text").toLowerCase() === "hidden") {
      return "hidden";
    }
    // image, text, checkbox, radio, submit, reset, file, number, email, …
    return "unsupported";
  }
  if (tag === "BUTTON") {
    const btn = el as HTMLButtonElement;
    if (btn === button && btn.type === "submit") {
      return "submit";
    }
    if (isApprovedCloseControlV2(btn, retainedDocument, form, button)) {
      return "close";
    }
    return "unsupported";
  }
  // select, textarea, fieldset, object, output, FACE custom elements, …
  return "unsupported";
}

/**
 * BASE_TARGET from bounded document inventory only — no querySelector.
 * Any <base> with a non-empty target attribute is unsafe for this contract.
 */
function documentHasUnsafeBaseTarget(documentElements: readonly Element[]): boolean {
  for (const el of documentElements) {
    if (el.tagName.toUpperCase() !== "BASE") continue;
    if (!nativeHasAttribute(el, "target")) continue;
    const bt = nativeGetAttribute(el, "target");
    if (bt != null && bt !== "") return true;
  }
  return false;
}

/**
 * Collect unique associated controls via inventory built-in `.form` union
 * form.elements (FACE). Dedupes by exact element identity.
 */
function collectAssociatedControlsUnion(
  form: HTMLFormElement,
  documentElements: readonly Element[],
):
  | { readonly status: "ok"; readonly controls: readonly Element[] }
  | { readonly status: "abstain"; readonly reason: string } {
  if (
    !isCompletedDocumentInventory(documentElements) ||
    documentElements.length > DOCUMENT_MAX_ELEMENTS_V2
  ) {
    return { status: "abstain", reason: "DOCUMENT_INVENTORY_UNPROVEN" };
  }
  const inventorySet = new Set<Element>(documentElements);
  if (!inventorySet.has(form)) {
    return { status: "abstain", reason: "FORM_OUTSIDE_INVENTORY" };
  }
  const associated: Element[] = [];
  const seen = new Set<Element>();

  const pushUnique = (el: Element): boolean => {
    if (seen.has(el)) return true;
    // Semantic cap: 25th unique associated control → overflow.
    if (associated.length >= FORM_ELEMENTS_MAX) {
      return false;
    }
    seen.add(el);
    associated.push(el);
    return true;
  };

  // A. Built-in association from completed bounded document inventory.
  for (const el of documentElements) {
    if (!isNativeBuiltInFormAssociatedElement(el)) continue;
    let assoc: HTMLFormElement | null;
    try {
      assoc = nativeBuiltInAssociatedForm(el);
    } catch {
      return { status: "abstain", reason: "NATIVE_FORM_GETTER_UNAVAILABLE" };
    }
    if (assoc !== form) continue;
    if (!pushUnique(el)) {
      return { status: "abstain", reason: "FORM_ELEMENTS_TOO_MANY" };
    }
  }

  // B. Secondary form.elements — ONLY after complete document inventory.
  //    Catches FACE / browser-listed controls omitted from built-in scan.
  //    Work claim: item probes ≤ FORM_ELEMENTS_MAX+1; native cache walk bounded
  //    by DOCUMENT_MAX_ELEMENTS_V2 (already completed inventory domain).
  const iterated = iterateNativeFormControls(form, FORM_ELEMENTS_MAX, documentElements);
  if (iterated.status === "unavailable") {
    return { status: "abstain", reason: "NATIVE_FORM_ELEMENTS_UNAVAILABLE" };
  }
  if (iterated.status === "overflow") {
    return { status: "abstain", reason: "FORM_ELEMENTS_TOO_MANY" };
  }

  for (const el of iterated.controls) {
    if (!inventorySet.has(el)) {
      return { status: "abstain", reason: "FORM_ELEMENTS_OUTSIDE_INVENTORY" };
    }
    if (!pushUnique(el)) {
      return { status: "abstain", reason: "FORM_ELEMENTS_TOO_MANY" };
    }
  }

  return { status: "ok", controls: associated };
}

export function recognizeFormContractV2(
  button: HTMLButtonElement,
  form: HTMLFormElement,
  expected: Fc007RepoIdentity,
  retainedDocument: Document,
  closeButton: HTMLButtonElement,
  options?: FormContractOptionsV2,
): FormContractResultV2 {
  if (typeof HTMLButtonElement === "undefined" || typeof HTMLFormElement === "undefined") {
    return { status: "abstain", reason: "NATIVE_CONSTRUCTOR_UNAVAILABLE" };
  }
  if (!(button instanceof HTMLButtonElement)) {
    return { status: "abstain", reason: "NOT_BUTTON" };
  }
  if (!(form instanceof HTMLFormElement)) {
    return { status: "abstain", reason: "NOT_FORM" };
  }
  if (!(closeButton instanceof HTMLButtonElement)) {
    return { status: "abstain", reason: "NOT_CLOSE_BUTTON" };
  }
  if (button.type !== "submit") {
    return { status: "abstain", reason: "BUTTON_TYPE" };
  }
  if (!button.isConnected || button.ownerDocument !== retainedDocument) {
    return { status: "abstain", reason: "BUTTON_DOCUMENT" };
  }
  if (!form.isConnected || form.ownerDocument !== retainedDocument) {
    return { status: "abstain", reason: "FORM_DOCUMENT" };
  }
  let buttonForm: HTMLFormElement | null;
  try {
    buttonForm = nativeButtonForm(button);
  } catch {
    return { status: "abstain", reason: "NATIVE_FORM_GETTER_UNAVAILABLE" };
  }
  if (buttonForm !== form) {
    return { status: "abstain", reason: "BUTTON_FORM_MISMATCH" };
  }
  if (!isApprovedCloseControlV2(closeButton, retainedDocument, form, button)) {
    return { status: "abstain", reason: "CLOSE_V2_REJECTED" };
  }

  const enabled = isButtonEffectivelyEnabled(button);
  if (!enabled.ok) {
    return { status: "abstain", reason: enabled.reason ?? "BUTTON_NOT_ENABLED" };
  }

  if (button.name !== "") {
    return { status: "abstain", reason: "SUBMITTER_NAME_NONEMPTY" };
  }

  if (form.noValidate !== false) {
    return { status: "abstain", reason: "FORM_NOVALIDATE" };
  }
  if (button.formNoValidate !== false) {
    return { status: "abstain", reason: "BUTTON_FORM_NOVALIDATE" };
  }

  if (hasOverrideAttr(button, "formaction")) {
    return { status: "abstain", reason: "BUTTON_FORMACTION" };
  }
  if (hasOverrideAttr(button, "formmethod")) {
    return { status: "abstain", reason: "BUTTON_FORMMETHOD" };
  }
  if (hasOverrideAttr(button, "formtarget")) {
    return { status: "abstain", reason: "BUTTON_FORMTARGET" };
  }
  if (hasOverrideAttr(button, "formenctype")) {
    return { status: "abstain", reason: "BUTTON_FORMENCTYPE" };
  }

  const method = (form.method || "").toLowerCase();
  if (method !== "post") {
    return { status: "abstain", reason: "FORM_METHOD" };
  }

  const targetAttr = nativeGetAttribute(form, "target");
  if (targetAttr != null && targetAttr !== "") {
    return { status: "abstain", reason: "FORM_TARGET" };
  }

  // Document inventory MUST complete before any form.elements access.
  let documentElements = options?.documentElements;
  if (!documentElements) {
    const inv = inventoryDocumentV2(retainedDocument);
    if (inv.status !== "ok") {
      return { status: "abstain", reason: inv.reason };
    }
    documentElements = inv.elements;
  }
  if (!isCompletedDocumentInventory(documentElements)) {
    return { status: "abstain", reason: "DOCUMENT_INVENTORY_UNPROVEN" };
  }
  if (documentHasUnsafeBaseTarget(documentElements)) {
    return { status: "abstain", reason: "BASE_TARGET" };
  }

  let actionUrl: URL;
  try {
    actionUrl = new URL(form.action);
  } catch {
    return { status: "abstain", reason: "FORM_ACTION_UNPARSEABLE" };
  }

  if (actionUrl.protocol !== "https:") {
    return { status: "abstain", reason: "FORM_ACTION_PROTOCOL" };
  }
  if (actionUrl.hostname !== "github.com") {
    return { status: "abstain", reason: "FORM_ACTION_HOST" };
  }
  if (actionUrl.port !== "" && actionUrl.port !== "443") {
    return { status: "abstain", reason: "FORM_ACTION_PORT" };
  }
  if (actionUrl.username !== "" || actionUrl.password !== "") {
    return { status: "abstain", reason: "FORM_ACTION_CREDENTIALS" };
  }
  if (actionUrl.search !== "" || actionUrl.hash !== "") {
    return { status: "abstain", reason: "FORM_ACTION_QUERY_OR_HASH" };
  }

  const expectedPath = `/${expected.ownerDisplay}/${expected.repoDisplay}/settings/set_visibility`;
  const expectedPathNorm = `/${expected.ownerNormalized}/${expected.repoNormalized}/settings/set_visibility`;
  const pathNorm = actionUrl.pathname
    .split("/")
    .map((seg, idx) => (idx === 1 || idx === 2 ? asciiLower(seg) : seg))
    .join("/");
  if (actionUrl.pathname !== expectedPath && pathNorm !== expectedPathNorm) {
    return { status: "abstain", reason: "FORM_ACTION_PATH" };
  }
  const segs = actionUrl.pathname.split("/");
  if (
    segs.length !== 5 ||
    segs[0] !== "" ||
    asciiLower(segs[1] ?? "") !== expected.ownerNormalized ||
    asciiLower(segs[2] ?? "") !== expected.repoNormalized ||
    segs[3] !== "settings" ||
    segs[4] !== "set_visibility"
  ) {
    return { status: "abstain", reason: "FORM_ACTION_PATH" };
  }

  const enctype = form.enctype || nativeGetAttribute(form, "enctype") || "";
  if (enctype !== "application/x-www-form-urlencoded") {
    return { status: "abstain", reason: "FORM_ENCTYPE" };
  }

  const union = collectAssociatedControlsUnion(form, documentElements);
  if (union.status === "abstain") {
    return { status: "abstain", reason: union.reason };
  }

  let hiddenCount = 0;
  let closeCount = 0;
  let submitCount = 0;

  for (const el of union.controls) {
    const kind = classifyAssociatedControl(el, button, form, retainedDocument);
    if (kind === "hidden") {
      hiddenCount += 1;
      continue;
    }
    if (kind === "submit") {
      submitCount += 1;
      continue;
    }
    if (kind === "close") {
      closeCount += 1;
      continue;
    }
    return { status: "abstain", reason: "FORM_UNSUPPORTED_CONTROL" };
  }

  if (hiddenCount > 8) {
    return { status: "abstain", reason: "FORM_HIDDEN_TOO_MANY" };
  }
  if (closeCount !== 1) {
    return { status: "abstain", reason: "FORM_CLOSE_COUNT" };
  }
  if (submitCount !== 1) {
    return { status: "abstain", reason: "FORM_SUBMIT_COUNT" };
  }

  return {
    status: "matched",
    value: {
      form,
      button,
      closeButton,
      method: "post",
      actionOrigin: "https://github.com",
      actionPathname: `/${expected.ownerNormalized}/${expected.repoNormalized}/settings/set_visibility`,
      enctype: "application/x-www-form-urlencoded",
      hiddenInputCount: hiddenCount,
    },
  };
}
