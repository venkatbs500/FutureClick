/**
 * Browser Observation Factory and Utilities (Sprint FC-005)
 *
 * Epistemological Boundary:
 * Factory constructors that validate and return deeply frozen, detached BrowserObservation instances.
 */

import { generateEntityId } from "@futureclick/shared";
import {
  BROWSER_OBSERVATION_SCHEMA_VERSION,
  type BrowserElementDescriptor,
  type BrowserInteractionDescriptor,
  type BrowserObservation,
  type BrowserObservationId,
  type BrowserObservationMetadata,
  type BrowserPageDescriptor,
} from "./types.js";
import { validateBrowserObservation } from "./validation.js";

export interface CreateBrowserObservationParams {
  readonly id?: BrowserObservationId | undefined;
  readonly capturedAt: import("@futureclick/shared").IsoTimestamp;
  readonly page: BrowserPageDescriptor;
  readonly interaction?: BrowserInteractionDescriptor | undefined;
  readonly element?: BrowserElementDescriptor | undefined;
  readonly metadata: BrowserObservationMetadata;
}

/**
 * Creates a validated, detached, deeply frozen BrowserObservation.
 * Throws an Error if validation fails.
 */
export function createBrowserObservation(
  params: CreateBrowserObservationParams,
): BrowserObservation {
  const candidate = {
    schemaVersion: BROWSER_OBSERVATION_SCHEMA_VERSION,
    id: params.id ?? generateEntityId<"BrowserObservationId">("obs"),
    capturedAt: params.capturedAt,
    page: {
      origin: params.page.origin,
      routeId: params.page.routeId,
    },
    interaction: params.interaction ?? { kind: "activate" },
    element: params.element ?? {
      kind: "button",
      role: "button",
      buttonType: "button",
    },
    metadata: {
      fixtureContract: params.metadata.fixtureContract,
      operation: params.metadata.operation,
      entityKey: params.metadata.entityKey,
      ...(params.metadata.currentVisibility !== undefined
        ? { currentVisibility: params.metadata.currentVisibility }
        : {}),
      ...(params.metadata.requestedVisibility !== undefined
        ? { requestedVisibility: params.metadata.requestedVisibility }
        : {}),
    },
  };

  const validation = validateBrowserObservation(candidate);
  if (!validation.ok) {
    const issueSummary = validation.error
      .map((iss) => `[${iss.code}] ${iss.path}: ${iss.message}`)
      .join("; ");
    throw new Error(`[INVALID_OBSERVATION] Failed to create BrowserObservation: ${issueSummary}`);
  }

  return validation.value;
}

export function isBrowserObservation(value: unknown): value is BrowserObservation {
  return validateBrowserObservation(value).ok;
}
