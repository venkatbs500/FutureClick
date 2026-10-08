/**
 * FC-008 Sprint 5B — browser action-understanding bridge.
 *
 * sanitized ActionObservation
 *   → closed message (optional hop)
 *   → Sprint-5A headless runtime
 *   → inert prediction view model
 *
 * No click, submit, continue, approve, release, or ActionGraph mutation.
 * No persistence. No network. No FC-007 imports.
 *
 * Family is required and must match the supplied frozen bundle. There is no
 * hidden default and no holdout-derived selection.
 */

import type { IdGenerator, IsoTimestamp } from "@futureclick/shared";
import {
  FC008_BROWSER_MESSAGE_FORBIDDEN_KEYS,
  type Fc008UnderstandActionMessage,
  validateFc008BrowserMessage,
} from "./browser-message.js";
import { createFailureDetail } from "./failure-detail.js";
import type { FreshnessBinding } from "./freshness.js";
import type { HeadlessRuntime, HeadlessSupportGates } from "./headless.js";
import {
  HEADLESS_CONCURRENCY,
  HEADLESS_INFERENCE_TIMEOUT_MS,
  createHeadlessRuntime,
} from "./headless.js";
import type { Fc008ModelFamily } from "./hypothesis.js";
import type { ArtifactBundle } from "./inference/artifact.js";
import { validateActionObservation } from "./observation.js";
import {
  RESEARCH_INDICATOR_RETENTION,
  type ResearchIndicatorViewModel,
  researchIndicatorFromResult,
} from "./research-indicator.js";
import { type UnderstandingResult, createFailedResult } from "./result.js";
import type { RuntimeClock } from "./timing.js";

export const BROWSER_BRIDGE_RETENTION = RESEARCH_INDICATOR_RETENTION;

export const EMPTY_BROWSER_INDICATOR: ResearchIndicatorViewModel = Object.freeze({
  predictionAvailable: false,
  predictionStatus: "none",
  predictionFamily: null,
  confidenceBucket: "none",
  abstentionReason: null,
  retentionPolicy: RESEARCH_INDICATOR_RETENTION,
});

export interface BrowserPredictionState {
  readonly indicator: ResearchIndicatorViewModel;
  readonly result: UnderstandingResult | null;
  readonly observationSequence: number | null;
  readonly inputFingerprint: string | null;
  readonly retentionPolicy: typeof BROWSER_BRIDGE_RETENTION;
}

export function createEmptyBrowserPredictionState(): BrowserPredictionState {
  return Object.freeze({
    indicator: EMPTY_BROWSER_INDICATOR,
    result: null,
    observationSequence: null,
    inputFingerprint: null,
    retentionPolicy: BROWSER_BRIDGE_RETENTION,
  });
}

export type BrowserBridgeUnavailableReason =
  | "family-not-specified"
  | "family-unregistered"
  | "family-bundle-mismatch"
  | "artifacts-unavailable"
  | "policy-invalid"
  | "timeout-not-frozen"
  | "disposed";

export interface BrowserBridgeConfig {
  readonly modelFamily?: Fc008ModelFamily;
  readonly bundle?: ArtifactBundle;
  readonly supportGates: HeadlessSupportGates;
  readonly clock: RuntimeClock;
  readonly now: () => IsoTimestamp;
  readonly idGenerator: IdGenerator;
  readonly researchMode?: boolean;
}

export type BrowserBridgeCreation =
  | { readonly status: "ready"; readonly bridge: BrowserActionUnderstandingBridge }
  | { readonly status: "unavailable"; readonly reason: BrowserBridgeUnavailableReason };

export interface BrowserActionUnderstandingBridge {
  readonly modelFamily: Fc008ModelFamily;
  readonly concurrency: typeof HEADLESS_CONCURRENCY;
  readonly inferenceTimeoutMs: typeof HEADLESS_INFERENCE_TIMEOUT_MS;
  understandFromMessage(message: unknown): BrowserPredictionState;
  understandSanitizedObservation(
    observation: unknown,
    observationSequence: number,
  ): BrowserPredictionState;
  currentState(): BrowserPredictionState;
  clear(): BrowserPredictionState;
  invalidateObservation(): BrowserPredictionState;
  dispose(): void;
}

