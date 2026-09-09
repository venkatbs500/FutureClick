/**
 * FC-006 Continue revalidation (Sprint 3A)
 *
 * Epistemological Boundary:
 * Fully synchronous final release checks. Reuses Sprint 1 capture + shared
 * applicability + closed-world context/assessment fingerprints.
 *
 * H1: observation entityKey is part of the release fingerprint — a different
 *     valid entity key is a different decision.
 * M1: retained assessment must match the exact closed FC-006 consequence shape.
 *
 * ConsequenceEngine.evaluate is Promise-based; FC-006 does not await it between
 * Continue and arm. Fresh adapt() + fingerprint equality substitutes.
 */

import {
  type ActionEvaluationContext,
  type ConsequenceAssessment,
  validateConsequenceAssessment,
} from "@futureclick/action-schema";
import type { BrowserAdapterEngine, BrowserObservation } from "@futureclick/browser-adapter";
import {
  ATTR_CURRENT_VISIBILITY,
  ATTR_ENTITY_KEY,
  ATTR_FIXTURE_CONTRACT,
  ATTR_OPERATION,
  ATTR_REQUESTED_VISIBILITY,
  captureFc006ButtonObservation,
  isFc006LocationAuthorized,
  resolveFc006ActivationButton,
} from "./capture.js";
import {
  type Fc006ReleaseAssessmentFingerprint,
  type Fc006ReleaseContextFingerprint,
  buildFc006ReleaseAssessmentFingerprint,
  buildFc006ReleaseContextFingerprint,
  fc006AssessmentFingerprintsEqual,
  fc006ContextFingerprintsEqual,
} from "./release-fingerprints.js";
import {
  FC006_FIXTURE_CONTRACT,
  FC006_OPERATION,
  assessFc006RepositoryVisibilityObservation,
} from "./synthetic-repository-interception-adapter.js";

export interface Fc006ContinueRevalidationInput {
  readonly pendingId: string;
  readonly sessionEpoch: number;
  readonly requestSequence: number;
  readonly element: HTMLButtonElement;
  readonly observation: BrowserObservation;
  readonly context: ActionEvaluationContext;
  readonly assessment: ConsequenceAssessment;
  readonly retainedContextFingerprint: Fc006ReleaseContextFingerprint;
  readonly retainedAssessmentFingerprint: Fc006ReleaseAssessmentFingerprint;
  readonly controllerSessionEpoch: number;
  readonly controllerRequestSequence: number;
  readonly releaseInProgress: boolean;
  readonly hasArmedContinuation: boolean;
  readonly adapterEngine: BrowserAdapterEngine;
  readonly location: Location;
  readonly ownerDocument: Document;
}

/**
 * Build immutable fingerprints at preview-ready time. Null → abstention/stale.
 */
export function buildRetainedReleaseFingerprints(
  context: ActionEvaluationContext,
  assessment: ConsequenceAssessment,
  observation: BrowserObservation,
): {
  readonly contextFingerprint: Fc006ReleaseContextFingerprint;
  readonly assessmentFingerprint: Fc006ReleaseAssessmentFingerprint;
} | null {
  const contextFingerprint = buildFc006ReleaseContextFingerprint(context, observation);
  if (!contextFingerprint) return null;
  const lineage = validateConsequenceAssessment(assessment, context);
  if (!lineage.valid) return null;
  const assessmentFingerprint = buildFc006ReleaseAssessmentFingerprint(assessment, context);
  if (!assessmentFingerprint) return null;
  return { contextFingerprint, assessmentFingerprint };
}

/**
 * Full synchronous Continue revalidation. Any failure → no release.
 */
export function revalidatePendingForContinue(input: Fc006ContinueRevalidationInput): boolean {
  if (input.releaseInProgress) return false;
  if (input.hasArmedContinuation) return false;

  if (input.controllerSessionEpoch !== input.sessionEpoch) return false;
  if (input.controllerRequestSequence !== input.requestSequence) return false;

  const element = input.element;
  if (typeof HTMLButtonElement !== "undefined" && !(element instanceof HTMLButtonElement)) {
    return false;
  }
  if (!element.isConnected) return false;
  if (element.ownerDocument !== input.ownerDocument) return false;
  if (element.type !== "button") return false;
  if (element.disabled) return false;

  if (!isFc006LocationAuthorized(input.location)) return false;

  const resolved = resolveFc006ActivationButton(element);
  if (resolved !== element) return false;

  if (element.getAttribute(ATTR_FIXTURE_CONTRACT) !== FC006_FIXTURE_CONTRACT) return false;
  if (element.getAttribute(ATTR_OPERATION) !== FC006_OPERATION) return false;
  const liveEntityKey = element.getAttribute(ATTR_ENTITY_KEY);
  if (!liveEntityKey) return false;
  // H1: exact reviewed entity identity — different valid key is a different decision.
  if (liveEntityKey !== input.retainedContextFingerprint.observationEntityKey) return false;
  if (element.getAttribute(ATTR_CURRENT_VISIBILITY) !== "private") return false;
  if (element.getAttribute(ATTR_REQUESTED_VISIBILITY) !== "public") return false;

  // Retained observation must still agree with retained fingerprint.
  if (
    input.observation.metadata.entityKey !== input.retainedContextFingerprint.observationEntityKey
  ) {
    return false;
  }
  if (input.observation.metadata.fixtureContract !== FC006_FIXTURE_CONTRACT) return false;
  if (input.observation.metadata.operation !== FC006_OPERATION) return false;
  if (input.observation.metadata.currentVisibility !== "private") return false;
  if (input.observation.metadata.requestedVisibility !== "public") return false;

  const freshObservation = captureFc006ButtonObservation(element, input.location);
  if (!freshObservation) return false;
  if (
    freshObservation.metadata.entityKey !== input.retainedContextFingerprint.observationEntityKey
  ) {
    return false;
  }

  const applicability = assessFc006RepositoryVisibilityObservation(freshObservation);
  if (applicability.status !== "matched") return false;

  const adaptOutcome = input.adapterEngine.adapt(freshObservation);
  if (adaptOutcome.status !== "matched") return false;

  const freshContextFp = buildFc006ReleaseContextFingerprint(
    adaptOutcome.context,
    freshObservation,
  );
  if (!freshContextFp) return false;
  if (!fc006ContextFingerprintsEqual(input.retainedContextFingerprint, freshContextFp)) {
    return false;
  }

  const lineage = validateConsequenceAssessment(input.assessment, input.context);
  if (!lineage.valid) return false;

  // Retained context must still match its own fingerprint (internal tamper guard).
  const retainedContextRecheck = buildFc006ReleaseContextFingerprint(
    input.context,
    input.observation,
  );
  if (!retainedContextRecheck) return false;
  if (!fc006ContextFingerprintsEqual(input.retainedContextFingerprint, retainedContextRecheck)) {
    return false;
  }

  const assessmentFp = buildFc006ReleaseAssessmentFingerprint(input.assessment, input.context);
  if (!assessmentFp) return false;
  if (!fc006AssessmentFingerprintsEqual(input.retainedAssessmentFingerprint, assessmentFp)) {
    return false;
  }

  return true;
}
