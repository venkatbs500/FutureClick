/**
 * FC-006 Native HTMLButtonElement.click capture (Sprint 3)
 *
 * Epistemological Boundary:
 * Capture the isolated-world prototype method once at module load
 * (document_start). Production release uses ONLY this captured function via
 * Reflect.apply on the exact pending.element — never instance .click(),
 * never selectors, never page-world prototype lookup at release time.
 */

export type NativeHtmlButtonClick = (this: HTMLButtonElement) => void;

function captureNativeHtmlButtonClick(): NativeHtmlButtonClick | null {
  if (typeof HTMLButtonElement === "undefined") {
    return null;
  }
  const proto = HTMLButtonElement.prototype;
  if (!proto || typeof proto.click !== "function") {
    return null;
  }
  return proto.click;
}

/** Captured at FC-006 module initialization (before any release). */
export const CAPTURED_HTML_BUTTON_CLICK: NativeHtmlButtonClick | null =
  captureNativeHtmlButtonClick();

/**
 * Invoke the captured native click on an exact button element.
 * Throws if the native method was unavailable at bootstrap.
 */
export function invokeCapturedNativeButtonClick(element: HTMLButtonElement): void {
  const method = CAPTURED_HTML_BUTTON_CLICK;
  if (!method) {
    throw new Error("FC006_NATIVE_CLICK_UNAVAILABLE");
  }
  Reflect.apply(method, element, []);
}
