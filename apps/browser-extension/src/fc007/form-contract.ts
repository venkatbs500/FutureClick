/**
 * FC-007 Sprint 1 — submit button + POST form contract.
 */

import { FORM_ELEMENTS_MAX } from "./budget.js";
import type { Fc007RepoIdentity } from "./identity.js";
import { asciiLower } from "./location.js";

export interface FormContractRecognition {
  readonly form: HTMLFormElement;
  readonly button: HTMLButtonElement;
  readonly method: "post";
  readonly actionOrigin: string;
  readonly actionPathname: string;
  readonly enctype: string;
}

export type FormContractResult =
  | { readonly status: "matched"; readonly value: FormContractRecognition }
  | { readonly status: "abstain"; readonly reason: string };

function hasOverrideAttr(el: Element, name: string): boolean {
  return el.hasAttribute(name);
}

export function isButtonEffectivelyEnabled(button: HTMLButtonElement): {
  readonly ok: boolean;
  readonly reason?: string;
} {
  if (button.disabled !== false) {
    return { ok: false, reason: "BUTTON_DISABLED" };
  }
  if (button.getAttribute("aria-disabled") === "true") {
    return { ok: false, reason: "BUTTON_ARIA_DISABLED" };
  }
  try {
    if (button.matches(":disabled") !== false) {
      return { ok: false, reason: "BUTTON_MATCHES_DISABLED" };
    }
  } catch {
    return { ok: false, reason: "DISABLED_PSEUDO_UNSUPPORTED" };
  }
  return { ok: true };
}

export function recognizeFormContract(
  button: HTMLButtonElement,
  form: HTMLFormElement,
  expected: Fc007RepoIdentity,
  retainedDocument: Document,
): FormContractResult {
  if (typeof HTMLButtonElement === "undefined" || typeof HTMLFormElement === "undefined") {
    return { status: "abstain", reason: "NATIVE_CONSTRUCTOR_UNAVAILABLE" };
  }
  if (!(button instanceof HTMLButtonElement)) {
    return { status: "abstain", reason: "NOT_BUTTON" };
  }
  if (!(form instanceof HTMLFormElement)) {
    return { status: "abstain", reason: "NOT_FORM" };
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
  if (button.form !== form) {
    return { status: "abstain", reason: "BUTTON_FORM_MISMATCH" };
  }

  const enabled = isButtonEffectivelyEnabled(button);
  if (!enabled.ok) {
    return { status: "abstain", reason: enabled.reason ?? "BUTTON_NOT_ENABLED" };
  }

  // Submitter name must be empty; never read button.value.
  if (button.name !== "") {
    return { status: "abstain", reason: "SUBMITTER_NAME_NONEMPTY" };
  }

  if (form.noValidate !== false) {
    return { status: "abstain", reason: "FORM_NOVALIDATE" };
  }
  if (button.formNoValidate !== false) {
    return { status: "abstain", reason: "BUTTON_FORM_NOVALIDATE" };
  }

  // Override detection uses attribute presence (properties reflect form defaults).
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

  const targetAttr = form.getAttribute("target");
  if (targetAttr != null && targetAttr !== "") {
    return { status: "abstain", reason: "FORM_TARGET" };
  }

  const baseTarget = retainedDocument.querySelector("base[target]");
  if (baseTarget) {
    const bt = baseTarget.getAttribute("target");
    if (bt != null && bt !== "") {
      return { status: "abstain", reason: "BASE_TARGET" };
    }
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
  // Compare using normalized owner/repo segments; display path may match route display.
  if (actionUrl.pathname !== expectedPath && pathNorm !== expectedPathNorm) {
    return { status: "abstain", reason: "FORM_ACTION_PATH" };
  }
  // Also require normalized identity match always.
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

  const enctype = form.enctype || form.getAttribute("enctype") || "";
  if (enctype !== "application/x-www-form-urlencoded") {
    return { status: "abstain", reason: "FORM_ENCTYPE" };
  }

  const elements = form.elements;
  const len = elements.length;
  if (len > FORM_ELEMENTS_MAX) {
    return { status: "abstain", reason: "FORM_ELEMENTS_TOO_MANY" };
  }

  for (let i = 0; i < len; i += 1) {
    const el = elements.item(i);
    if (!el) {
      return { status: "abstain", reason: "FORM_ELEMENTS_MISSING" };
    }
    if (el === button) continue;
    if (el.tagName.toUpperCase() === "INPUT") {
      const input = el as HTMLInputElement;
      if ((input.type || "text").toLowerCase() === "hidden") {
        // Never read values.
        continue;
      }
    }
    return { status: "abstain", reason: "FORM_UNSUPPORTED_CONTROL" };
  }

  return {
    status: "matched",
    value: {
      form,
      button,
      method: "post",
      actionOrigin: "https://github.com",
      actionPathname: `/${expected.ownerNormalized}/${expected.repoNormalized}/settings/set_visibility`,
      enctype: "application/x-www-form-urlencoded",
    },
  };
}
