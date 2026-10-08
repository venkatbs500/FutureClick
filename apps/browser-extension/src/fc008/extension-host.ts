/**
 * FC-008 Sprint 5B — extension-side prediction host.
 *
 * Sits beside FC-005 observation. Never imports FC-007 release, interceptor,
 * native-click, continue-validator, or verified-decision modules.
 */

import {
  type ArtifactBundle,
  type BrowserActionUnderstandingBridge,
  type BrowserPredictionState,
  type Fc008ModelFamily,
  type HeadlessSupportGates,
  type RuntimeClock,
  createBrowserActionUnderstandingBridge,
  createEmptyBrowserPredictionState,
  createFailedResult,
  createFailureDetail,
  researchIndicatorFromResult,
} from "@futureclick/action-understanding";
import type { BrowserObservation } from "@futureclick/browser-adapter";
import {
  type IdGenerator,
  type IsoTimestamp,
  createDeterministicIdGenerator,
  currentIsoTimestamp,
} from "@futureclick/shared";
import { mapBrowserObservationToMessage } from "./browser-observation-map.js";
import { type Fc008HostConfig, readFc008HostConfig } from "./host-config.js";

export interface Fc008ExtensionRuntimeOptions {
  readonly hostConfig?: Fc008HostConfig;
  readonly modelFamily?: Fc008ModelFamily;
  readonly bundle?: ArtifactBundle;
  readonly supportGates?: HeadlessSupportGates;
  readonly now?: () => IsoTimestamp;
  readonly idGenerator?: IdGenerator;
  readonly clock?: RuntimeClock;
}

export interface Fc008ExtensionRuntime {
  readonly available: boolean;
  readonly unavailableReason: string | null;
  understandBrowserObservation(
    observation: BrowserObservation,
    observationSequence: number,
  ): BrowserPredictionState;
  understandMessage(message: unknown): BrowserPredictionState;
  currentState(): BrowserPredictionState;
  clear(): BrowserPredictionState;
  invalidateObservation(): BrowserPredictionState;
  dispose(): void;
}

/**
 * Host clock. Prefer `performance.now`. If it is missing, fall back to
 * `Date.now` so the 250 ms publication deadline can still fire. Last resort
 * zero is only used when both clocks are unusable.
 */
export function createExtensionHostClock(
  performanceLike: { readonly now?: () => number } | null | undefined = typeof performance !==
  "undefined"
    ? performance
    : undefined,
  dateNow: () => number = Date.now,
): RuntimeClock {
  return {
    nowMs(): number {
      if (performanceLike != null && typeof performanceLike.now === "function") {
        const reading = performanceLike.now();
        if (typeof reading === "number" && Number.isFinite(reading) && reading >= 0) {
          return reading;
        }
      }
      const fallback = dateNow();
      if (typeof fallback === "number" && Number.isFinite(fallback) && fallback >= 0) {
        return fallback;
      }
      return 0;
    },
  };
}

function unavailableState(): BrowserPredictionState {
  const failed = createFailedResult(
    "MODEL_UNAVAILABLE",
    null,
    createFailureDetail("artifact-load", "no-validated-artifact", null),
  );
  return Object.freeze({
    indicator: researchIndicatorFromResult(failed),
    result: failed,
    observationSequence: null,
    inputFingerprint: null,
    retentionPolicy: "ephemeral-memory-only" as const,
  });
}

function createUnavailableHost(reason: string): Fc008ExtensionRuntime {
  const unavailable = unavailableState();
  let published: BrowserPredictionState = unavailable;
  return Object.freeze({
    available: false,
    unavailableReason: reason,
    understandBrowserObservation(): BrowserPredictionState {
      published = unavailable;
      return published;
    },
    understandMessage(): BrowserPredictionState {
      published = unavailable;
      return published;
    },
    currentState(): BrowserPredictionState {
      return published;
    },
    clear(): BrowserPredictionState {
      published = createEmptyBrowserPredictionState();
      return published;
    },
    invalidateObservation(): BrowserPredictionState {
      published = createEmptyBrowserPredictionState();
      return published;
    },
    dispose(): void {
      published = createEmptyBrowserPredictionState();
    },
  });
}

/**
 * Create the extension prediction host. Without an explicit family, matching
 * frozen bundle, and explicit support gates the host stays unavailable.
 */
export function createFc008ExtensionRuntime(
  options: Fc008ExtensionRuntimeOptions = {},
): Fc008ExtensionRuntime {
  const host = options.hostConfig ?? readFc008HostConfig();
  const modelFamily = options.modelFamily ?? host.modelFamily;
  const supportGates = options.supportGates ?? host.supportGates;
  const now = options.now ?? currentIsoTimestamp;

  if (modelFamily === undefined) {
    return createUnavailableHost("family-not-specified");
  }
  if (supportGates === undefined) {
    return createUnavailableHost("policy-invalid");
  }

  const created = createBrowserActionUnderstandingBridge({
    modelFamily,
    supportGates,
    ...(options.bundle === undefined ? {} : { bundle: options.bundle }),
    clock: options.clock ?? createExtensionHostClock(),
    now,
    idGenerator: options.idGenerator ?? createDeterministicIdGenerator("fc008-browser"),
  });

  if (created.status !== "ready") {
    return createUnavailableHost(created.reason);
  }

  const bridge: BrowserActionUnderstandingBridge = created.bridge;
  return Object.freeze({
    available: true,
    unavailableReason: null,
    understandBrowserObservation(
      observation: BrowserObservation,
      observationSequence: number,
    ): BrowserPredictionState {
      const mapped = mapBrowserObservationToMessage(observation, observationSequence, now());
      if (!mapped.ok) {
        return bridge.currentState();
      }
      return bridge.understandFromMessage(mapped.message);
    },
    understandMessage(message: unknown): BrowserPredictionState {
      return bridge.understandFromMessage(message);
    },
    currentState(): BrowserPredictionState {
      return bridge.currentState();
    },
    clear(): BrowserPredictionState {
      return bridge.clear();
    },
    invalidateObservation(): BrowserPredictionState {
      return bridge.invalidateObservation();
    },
    dispose(): void {
      bridge.dispose();
    },
  });
}
