/**
 * Desktop application container placeholder.
 * Architectural bridge coordinating platform adapters with the consequence engine.
 */

export interface DesktopRuntimeConfig {
  readonly platform: "macos" | "windows" | "linux" | "unknown";
  readonly nativeBridgeEnabled: boolean;
  readonly daemonRunning: boolean;
}

export function createDesktopConfig(
  platform: "macos" | "windows" | "linux" | "unknown",
): DesktopRuntimeConfig {
  return {
    platform,
    nativeBridgeEnabled: false,
    daemonRunning: false,
  };
}
