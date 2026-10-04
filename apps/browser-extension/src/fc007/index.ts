/**
 * FC-007 Sprint 3C — production observation + Continue → one-shot release bootstrap.
 *
 * Installs the release Window capture listener at document_start (module eval)
 * before page scripts can register later Window capture handlers.
 * Production uses V2 recognition exclusively.
 *
 * No production global publishes the controller, release component, decision, or
 * any mutable authority handle onto globalThis / window / self / document.
 */

// Capture isolated native HTMLButtonElement.prototype.click at earliest module load.
import "./native-click-executor.js";
import { authorizeFc007SettingsLocation } from "./location.js";
import { Fc007PassiveController } from "./passive-controller.js";
import { Fc007IsolatedReleaseComponent } from "./release-attempt.js";

export {
  FC007_CONTRACT_ID,
  FC007_ADAPTER_ID,
  FC007_ADAPTER_VERSION,
  FC007_EVIDENCE_BASIS,
} from "./github-observation.js";
export {
  FC007_V2_CONTRACT_ID,
  FC007_V2_CONTRACT_VERSION,
  FC007_V2_ADAPTER_ID,
  FC007_V2_ADAPTER_VERSION,
  FC007_V2_EVIDENCE_BASIS,
} from "./v2/github-observation-v2.js";
export { adaptGithubVisibilityObservationToCanonicalContext } from "./github-repository-visibility-adapter.js";
export { adaptGithubVisibilityObservationV2ToCanonicalContext } from "./v2/adapter-v2.js";
export { Fc007PassiveController } from "./passive-controller.js";
export type {
  Fc007TrustedDiagnostic,
  Fc007PassiveState,
  Fc007Observation,
} from "./passive-controller.js";
export { authorizeFc007SettingsLocation } from "./location.js";
export { normalizedOwnText } from "./own-text.js";
export { recognizeVisibilitySection } from "./visibility-section.js";
export { recognizeVisibilitySectionV2 } from "./v2/visibility-section-v2.js";
export { inventorySupportedVisibilityDialog, defaultMatchesModal } from "./dialog-inventory.js";
export {
  inventorySoleActualModal,
  recognizeStageB,
  recognizeStageC,
  recognizeStageD,
} from "./v2/dialog-inventory-v2.js";
export { recognizeFormContract, isButtonEffectivelyEnabled } from "./form-contract.js";
export { recognizeFormContractV2 } from "./v2/form-contract-v2.js";
export { recognizeFc007ContractV2 } from "./v2/contract-v2.js";
export { captureFullContractV2 } from "./capture.js";
export {
  blockSupportedActivationEvent,
  eventTargetsBlockButton,
  eventTargetsRetainedFinalButton,
  passesTrustedActivationGates,
} from "./interception.js";
export {
  Fc007PreviewUi,
  buildVerifiedPreviewModel,
} from "./preview.js";
export type { Fc007PreviewMode, Fc007VerifiedPreviewModel } from "./preview.js";
export {
  createVerifiedDecision,
  snapshotCanonicalContext,
  fingerprintCanonicalContext,
  snapshotAssessment,
  fingerprintAssessment,
  isDecisionAuthorityFrozen,
} from "./verified-decision.js";
export type { Fc007VerifiedDecision, Fc007DecisionLifecycleStatus } from "./verified-decision.js";
export { validateContinueSameDecision } from "./continue-validator.js";
export type { Fc007ContinueValidationResult } from "./continue-validator.js";
export {
  projectEffectsSemantics,
  fingerprintEffectsSemantics,
} from "./effects-semantics.js";
export type { Fc007EffectsSnapshot } from "./effects-semantics.js";

let controller: Fc007PassiveController | null = null;
/** One production release component for the document — Window capture at document_start. */
let productionRelease: Fc007IsolatedReleaseComponent | null = null;

function ensureProductionReleaseInstalled(): Fc007IsolatedReleaseComponent {
  if (!productionRelease) {
    productionRelease = new Fc007IsolatedReleaseComponent();
  }
  if (typeof window !== "undefined" && !productionRelease.isListenerInstalled()) {
    productionRelease.install(window);
  }
  return productionRelease;
}

// Install early — before page scripts (document_start content script).
if (typeof window !== "undefined") {
  ensureProductionReleaseInstalled();
}

/** Module-local only — never assigned to globalThis. Unit tests import from source. */
export function getFc007PassiveController(): Fc007PassiveController | null {
  return controller;
}

/**
 * Production bootstrap — V2 only, no page-controlled diagnostics.
 * Release authority is private to the extension module; not exported as a page API.
 */
export function bootstrapFc007Observation(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  const auth = authorizeFc007SettingsLocation(window.location);
  if (auth.status !== "authorized") {
    return false;
  }
  if (controller) {
    controller.stop();
    controller = null;
  }
  const release = ensureProductionReleaseInstalled();
  controller = new Fc007PassiveController({
    recognitionVersion: "v2",
    releaseComponent: release,
  });
  controller.start();
  return true;
}

if (typeof window !== "undefined") {
  bootstrapFc007Observation();
}
