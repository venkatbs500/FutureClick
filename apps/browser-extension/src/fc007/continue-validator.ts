/**
 * FC-007 Sprint 3A — dedicated synchronous Continue-time validator.
 *
 * Proves the CURRENT DOM/route state is the SAME reviewed VerifiedDecision.
 * NO async, NO engine evaluation, NO arm/execute/release.
 */

import type { ModalPredicate } from "./dialog-inventory.js";
import { adaptGithubVisibilityObservationV2ToCanonicalContext } from "./v2/adapter-v2.js";
import { captureFullContractV2 } from "./capture.js";
import { fingerprintEffectsSemantics, projectEffectsSemantics } from "./effects-semantics.js";
import {
  fingerprintAssessment,
  fingerprintCanonicalContext,
  snapshotCanonicalContext,
  type Fc007VerifiedDecision,
} from "./verified-decision.js";
import {
  FC007_V2_ADAPTER_ID,
  FC007_V2_ADAPTER_VERSION,
  FC007_V2_CONTRACT_ID,
  FC007_V2_CONTRACT_VERSION,
  isGitHubVisibilityObservationV2,
  observationSemanticFingerprintV2,
} from "./v2/github-observation-v2.js";
import { ownedPreviewHostInvariantFailure } from "./preview-host.js";

export type Fc007ContinueValidationResult =
  | {
      readonly status: "VALID_SAME_DECISION";
      readonly reason: "SAME_REVIEWED_DECISION";
    }
  | {
      readonly status: "INVALID_STALE_DECISION";
      readonly reason: string;
    };

export type Fc007LocationLike = Pick<Location, "protocol" | "hostname" | "port" | "pathname">;

/**
 * Fully synchronous Continue validator.
 * Does not adopt replacement modal/form/button identities.
 */
