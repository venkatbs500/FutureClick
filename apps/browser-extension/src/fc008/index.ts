/**
 * FC-008 Sprint 5B — extension-side prediction host public surface.
 *
 * Sits beside FC-005 observation. Never imports FC-007 release, interceptor,
 * native-click, continue-validator, or verified-decision modules.
 */

export { FROZEN_BROWSER_ARTIFACT_SHA256, loadBundledArtifactBundle } from "./bundled-source.js";
export { mapBrowserObservationToMessage } from "./browser-observation-map.js";
export {
  createExtensionHostClock,
  createFc008ExtensionRuntime,
} from "./extension-host.js";
export { FC008_DEVELOPMENT_SUPPORT_GATES, readFc008HostConfig } from "./host-config.js";
export { tryCreateFc008ActionUnderstandingSidecar } from "./production-sidecar.js";
export { createEmptyBrowserPredictionState } from "@futureclick/action-understanding";
export type { Fc008HostConfig } from "./host-config.js";
export type {
  Fc008ExtensionRuntime,
  Fc008ExtensionRuntimeOptions,
} from "./extension-host.js";
export type {
  Fc008ProductionSidecar,
  Fc008SidecarBootstrapOptions,
} from "./production-sidecar.js";
