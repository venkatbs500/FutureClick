/**
 * FC-008 Sprint 5B — optional production sidecar for the FC-005 content host.
 *
 * Created only when trusted host configuration supplies an explicit family,
 * explicit support gates, and an explicit local artifact payload. There is no
 * hidden default, no holdout-derived family choice, and no static import of
 * both model families. The sidecar receives the already-captured
 * BrowserObservation and never clicks, submits, continues, or releases.
 */

import type { BrowserObservation } from "@futureclick/browser-adapter";
import type { ActionUnderstandingSidecar } from "../content/controller.js";
import type { BrowserArtifactJson } from "./bundled-source.js";
import { loadBundledArtifactBundle } from "./bundled-source.js";
import {
  type Fc008ExtensionRuntime,
  type Fc008ExtensionRuntimeOptions,
  createFc008ExtensionRuntime,
} from "./extension-host.js";
import { type Fc008HostConfig, readFc008HostConfig } from "./host-config.js";

export interface Fc008ProductionSidecar extends ActionUnderstandingSidecar {
  readonly runtime: Fc008ExtensionRuntime;
}

export interface Fc008SidecarBootstrapOptions {
  readonly hostConfig?: Fc008HostConfig;
  readonly artifactJson?: BrowserArtifactJson;
  readonly now?: Fc008ExtensionRuntimeOptions["now"];
  readonly clock?: Fc008ExtensionRuntimeOptions["clock"];
  readonly idGenerator?: Fc008ExtensionRuntimeOptions["idGenerator"];
}

/**
 * Build the optional FC-008 sidecar. Returns undefined when family or support
 * gates are absent so existing FC-005 behavior is unchanged.
 */
export function tryCreateFc008ActionUnderstandingSidecar(
  options: Fc008SidecarBootstrapOptions = {},
): Fc008ProductionSidecar | undefined {
  const host = options.hostConfig ?? readFc008HostConfig();
  if (host.modelFamily === undefined || host.supportGates === undefined) {
    return undefined;
  }
  const artifactJson = options.artifactJson;
  if (artifactJson === undefined || artifactJson.modelFamily !== host.modelFamily) {
    return undefined;
  }
  const runtime = createFc008ExtensionRuntime({
    hostConfig: host,
    modelFamily: host.modelFamily,
    supportGates: host.supportGates,
    bundle: loadBundledArtifactBundle(artifactJson),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.idGenerator === undefined ? {} : { idGenerator: options.idGenerator }),
  });
  let sequence = 0;
  return Object.freeze({
    runtime,
    observe(observation: BrowserObservation): void {
      sequence += 1;
      runtime.understandBrowserObservation(observation, sequence);
    },
    clear(): void {
      runtime.clear();
    },
  });
}
