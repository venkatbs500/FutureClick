/**
 * Browser extension foundation for FutureClick (Sprint FC-005).
 * Architectural anchor for browser-specific state capture and preview overlays.
 */

export interface BrowserExtensionConfig {
  readonly manifestVersion: 3;
  readonly interceptActions: boolean;
  readonly telemetryEnabled: boolean;
}

export function getInitialExtensionConfig(): BrowserExtensionConfig {
  return {
    manifestVersion: 3,
    interceptActions: false, // Inactive during engineering foundation sprint
    telemetryEnabled: false,
  };
}

export * from "./content/capture.js";
export * from "./content/controller.js";
export * from "./content/indicator.js";