function unavailableResult(): UnderstandingResult {
  return createFailedResult(
    "MODEL_UNAVAILABLE",
    null,
    createFailureDetail("artifact-load", "no-validated-artifact", null),
  );
}

function schemaInvalidResult(): UnderstandingResult {
  return createFailedResult(
    "SCHEMA_INVALID",
    null,
    createFailureDetail("observation-validation", "schema-invalid", null),
  );
}

function freezeState(state: BrowserPredictionState): BrowserPredictionState {
  return Object.freeze({
    indicator: Object.freeze({ ...state.indicator }),
    result: state.result,
    observationSequence: state.observationSequence,
    inputFingerprint: state.inputFingerprint,
    retentionPolicy: BROWSER_BRIDGE_RETENTION,
  });
}

function stateFromResult(
  result: UnderstandingResult,
  observationSequence: number,
  inputFingerprint: string | null,
): BrowserPredictionState {
  return freezeState({
    indicator: researchIndicatorFromResult(result),
    result,
    observationSequence,
    inputFingerprint,
    retentionPolicy: BROWSER_BRIDGE_RETENTION,
  });
}

function messageContainsForbiddenKey(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key === "string") {
      for (const forbidden of FC008_BROWSER_MESSAGE_FORBIDDEN_KEYS) {
        if (key === forbidden) {
          return true;
        }
      }
    }
    const child = (value as Record<PropertyKey, unknown>)[key];
    if (child !== null && typeof child === "object" && messageContainsForbiddenKey(child)) {
      return true;
    }
  }
  return false;
}

/**
 * Construct the browser bridge. Refuses without an explicit family and matching
 * frozen bundle. Does not invent a default family.
 */
