/**
 * Content Script Entry Point (Sprint FC-005)
 *
 * Epistemological Boundary:
 * Injected into authorized local synthetic fixture pages at document_idle.
 * Initializes the development indicator and observation controller ONLY if location is authorized (Finding M6).
 */

import { isLocationAuthorized } from "./capture.js";
import { BrowserExtensionController } from "./controller.js";

export function bootstrapExtension(): boolean {
  if (typeof window === "undefined" || !window.location) {
    return false;
  }
  // Authorize location BEFORE any UI injection, controller creation, or listener attachment (Finding M6)
  if (!isLocationAuthorized(window.location)) {
    return false;
  }

  try {
    const controller = new BrowserExtensionController();
    controller.init();
    return true;
  } catch {
    return false;
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bootstrapExtension(), { once: true });
  } else {
    bootstrapExtension();
  }
}