export function validateContinueSameDecision(args: {
  readonly decision: Fc007VerifiedDecision;
  readonly document: Document;
  readonly location: Fc007LocationLike;
  readonly ownedPreviewHost: HTMLDivElement | null;
  /** Current controller binding expectations. */
  readonly expectedControllerEpoch: number;
  readonly expectedInterceptEvalSeq: number;
  readonly expectedDecisionGeneration: number;
  readonly requireTopFrame?: boolean;
  readonly win?: Window;
  readonly matchesModal?: ModalPredicate;
}): Fc007ContinueValidationResult {
  const { decision, document: doc } = args;

  if (!Object.isFrozen(decision)) {
    return { status: "INVALID_STALE_DECISION", reason: "AUTHORITY_NOT_FROZEN" };
  }

  if (decision.controllerEpoch !== args.expectedControllerEpoch) {
    return { status: "INVALID_STALE_DECISION", reason: "CONTROLLER_EPOCH" };
  }
  if (decision.interceptEvalSeq !== args.expectedInterceptEvalSeq) {
    return { status: "INVALID_STALE_DECISION", reason: "INTERCEPT_EVAL_SEQ" };
  }
  if (decision.decisionGeneration !== args.expectedDecisionGeneration) {
    return { status: "INVALID_STALE_DECISION", reason: "DECISION_GENERATION" };
  }

  if (decision.document !== doc) {
    return { status: "INVALID_STALE_DECISION", reason: "DOCUMENT_MISMATCH" };
  }

  if (args.ownedPreviewHost !== decision.ownedHost) {
    return { status: "INVALID_STALE_DECISION", reason: "HOST_IDENTITY" };
  }

  const hostFail = ownedPreviewHostInvariantFailure(decision.ownedHost, decision.modal, doc);
  if (hostFail) {
    return { status: "INVALID_STALE_DECISION", reason: `HOST_INVARIANT_${hostFail}` };
  }

  if (
    decision.contractId !== FC007_V2_CONTRACT_ID ||
    decision.contractVersion !== FC007_V2_CONTRACT_VERSION ||
    decision.adapterId !== FC007_V2_ADAPTER_ID ||
    decision.adapterVersion !== FC007_V2_ADAPTER_VERSION
  ) {
    return { status: "INVALID_STALE_DECISION", reason: "CONTRACT_ADAPTER_VERSION" };
  }

  // Retained fingerprint self-consistency (bounded owned snapshots only).
  if (fingerprintCanonicalContext(decision.canonicalContext) !== decision.contextFingerprint) {
    return { status: "INVALID_STALE_DECISION", reason: "CONTEXT_FINGERPRINT_SELF" };
  }
  if (fingerprintAssessment(decision.assessment) !== decision.assessmentFingerprint) {
    return { status: "INVALID_STALE_DECISION", reason: "ASSESSMENT_FINGERPRINT_SELF" };
  }
  if (fingerprintEffectsSemantics(decision.effectsSemantics) !== decision.effectsFingerprint) {
    return { status: "INVALID_STALE_DECISION", reason: "EFFECTS_FINGERPRINT_SELF" };
  }

  const fresh = captureFullContractV2(doc, args.location, {
    ownedPreviewHost: decision.ownedHost,
    ...(args.requireTopFrame !== undefined ? { requireTopFrame: args.requireTopFrame } : {}),
    ...(args.win !== undefined ? { win: args.win } : {}),
    ...(args.matchesModal !== undefined ? { matchesModal: args.matchesModal } : {}),
  });

  if (fresh.status !== "matched") {
    return { status: "INVALID_STALE_DECISION", reason: "CAPTURE_NOT_MATCHED" };
  }

  const value = fresh.value;
  if (value.stage !== "final-confirmation") {
    return { status: "INVALID_STALE_DECISION", reason: "STAGE_NOT_FINAL" };
  }

  if (value.dialog !== decision.modal) {
    return { status: "INVALID_STALE_DECISION", reason: "MODAL_IDENTITY" };
  }
  if (value.form !== decision.form) {
    return { status: "INVALID_STALE_DECISION", reason: "FORM_IDENTITY" };
  }
  if (value.finalButton !== decision.finalButton) {
    return { status: "INVALID_STALE_DECISION", reason: "BUTTON_IDENTITY" };
  }
  if (!(value.effectsRegion instanceof HTMLDivElement)) {
    return { status: "INVALID_STALE_DECISION", reason: "EFFECTS_REGION_MISSING" };
  }

  const button = decision.finalButton;
  const form = decision.form;
  const modal = decision.modal;

  if (!doc.contains(modal) || !doc.contains(form) || !doc.contains(button)) {
    return { status: "INVALID_STALE_DECISION", reason: "DOM_DISCONNECTED" };
  }
  if (!modal.isConnected || !form.isConnected || !button.isConnected) {
    return { status: "INVALID_STALE_DECISION", reason: "NOT_CONNECTED" };
  }
  if (button.form !== form) {
    return { status: "INVALID_STALE_DECISION", reason: "BUTTON_FORM_RELATION" };
  }
  if (!modal.contains(form) || !modal.contains(button)) {
    return { status: "INVALID_STALE_DECISION", reason: "MODAL_CONTAINMENT" };
  }
  if (!modal.contains(value.effectsRegion) || !value.effectsRegion.isConnected) {
    return { status: "INVALID_STALE_DECISION", reason: "EFFECTS_CONTAINMENT" };
  }

  if (typeof modal.matches === "function") {
    try {
      if (!modal.matches(":modal") && !modal.open) {
        return { status: "INVALID_STALE_DECISION", reason: "MODAL_NOT_OPEN" };
      }
    } catch {
      if (!modal.open) {
        return { status: "INVALID_STALE_DECISION", reason: "MODAL_NOT_OPEN" };
      }
    }
  } else if (!modal.open) {
    return { status: "INVALID_STALE_DECISION", reason: "MODAL_NOT_OPEN" };
  }

  if (button.disabled) {
    return { status: "INVALID_STALE_DECISION", reason: "BUTTON_DISABLED" };
  }
  try {
    if (button.matches(":disabled")) {
      return { status: "INVALID_STALE_DECISION", reason: "BUTTON_MATCHES_DISABLED" };
    }
  } catch {
    // ignore matcher gaps in jsdom
  }
  if (button.getAttribute("aria-disabled") === "true") {
    return { status: "INVALID_STALE_DECISION", reason: "BUTTON_ARIA_DISABLED" };
  }

  const obs = value.observation;
  if (!isGitHubVisibilityObservationV2(obs)) {
    return { status: "INVALID_STALE_DECISION", reason: "OBS_NOT_V2" };
  }
  if (obs.readiness !== "enabled") {
    return { status: "INVALID_STALE_DECISION", reason: "READINESS" };
  }
  if (obs.routeIdentity.origin !== decision.origin) {
    return { status: "INVALID_STALE_DECISION", reason: "ORIGIN" };
  }
  if (obs.routeIdentity.pathnameCanonical !== decision.pathnameCanonical) {
    return { status: "INVALID_STALE_DECISION", reason: "PATHNAME" };
  }
  if (obs.ownerNormalized !== decision.ownerNormalized) {
    return { status: "INVALID_STALE_DECISION", reason: "OWNER" };
  }
  if (obs.repoNormalized !== decision.repoNormalized) {
    return { status: "INVALID_STALE_DECISION", reason: "REPO" };
  }
  if (obs.supportedLocale !== decision.supportedLocale) {
    return { status: "INVALID_STALE_DECISION", reason: "LOCALE" };
  }
  if (obs.currentVisibility !== "private" || obs.requestedVisibility !== "public") {
    return { status: "INVALID_STALE_DECISION", reason: "VISIBILITY_TRANSITION" };
  }
  if (obs.contractId !== decision.contractId || obs.contractVersion !== decision.contractVersion) {
    return { status: "INVALID_STALE_DECISION", reason: "OBS_CONTRACT" };
  }
  if (obs.adapter.id !== decision.adapterId || obs.adapter.version !== decision.adapterVersion) {
    return { status: "INVALID_STALE_DECISION", reason: "OBS_ADAPTER" };
  }

  const freshObsFp = observationSemanticFingerprintV2(obs);
  if (freshObsFp !== decision.observationFingerprint) {
    return { status: "INVALID_STALE_DECISION", reason: "OBSERVATION_FINGERPRINT" };
  }

  const freshEffects = projectEffectsSemantics(value.effectsRegion);
  if (freshEffects.status !== "ok") {
    return { status: "INVALID_STALE_DECISION", reason: `EFFECTS_${freshEffects.reason}` };
  }
  if (freshEffects.fingerprint !== decision.effectsFingerprint) {
    return { status: "INVALID_STALE_DECISION", reason: "EFFECTS_FINGERPRINT" };
  }

  const adapted = adaptGithubVisibilityObservationV2ToCanonicalContext(obs);
  if (adapted.status !== "ok") {
    return { status: "INVALID_STALE_DECISION", reason: `ADAPT_${adapted.reason}` };
  }
  const freshCtxRes = snapshotCanonicalContext(adapted.context);
  if (freshCtxRes.status !== "ok") {
    return { status: "INVALID_STALE_DECISION", reason: `FRESH_CONTEXT_${freshCtxRes.reason}` };
  }
  const freshCtxFp = fingerprintCanonicalContext(freshCtxRes.value);
  if (freshCtxFp !== decision.contextFingerprint) {
    return { status: "INVALID_STALE_DECISION", reason: "CANONICAL_FINGERPRINT" };
  }

  // Assessment is NOT recomputed — retained snapshot must still bind to same semantics.
  if (
    decision.lineageEntityLabel !== decision.canonicalContext.entityLabel ||
    decision.lineageEntityId !== decision.canonicalContext.entityId ||
    decision.lineageActionId !== decision.assessment.actionId ||
    decision.lineageEvaluationContextId !== decision.assessment.evaluationContextId ||
    decision.canonicalContext.requestedVisibility !== "public" ||
    decision.canonicalContext.visibilityFactValue !== "private" ||
    freshCtxRes.value.entityLabel !== decision.lineageEntityLabel ||
    freshCtxRes.value.requestedVisibility !== decision.canonicalContext.requestedVisibility ||
    freshCtxRes.value.visibilityFactValue !== decision.canonicalContext.visibilityFactValue
  ) {
    return { status: "INVALID_STALE_DECISION", reason: "ASSESSMENT_BINDING" };
  }

  return { status: "VALID_SAME_DECISION", reason: "SAME_REVIEWED_DECISION" };
}
