/**
 * FC-007 Sprint 1D V2 — form-associated Close control predicate.
 */

import {
  nativeButtonForm,
  nativeContains,
  nativeGetAttribute,
  nativeHasAttribute,
} from "../native-dom.js";

function normalizeAriaLabel(raw: string | null): string | null {
  if (raw == null) return null;
  return raw.replace(/\s+/g, " ").trim();
}

function hasOverrideAttr(el: Element, name: string): boolean {
  return nativeHasAttribute(el, name);
}

/**
 * Stage D Close: must be associated with the retained POST form.
 */
export function isApprovedCloseControlV2(
  el: Element,
  retainedDocument: Document,
  retainedForm: HTMLFormElement,
  finalButton: HTMLButtonElement | null,
): boolean {
  if (typeof HTMLButtonElement === "undefined") return false;
  if (!(el instanceof HTMLButtonElement)) return false;
  if (el.type !== "button") return false;
  if (!el.isConnected || el.ownerDocument !== retainedDocument) return false;
  if (finalButton && el === finalButton) return false;
  try {
    if (nativeButtonForm(el) !== retainedForm) return false;
  } catch {
    return false;
  }
  if (normalizeAriaLabel(nativeGetAttribute(el, "aria-label")) !== "Close") return false;
  if (hasOverrideAttr(el, "formaction")) return false;
  if (hasOverrideAttr(el, "formmethod")) return false;
  if (hasOverrideAttr(el, "formtarget")) return false;
  if (hasOverrideAttr(el, "formenctype")) return false;
  return true;
}

/**
 * Stage B/C optional Close — formless or any form inside the dialog.
 */
export function isStageBcCloseControl(
  el: Element,
  retainedDocument: Document,
  dialog: HTMLDialogElement,
  finalButton: HTMLButtonElement | null,
): boolean {
  if (typeof HTMLButtonElement === "undefined") return false;
  if (!(el instanceof HTMLButtonElement)) return false;
  if (el.type !== "button") return false;
  if (!el.isConnected || el.ownerDocument !== retainedDocument) return false;
  if (finalButton && el === finalButton) return false;
  if (normalizeAriaLabel(nativeGetAttribute(el, "aria-label")) !== "Close") return false;
  if (hasOverrideAttr(el, "formaction")) return false;
  if (hasOverrideAttr(el, "formmethod")) return false;
  if (hasOverrideAttr(el, "formtarget")) return false;
  if (hasOverrideAttr(el, "formenctype")) return false;
  let form: HTMLFormElement | null;
  try {
    form = nativeButtonForm(el);
  } catch {
    return false;
  }
  if (form != null && !nativeContains(dialog, form)) return false;
  return true;
}