export function createBrowserActionUnderstandingBridge(
  config: BrowserBridgeConfig,
): BrowserBridgeCreation {
  if (config.modelFamily === undefined || config.modelFamily === null) {
    return Object.freeze({ status: "unavailable" as const, reason: "family-not-specified" });
  }
  if (config.bundle === undefined || config.bundle === null) {
    return Object.freeze({ status: "unavailable" as const, reason: "artifacts-unavailable" });
  }
  const authority = {
    sequence: 0,
    fingerprint: null as string | null,
    disposed: false,
    isCurrent(binding: FreshnessBinding, inputFingerprint: string): boolean {
      return (
        !this.disposed &&
        binding.observationSequence === this.sequence &&
        inputFingerprint === this.fingerprint
      );
    },
  };
  const created = createHeadlessRuntime({
    modelFamily: config.modelFamily,
    bundle: config.bundle,
    supportGates: config.supportGates,
    freshnessValidator: {
      isCurrent(binding: FreshnessBinding, inputFingerprint: string): boolean {
        return authority.isCurrent(binding, inputFingerprint);
      },
    },
    clock: config.clock,
    now: config.now,
    idGenerator: config.idGenerator,
    researchMode: config.researchMode === true,
  });
  if (created.status !== "ready") {
    return Object.freeze({
      status: "unavailable" as const,
      reason: created.reason === "family-not-specified" ? "family-not-specified" : created.reason,
    });
  }
  const runtime: HeadlessRuntime = created.runtime;

  let published = createEmptyBrowserPredictionState();

  function publish(next: BrowserPredictionState): BrowserPredictionState {
    published = freezeState(next);
    return published;
  }

  function rejectIfDisposed(): BrowserPredictionState | null {
    if (!authority.disposed) {
      return null;
    }
    return publish(stateFromResult(unavailableResult(), authority.sequence, null));
  }

  function scoreObservation(
    observation: unknown,
    observationSequence: number,
    declaredFingerprint: string | null,
  ): BrowserPredictionState {
    const disposed = rejectIfDisposed();
    if (disposed !== null) {
      return disposed;
    }
    // Freshness identity is (sequence, fingerprint):
    //   sequence < current                         → keep current (no replace)
    //   sequence == current AND fingerprint match  → idempotent, no re-inference
    //   sequence == current AND fingerprint differ → SCHEMA_INVALID (fail closed)
    // A freshness sequence cannot carry two semantic identities. SCHEMA_INVALID
    // is the existing closed reason for fingerprint disagreement.
    if (observationSequence < authority.sequence) {
      return published;
    }
    const validated = validateActionObservation(observation);
    if (!validated.valid) {
      return publish(stateFromResult(schemaInvalidResult(), observationSequence, null));
    }
    const fingerprint = validated.value.inputFingerprint;
    if (declaredFingerprint !== null && declaredFingerprint !== fingerprint) {
      return publish(
        stateFromResult(
          createFailedResult(
            "SCHEMA_INVALID",
            validated.value.id,
            createFailureDetail("observation-validation", "schema-invalid", null),
          ),
          observationSequence,
          fingerprint,
        ),
      );
    }
    if (observationSequence === authority.sequence && authority.fingerprint !== null) {
      if (fingerprint === authority.fingerprint) {
        return published;
      }
      // Fail closed without replacing the already-published state for this
      // sequence. The caller receives an ephemeral SCHEMA_INVALID; currentState()
      // remains the valid sequence/fingerprint-A publication.
      return stateFromResult(
        createFailedResult(
          "SCHEMA_INVALID",
          validated.value.id,
          createFailureDetail("observation-validation", "schema-invalid", null),
        ),
        observationSequence,
        authority.fingerprint,
      );
    }
    authority.sequence = observationSequence;
    authority.fingerprint = fingerprint;
    const result = runtime.understandAction(observation);
    if (authority.sequence !== observationSequence || authority.fingerprint !== fingerprint) {
      if (result.outcome === "failed") {
        return publish(stateFromResult(result, observationSequence, fingerprint));
      }
      return publish(createEmptyBrowserPredictionState());
    }
    return publish(stateFromResult(result, observationSequence, fingerprint));
  }

  const bridge: BrowserActionUnderstandingBridge = {
    modelFamily: config.modelFamily,
    concurrency: HEADLESS_CONCURRENCY,
    inferenceTimeoutMs: HEADLESS_INFERENCE_TIMEOUT_MS,
    understandFromMessage(message: unknown): BrowserPredictionState {
      const disposed = rejectIfDisposed();
      if (disposed !== null) {
        return disposed;
      }
      if (messageContainsForbiddenKey(message)) {
        return publish(stateFromResult(schemaInvalidResult(), authority.sequence, null));
      }
      const parsed = validateFc008BrowserMessage(message);
      if (!parsed.valid) {
        return publish(stateFromResult(schemaInvalidResult(), authority.sequence, null));
      }
      const body: Fc008UnderstandActionMessage = parsed.value;
      return scoreObservation(body.observation, body.observationSequence, body.inputFingerprint);
    },
    understandSanitizedObservation(
      observation: unknown,
      observationSequence: number,
    ): BrowserPredictionState {
      return scoreObservation(observation, observationSequence, null);
    },
    currentState(): BrowserPredictionState {
      return published;
    },
    clear(): BrowserPredictionState {
      authority.sequence += 1;
      authority.fingerprint = null;
      return publish(createEmptyBrowserPredictionState());
    },
    invalidateObservation(): BrowserPredictionState {
      return bridge.clear();
    },
    dispose(): void {
      authority.disposed = true;
      authority.fingerprint = null;
      authority.sequence += 1;
      publish(createEmptyBrowserPredictionState());
    },
  };
  return Object.freeze({ status: "ready" as const, bridge: Object.freeze(bridge) });
}
