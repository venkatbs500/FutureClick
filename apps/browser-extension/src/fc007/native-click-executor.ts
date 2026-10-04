/**
 * FC-007 Sprint 3B — isolated native click executor.
 *
 * Captures HTMLButtonElement.prototype.click at module initialization in the
 * isolated world. Page-realm prototype / instance overrides cannot replace this
 * binding. NO selector recovery. NO fallback executor. Click-only capability.
 *
 * Not imported by production Continue / bootstrap (Sprint 3C wires later).
 */

/** Captured at module load — isolated-world native function only. */
const CAPTURED_NATIVE_BUTTON_CLICK: ((this: HTMLButtonElement) => void) | null =
  typeof HTMLButtonElement !== "undefined" &&
  typeof HTMLButtonElement.prototype.click === "function"
    ? HTMLButtonElement.prototype.click
    : null;

/**
 * Invoke the captured native HTMLButtonElement.prototype.click on an exact button.
 * Uses Reflect.apply — never reads instance `.click` at execution time.
 */
export function invokeCapturedNativeClick(exactButton: HTMLButtonElement): void {
  if (!(exactButton instanceof HTMLButtonElement)) {
    throw new Error("FC007_NATIVE_CLICK_NOT_BUTTON");
  }
  if (!CAPTURED_NATIVE_BUTTON_CLICK) {
    throw new Error("FC007_NATIVE_CLICK_UNAVAILABLE");
  }
  Reflect.apply(CAPTURED_NATIVE_BUTTON_CLICK, exactButton, []);
}

/** Test/smoke diagnostic: whether capture succeeded at module load. */
export function isNativeClickCaptureAvailable(): boolean {
  return CAPTURED_NATIVE_BUTTON_CLICK !== null;
}
