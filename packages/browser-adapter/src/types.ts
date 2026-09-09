/**
 * Pure Browser Adapter Domain Types (Sprint FC-005)
 *
 * Epistemological Boundary:
 * Pure TypeScript types for browser observation validation, adapter dispatch,
 * and canonical context drafting. Contains ZERO DOM or browser-extension runtime dependencies.
 */

import type { Brand, IsoTimestamp } from "@futureclick/shared";

// ============================================================================
// 1. OBSERVATION IDENTITY & SCHEMA VERSION
// ============================================================================

export type BrowserObservationId = Brand<string, "BrowserObservationId">;

export const BROWSER_OBSERVATION_SCHEMA_VERSION = "1.0" as const;
export type BrowserObservationSchemaVersion = typeof BROWSER_OBSERVATION_SCHEMA_VERSION;

// ============================================================================
// 2. OBSERVATION STRUCTURAL CONTRACTS
// ============================================================================

export interface BrowserPageDescriptor {
  readonly origin: string;
  readonly routeId: string;
}

export interface BrowserInteractionDescriptor {
  readonly kind: string;
}

export interface BrowserElementDescriptor {
  readonly kind: string;
  readonly role: string;
  readonly buttonType: string;
}

export interface BrowserObservationMetadata {
  readonly fixtureContract: string;
  readonly operation: string;
  readonly entityKey: string;
  readonly currentVisibility?: string | undefined;
  readonly requestedVisibility?: string | undefined;
}

/**
 * Detached, immutable representation of a user interaction observation captured in a browser.
 * Validated strictly against bounded lengths, closed shapes, and token grammars.
 */
export interface BrowserObservation {
  readonly schemaVersion: BrowserObservationSchemaVersion;
  readonly id: BrowserObservationId;
  readonly capturedAt: IsoTimestamp;
  readonly page: BrowserPageDescriptor;
  readonly interaction: BrowserInteractionDescriptor;
  readonly element: BrowserElementDescriptor;
  readonly metadata: BrowserObservationMetadata;
}

// ============================================================================
// 3. ADAPTER IDENTITY & DECISION MODEL
// ============================================================================

export type AdapterId = Brand<string, "AdapterId">;
export type AdapterVersion = Brand<string, "AdapterVersion">;

/**
 * Closed semantic draft returned by an adapter when an observation matches.
 * Does NOT contain canonical IDs, timestamps, environment, or ActionGraph references.
 * Strictly closed to FC-005 synthetic repository visibility semantics.
 */
export interface BrowserContextDraft {
  readonly kind: "synthetic.repository-visibility";
  readonly entityKey: string;
  readonly entityKind: "repository";
  readonly currentVisibility: "private";
  readonly requestedVisibility: "public";
  readonly intent: {
    readonly verb: "change-access";
    readonly domain: "version_control";
  };
  readonly targetRole: "primary";
}

export type AdapterDecision =
  | { readonly status: "matched"; readonly draft: BrowserContextDraft }
  | { readonly status: "not-applicable"; readonly reasonCode: string }
  | {
      readonly status: "insufficient-evidence";
      readonly reasonCode: string;
      readonly missing: readonly string[];
    }
  | { readonly status: "error"; readonly code: string };

export interface BrowserActionAdapter {
  readonly id: AdapterId;
  readonly version: AdapterVersion;
  readonly description: string;
  assess(observation: BrowserObservation): AdapterDecision;
}

// ============================================================================
// 4. REGISTRY CONTRACT
// ============================================================================

export interface BrowserAdapterRegistry {
  readonly adapters: readonly BrowserActionAdapter[];
  getAdapter(id: AdapterId): BrowserActionAdapter | undefined;
  hasAdapter(id: AdapterId): boolean;
}

// ============================================================================
// 5. FIXED ERROR CODES
// ============================================================================

export const BROWSER_ADAPTER_ERROR_CODES = {
  INVALID_OBSERVATION: "INVALID_OBSERVATION",
  INVALID_CONFIGURATION: "INVALID_CONFIGURATION",
  INVALID_ADAPTER_OUTPUT: "INVALID_ADAPTER_OUTPUT",
  ADAPTER_EXECUTION_FAILED: "ADAPTER_EXECUTION_FAILED",
  AMBIGUOUS_ADAPTER: "AMBIGUOUS_ADAPTER",
  UNSUPPORTED_OBSERVATION: "UNSUPPORTED_OBSERVATION",
  INVALID_ADAPTER: "INVALID_ADAPTER",
  SENSITIVE_CONTROL_EXCLUDED: "SENSITIVE_CONTROL_EXCLUDED",
  UNSUPPORTED_INTERACTION: "UNSUPPORTED_INTERACTION",
} as const;

export type BrowserAdapterErrorCode =
  (typeof BROWSER_ADAPTER_ERROR_CODES)[keyof typeof BROWSER_ADAPTER_ERROR_CODES];
