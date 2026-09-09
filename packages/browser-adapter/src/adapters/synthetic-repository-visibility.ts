/**
 * Synthetic Repository Visibility Browser Action Adapter (Sprint FC-005)
 *
 * Epistemological Boundary:
 * Pure synchronous mapping from an explicitly declared synthetic fixture observation
 * to a canonical domain draft.
 *
 * IMPORTANT:
 * This adapter handles ONLY explicit synthetic fixture declarations for FC-005.
 * It is NOT proof or heuristic that generic HTML elements reveal repository semantics.
 */

import type {
  AdapterDecision,
  AdapterId,
  AdapterVersion,
  BrowserActionAdapter,
  BrowserContextDraft,
  BrowserObservation,
} from "../types.js";

export const SYNTHETIC_REPO_VISIBILITY_ADAPTER_ID =
  "browser.synthetic.repository-visibility" as AdapterId;
export const SYNTHETIC_REPO_VISIBILITY_ADAPTER_VERSION = "1.0" as AdapterVersion;

export const FC005_ORIGIN = "http://127.0.0.1:4173";
export const FC005_ROUTE_ID = "synthetic.repository-visibility";
export const FC005_INTERACTION_KIND = "activate";
export const FC005_ELEMENT_KIND = "button";
export const FC005_ELEMENT_ROLE = "button";
export const FC005_ELEMENT_BUTTON_TYPE = "button";
export const FC005_FIXTURE_CONTRACT = "fc005.repository-visibility.v1";
export const FC005_OPERATION = "repository.visibility.change";

export const syntheticRepositoryVisibilityAdapter: BrowserActionAdapter = Object.freeze({
  id: SYNTHETIC_REPO_VISIBILITY_ADAPTER_ID,
  version: SYNTHETIC_REPO_VISIBILITY_ADAPTER_VERSION,
  description:
    "Maps synthetic repository visibility DOM observation to a canonical version control draft.",

  assess(observation: BrowserObservation): AdapterDecision {
    // 1. Authoritative origin check (Finding H3)
    if (observation.page.origin !== FC005_ORIGIN) {
      return { status: "not-applicable", reasonCode: "UNAUTHORIZED_ORIGIN" };
    }

    // 2. Verify route
    if (observation.page.routeId !== FC005_ROUTE_ID) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_ROUTE" };
    }

    // 3. Verify interaction
    if (observation.interaction.kind !== FC005_INTERACTION_KIND) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_INTERACTION" };
    }

    // 4. Verify element descriptor
    if (observation.element.kind !== FC005_ELEMENT_KIND) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_ELEMENT_KIND" };
    }
    if (observation.element.role !== FC005_ELEMENT_ROLE) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_ELEMENT_ROLE" };
    }
    if (observation.element.buttonType !== FC005_ELEMENT_BUTTON_TYPE) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_BUTTON_TYPE" };
    }

    // 5. Verify fixture contract
    if (observation.metadata.fixtureContract !== FC005_FIXTURE_CONTRACT) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_FIXTURE_CONTRACT" };
    }

    // 6. Verify operation
    if (observation.metadata.operation !== FC005_OPERATION) {
      return { status: "not-applicable", reasonCode: "UNMATCHED_OPERATION" };
    }

    // 7. Distinguish missing semantic metadata from invalid metadata
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

    // 8. Strict visibility semantics for FC-005: private -> public
    if (currentVis !== "private" || requestedVis !== "public") {
      return {
        status: "not-applicable",
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
  },
});
