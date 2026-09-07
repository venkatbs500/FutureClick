/**
 * Browser extension foundation placeholder.
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
