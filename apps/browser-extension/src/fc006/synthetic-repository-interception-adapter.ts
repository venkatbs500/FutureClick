/**
 * FC-006 Local Synthetic Repository Visibility Interception Adapter
 *
 * Epistemological Boundary:
 * Extension-local BrowserActionAdapter for the FC-006 interception fixture.
 * Implements the frozen BrowserActionAdapter interface without modifying
 * packages/browser-adapter.
 *
 * IMPORTANT:
 * - Truthful FC-006 provenance (route/contract/adapter identity).
 * - Does NOT fake FC-005 route or contract identity.
 * - Returns the existing closed BrowserContextDraft shape.
 * - Shared applicability helper is the single semantic matcher used by
 *   both the adapter and Sprint 2 interception eligibility.
 */

import {
  type AdapterDecision,
  type AdapterId,
  type AdapterVersion,
  type BrowserActionAdapter,
  type BrowserContextDraft,
  type BrowserObservation,
  isValidMachineToken,
  MAX_ENTITY_KEY_LENGTH,
} from "@futureclick/browser-adapter";

export const FC006_ADAPTER_ID = "browser.synthetic.repository-visibility-interception" as AdapterId;
export const FC006_ADAPTER_VERSION = "1.0" as AdapterVersion;

export const FC006_ORIGIN = "http://127.0.0.1:4173";
export const FC006_ROUTE_ID = "synthetic.repository-visibility-interception";
export const FC006_INTERACTION_KIND = "activate";
export const FC006_ELEMENT_KIND = "button";
export const FC006_ELEMENT_ROLE = "button";
export const FC006_ELEMENT_BUTTON_TYPE = "button";
export const FC006_FIXTURE_CONTRACT = "fc006.repository-visibility-interception.v1";
export const FC006_OPERATION = "repository.visibility.change";

/**
 * Closed FC-006-local applicability result shared by adapter assess() and
 * synchronous interception eligibility. Not part of the frozen adapter interface.
 */
export type Fc006ApplicabilityResult =
  | { readonly status: "matched"; readonly draft: BrowserContextDraft }
  | { readonly status: "unsupported"; readonly reasonCode: string }
  | {
      readonly status: "insufficient-evidence";
      readonly reasonCode: string;
      readonly missing: readonly string[];
    };

/**
 * Pure semantic matcher for the exact FC-006 private → public slice.
 * Capture success alone is never enough for interception eligibility.
 */
export function assessFc006RepositoryVisibilityObservation(
  observation: BrowserObservation,
): Fc006ApplicabilityResult {
  if (observation.page.origin !== FC006_ORIGIN) {
    return { status: "unsupported", reasonCode: "UNAUTHORIZED_ORIGIN" };
  }

  if (observation.page.routeId !== FC006_ROUTE_ID) {
    return { status: "unsupported", reasonCode: "UNMATCHED_ROUTE" };
  }

  if (observation.interaction.kind !== FC006_INTERACTION_KIND) {
    return { status: "unsupported", reasonCode: "UNMATCHED_INTERACTION" };
  }

  if (observation.element.kind !== FC006_ELEMENT_KIND) {
    return { status: "unsupported", reasonCode: "UNMATCHED_ELEMENT_KIND" };
  }
  if (observation.element.role !== FC006_ELEMENT_ROLE) {
    return { status: "unsupported", reasonCode: "UNMATCHED_ELEMENT_ROLE" };
  }
  if (observation.element.buttonType !== FC006_ELEMENT_BUTTON_TYPE) {
    return { status: "unsupported", reasonCode: "UNMATCHED_BUTTON_TYPE" };
  }

  if (observation.metadata.fixtureContract !== FC006_FIXTURE_CONTRACT) {
    return { status: "unsupported", reasonCode: "UNMATCHED_FIXTURE_CONTRACT" };
  }

  if (observation.metadata.operation !== FC006_OPERATION) {
    return { status: "unsupported", reasonCode: "UNMATCHED_OPERATION" };
  }

  if (!isValidMachineToken(observation.metadata.entityKey, MAX_ENTITY_KEY_LENGTH)) {
    return { status: "unsupported", reasonCode: "INVALID_ENTITY_KEY" };
  }

  const currentVis = observation.metadata.currentVisibility;
  if (currentVis === undefined) {
    return {
      status: "insufficient-evidence",
      reasonCode: "MISSING_CURRENT_VISIBILITY",
      missing: ["metadata.currentVisibility"],
    };
  }

  const requestedVis = observation.metadata.requestedVisibility;
  if (requestedVis === undefined) {
    return {
      status: "insufficient-evidence",
      reasonCode: "MISSING_REQUESTED_VISIBILITY",
      missing: ["metadata.requestedVisibility"],
    };
  }

  if (currentVis !== "private" || requestedVis !== "public") {
    return {
      status: "unsupported",
      reasonCode: "UNMATCHED_VISIBILITY_TRANSITION",
    };
  }

  const draft: BrowserContextDraft = {
    kind: "synthetic.repository-visibility",
    entityKey: observation.metadata.entityKey,
    entityKind: "repository",
    currentVisibility: "private",
    requestedVisibility: "public",
    intent: {
      verb: "change-access",
      domain: "version_control",
    },
    targetRole: "primary",
  };

  return {
    status: "matched",
    draft: Object.freeze(draft),
  };
}

export const syntheticRepositoryInterceptionAdapter: BrowserActionAdapter = Object.freeze({
  id: FC006_ADAPTER_ID,
  version: FC006_ADAPTER_VERSION,
  description:
    "Maps FC-006 synthetic repository visibility interception observations to a canonical version control draft.",

  assess(observation: BrowserObservation): AdapterDecision {
    const applicability = assessFc006RepositoryVisibilityObservation(observation);

    if (applicability.status === "matched") {
      return {
        status: "matched",
        draft: applicability.draft,
      };
    }

    if (applicability.status === "insufficient-evidence") {
      return {
        status: "insufficient-evidence",
        reasonCode: applicability.reasonCode,
        missing: [...applicability.missing],
      };
    }

    return {
      status: "not-applicable",
      reasonCode: applicability.reasonCode,
    };
  },
});
