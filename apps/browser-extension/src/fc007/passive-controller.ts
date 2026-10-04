/**
 * FC-007 Sprint 3C — recognition + Continue validation + one-shot release integration.
 *
 * Production: V2 recognition; capture-phase block of exact retained final control;
 * decision-bound Continue with sync validation; atomic releaseOnce on the exact
 * retained final button. No FC-006 imports. No selector recovery / submit / API.
 */

import type { ActionEvaluationContext, ConsequenceAssessment } from "@futureclick/action-schema";
import {
  ConsequenceEngine,
  createDeterministicRuleEvaluator,
} from "@futureclick/consequence-engine";
import { captureFullContract, captureFullContractV2 } from "./capture.js";
import { validateContinueSameDecision } from "./continue-validator.js";
import type { ModalPredicate } from "./dialog-inventory.js";
import { projectEffectsSemantics } from "./effects-semantics.js";
import {
  FC007_CONTRACT_ID,
  type GitHubVisibilityObservation,
  observationSemanticFingerprint,
} from "./github-observation.js";
import { adaptGithubVisibilityObservationToCanonicalContext } from "./github-repository-visibility-adapter.js";
import {
  type Fc007TrustClickPredicate,
  blockSupportedActivationEvent,
  eventTargetsBlockButton,
  passesTrustedActivationGates,
} from "./interception.js";
import { authorizeFc007SettingsLocation } from "./location.js";
import { processMutationDelivery } from "./mutation-delivery.js";
import { normalizedOwnText } from "./own-text.js";
import { type Fc007PreviewMode, Fc007PreviewUi, buildVerifiedPreviewModel } from "./preview.js";
import { Fc007IsolatedReleaseComponent, type Fc007ReleaseOutcome } from "./release-attempt.js";
import { adaptGithubVisibilityObservationV2ToCanonicalContext } from "./v2/adapter-v2.js";
import { findExactEffectsRegion } from "./v2/effects-region.js";
import {
  FC007_V2_CONTRACT_ID,
  type GitHubVisibilityObservationV2,
  isGitHubVisibilityObservationV2,
  observationSemanticFingerprintV2,
} from "./v2/github-observation-v2.js";
import {
  type Fc007DecisionLifecycleStatus,
  type Fc007VerifiedDecision,
  createVerifiedDecision,
} from "./verified-decision.js";

/** Fail-closed exact block target — never grants VERIFIED / execution authority. */
interface Fc007BlockGuard {
  readonly button: HTMLButtonElement;
  readonly form: HTMLFormElement | null;
  readonly modal: HTMLDialogElement | null;
}

export type Fc007Observation = GitHubVisibilityObservation | GitHubVisibilityObservationV2;

export type Fc007PassiveState =
  | { readonly kind: "idle" }
  | { readonly kind: "awaiting-dom" }
  | { readonly kind: "route-armed" }
  | {
      readonly kind: "contract-recognized";
      readonly observation: Fc007Observation;
      readonly context: ActionEvaluationContext;
      readonly assessment: ConsequenceAssessment | null;
    }
  | {
      readonly kind: "stage-recognized";
      readonly observation: GitHubVisibilityObservationV2;
    }
  | {
      readonly kind: "evaluated";
      readonly observation: Fc007Observation;
      readonly context: ActionEvaluationContext;
      readonly assessment: ConsequenceAssessment;
    }
  | { readonly kind: "abstained"; readonly reason: string }
  | { readonly kind: "unknown"; readonly reason: string };

/** Trusted test/smoke-only diagnostic (never page-controlled). */
export interface Fc007TrustedDiagnostic {
  readonly kind: string;
  readonly reason?: string;
  readonly contractId?: string;
  readonly stage?: string;
  readonly ownerNormalized?: string;
  readonly repoNormalized?: string;
  readonly currentVisibility?: string;
  readonly requestedVisibility?: string;
  readonly readiness?: string;
  readonly previewMode?: Fc007PreviewMode;
  /** Sprint 3A/3C diagnostics — never grant page authority. */
  readonly continueVisible?: boolean;
  readonly trustedContinueAttempts?: number;
  readonly acceptedContinueAttempts?: number;
  readonly continueValidationPass?: number;
  readonly continueValidationFail?: number;
  readonly armCount?: number;
  readonly executorCount?: number;
  readonly authorizedReleaseCount?: number;
  readonly releaseCalls?: number;
  readonly consumptions?: number;
  readonly retries?: number;
  readonly fallbacks?: number;
  readonly terminalOutcome?: string | null;
  readonly continueValidationReason?: string;
}

export type Fc007LocationLike = Pick<Location, "protocol" | "hostname" | "port" | "pathname">;

export interface Fc007PassiveControllerOptions {
  readonly document?: Document;
  readonly location?: Fc007LocationLike;
  /** Re-read on every recognition (tests may mutate). */
  readonly locationProvider?: () => Fc007LocationLike;
  readonly window?: Window;
  readonly requireTopFrame?: boolean;
  readonly matchesModal?: ModalPredicate;
  readonly consequenceEngine?: ConsequenceEngine;
  readonly evaluateOnRecognize?: boolean;
  /** Production default "v2". Tests on V1 fixtures pass "v1". */
  readonly recognitionVersion?: "v1" | "v2";
  /**
   * Trusted extension/smoke-only. Production bootstrap does NOT pass this.
   * Must not be obtained from page DOM/attributes/storage/postMessage.
   */
  readonly onDiagnostic?: (diagnostic: Fc007TrustedDiagnostic) => void;
  /**
   * Test seam: replace engine.evaluate with a controllable promise.
   */
  readonly evaluateFn?: (
    context: ActionEvaluationContext,
  ) => Promise<{ ok: true; value: ConsequenceAssessment } | { ok: false; error: unknown }>;
  /**
   * Test/smoke seam for trusted-click gating. Production bootstrap never passes this.
   * Must not be page-controllable.
   */
  readonly trustClickForTest?: Fc007TrustClickPredicate;
  /**
   * Production/shared release component (Window capture installed at document_start).
   * When omitted, the controller creates and owns one for the test lifecycle.
   */
  readonly releaseComponent?: Fc007IsolatedReleaseComponent;
}

export class Fc007PassiveController {
  private state: Fc007PassiveState = { kind: "idle" };
  private observer: MutationObserver | null = null;
  private domContentLoadedListener: (() => void) | null = null;
  private controllerEpoch = 0;
  private requestSequence = 0;
  private started = false;

  private readonly doc: Document;
  private readonly loc: Fc007LocationLike;
  private readonly locationProvider: (() => Fc007LocationLike) | undefined;
  private readonly win: Window | undefined;
  private readonly requireTopFrame: boolean;
  private readonly matchesModal: ModalPredicate | undefined;
  private readonly consequenceEngine: ConsequenceEngine;
  private readonly evaluateOnRecognize: boolean;
  private readonly recognitionVersion: "v1" | "v2";
  private readonly onDiagnostic: ((diagnostic: Fc007TrustedDiagnostic) => void) | undefined;
  private readonly evaluateFn:
    | ((
        context: ActionEvaluationContext,
      ) => Promise<{ ok: true; value: ConsequenceAssessment } | { ok: false; error: unknown }>)
    | undefined;
  private readonly trustClickForTest: Fc007TrustClickPredicate | undefined;
  private readonly release: Fc007IsolatedReleaseComponent;
  /** When true, stop() may uninstall the release listener (test-owned lifecycle). */
  private readonly ownsReleaseLifecycle: boolean;
  /** Smoke/test-only: optional one-shot delay before engine evaluation. */
  private testEvalDelayGate: Promise<void> | null = null;
  private testEvalDelayRelease: (() => void) | null = null;
  private lastObservation: Fc007Observation | null = null;
  private lastEvaluation: ConsequenceAssessment | null = null;
  /** Prevents recursive getter → freshness → diagnostic → getter loops. */
  private freshnessGuardDepth = 0;

  /**
   * Fail-closed exact block guard (button/form/modal object identity).
   * Survives recognition failure while the original action surface remains.
   * Does NOT grant VERIFIED or execution authority.
   */
  private blockGuard: Fc007BlockGuard | null = null;
  private windowClickListener: ((event: Event) => void) | null = null;
  private windowSubmitListener: ((event: Event) => void) | null = null;
  private interceptDepth = 0;
  /** Non-authority counters: matching activations / submits blocked as unauthorized. */
  private blockedUnauthorizedActivations = 0;
  private blockedUnauthorizedSubmits = 0;
  private allowedReleaseSubmits = 0;
  /**
   * Private one-submit allowance, alive only inside releaseOnce(). The first guarded submit
   * fired after the authorized generated click has finished propagating consumes it; every
   * other guarded submit in the same release is blocked.
   */
  private releaseSubmitAllowance: "none" | "available" | "consumed" = "none";
  /**
   * The click the release component just consumed, observed at this controller's capture
   * listener. Read only for its dispatch phase (default action runs at eventPhase NONE);
   * never an authority on its own.
   */
  private releaseAuthorizedClick: Event | null = null;
  /** The decision's final button for the duration of releaseOnce() only. */
  private releaseGuardedButton: HTMLButtonElement | null = null;
  private recoveryRecognitionQueued = false;
  private recoveryRecognitionRuns = 0;
  private interceptEvalSeq = 0;
  /** True while an intercept-time engine evaluation is in flight. */
  private interceptEvalPending = false;
  /** Narrow mount-only transaction: ignore self-insert host MutationRecords. */
  private pendingMountTransaction = false;
  /** Discards stale async evaluation / preview results (UI-only, not a release token). */
  private previewGeneration = 0;
  private routeWatchCleanup: (() => void) | null = null;
  private previewRouteSnapshot: string | null = null;
  /** Retained UI authority digest while VERIFIED (effects/button/form surface text). */
  private previewAuthorityDigest: string | null = null;
  private readonly previewUi: Fc007PreviewUi;
  private interceptionInstalled = false;

  /** Sprint 3A — one active VerifiedDecision max; eligibility is controller-private. */
  private activeDecisionBinding: {
    readonly decision: Fc007VerifiedDecision;
    status: Fc007DecisionLifecycleStatus;
  } | null = null;
  private continueInProgress = false;
  private trustedContinueAttempts = 0;
  private acceptedContinueAttempts = 0;
  private continueValidationPass = 0;
  private continueValidationFail = 0;
  /** Sprint 3C — synced from release component after Continue→release. */
  private armCount = 0;
  private executorCount = 0;
  private authorizedReleaseCount = 0;
  private releaseCalls = 0;
  private consumptions = 0;
  private retries = 0;
  private fallbacks = 0;
  private terminalOutcome: Fc007ReleaseOutcome | null = null;
  private pageHideListener: ((event: Event) => void) | null = null;
  /** Smoke/test-only: when true, VERIFIED freshness observer delivery is suppressed. */
  private freshnessObserverPausedForTest = false;
  /**
   * Controller-local: true while synchronous releaseOnce() has not returned.
   * Grants zero release authority; while set (with the release dispatch guard active) the
   * controller defers matching activations to the release component. Defers UI/host
   * destruction on stop/pagehide.
   */
  private releaseDispatchInProgress = false;
  /** Deferred physical preview destruction after stop/pagehide during active release. */
  private deferredStopUiCleanup = false;
  /** Counts actual release.install() invocations (not mere isListenerInstalled). */
  private releaseListenerInstallCount = 0;
  /** Counts terminal showStopped / post-release UI render attempts. */
  private terminalUiRenderCount = 0;

  constructor(options?: Fc007PassiveControllerOptions) {
    this.doc = options?.document ?? document;
    this.loc = options?.location ?? location;
    this.locationProvider = options?.locationProvider;
    this.win = options?.window;
    this.requireTopFrame = options?.requireTopFrame !== false;
    this.matchesModal = options?.matchesModal;
    this.recognitionVersion = options?.recognitionVersion ?? "v2";
    this.evaluateOnRecognize = options?.evaluateOnRecognize !== false;
    this.onDiagnostic = options?.onDiagnostic;
    this.evaluateFn = options?.evaluateFn;
    this.trustClickForTest = options?.trustClickForTest;
    if (options?.releaseComponent) {
      this.release = options.releaseComponent;
      this.ownsReleaseLifecycle = false;
    } else {
      this.release = new Fc007IsolatedReleaseComponent();
      this.ownsReleaseLifecycle = true;
    }
    this.previewUi = new Fc007PreviewUi(this.doc);
    if (options?.consequenceEngine) {
      this.consequenceEngine = options.consequenceEngine;
    } else {
      this.consequenceEngine = new ConsequenceEngine();
      this.consequenceEngine.registerEvaluator(createDeterministicRuleEvaluator());
    }
  }

  getState(): Fc007PassiveState {
    this.ensureCurrentRecognitionFresh();
    return this.state;
  }

  getLastObservation(): Fc007Observation | null {
    this.ensureCurrentRecognitionFresh();
    return this.lastObservation;
  }

  getLastEvaluation(): ConsequenceAssessment | null {
    this.ensureCurrentRecognitionFresh();
    return this.lastEvaluation;
  }

  /** Test/smoke: exact block-guard Stage-D final button identity (block-only). */
  getRetainedFinalButton(): HTMLButtonElement | null {
    return this.blockGuard?.button ?? null;
  }

  /** Test/smoke: preview host exact identity. */
  getPreviewHostForTest(): HTMLDivElement | null {
    return this.previewUi.getHost();
  }

  /** Test/smoke: Cancel focus proof via closed shadow. */
  isPreviewCancelFocusedForTest(): boolean {
    const cancel = this.previewUi.getCancelButtonForTest();
    const active = this.previewUi.getShadowActiveElementForTest();
    return cancel != null && active === cancel;
  }

  /** Test/smoke: Cancel center for native coordinate click. */
  getPreviewCancelCenterForTest(): {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null {
    return this.previewUi.getCancelCenterForTest();
  }

  /** Test/smoke: Continue center for native coordinate click. */
  getPreviewContinueCenterForTest(): {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null {
    return this.previewUi.getContinueCenterForTest();
  }

  /** Test/smoke: isolated-world Cancel hit-test at center. */
  hitTestPreviewCancelForTest(): boolean {
    return this.previewUi.hitTestCancelCenterForTest();
  }

  /** Test/smoke: exact Continue control identity. */
  getContinueButtonForTest(): HTMLButtonElement | null {
    return this.previewUi.getContinueButtonForTest();
  }

  isContinueVisibleForTest(): boolean {
    return (
      this.previewUi.isContinueVisibleForTest() && this.activeDecisionBinding?.status === "eligible"
    );
  }

  /** Frozen decision authority for inspection — mutation of returned object must not succeed. */
  getActiveDecisionForTest(): Fc007VerifiedDecision | null {
    return this.activeDecisionBinding?.decision ?? null;
  }

  getDecisionLifecycleStatusForTest(): Fc007DecisionLifecycleStatus | null {
    return this.activeDecisionBinding?.status ?? null;
  }

  getSprint3aDiagnosticsForTest(): {
    readonly continueVisible: boolean;
    readonly trustedContinueAttempts: number;
    readonly acceptedContinueAttempts: number;
    readonly continueValidationPass: number;
    readonly continueValidationFail: number;
    readonly armCount: number;
    readonly executorCount: number;
    readonly authorizedReleaseCount: number;
    readonly releaseCalls: number;
    readonly consumptions: number;
    readonly retries: number;
    readonly fallbacks: number;
    readonly terminalOutcome: string | null;
    readonly decisionEligibility: string | null;
    readonly decisionGeneration: number | null;
    readonly listenerInstalled: boolean;
  } {
    return {
      continueVisible: this.isContinueVisibleForTest(),
      trustedContinueAttempts: this.trustedContinueAttempts,
      acceptedContinueAttempts: this.acceptedContinueAttempts,
      continueValidationPass: this.continueValidationPass,
      continueValidationFail: this.continueValidationFail,
      armCount: this.armCount,
      executorCount: this.executorCount,
      authorizedReleaseCount: this.authorizedReleaseCount,
      releaseCalls: this.releaseCalls,
      consumptions: this.consumptions,
      retries: this.retries,
      fallbacks: this.fallbacks,
      terminalOutcome: this.terminalOutcome,
      decisionEligibility: this.activeDecisionBinding?.status ?? null,
      decisionGeneration: this.activeDecisionBinding?.decision.decisionGeneration ?? null,
      listenerInstalled: this.release.isListenerInstalled(),
    };
  }

  /** Sprint 3C diagnostics alias — same non-authority counters. */
  getSprint3cDiagnosticsForTest(): ReturnType<
    Fc007PassiveController["getSprint3aDiagnosticsForTest"]
  > {
    return this.getSprint3aDiagnosticsForTest();
  }

  /** Test/smoke: unauthorized matching activations / submits blocked (non-authority). */
  getActivationGuardDiagnosticsForTest(): {
    readonly blockedUnauthorizedActivations: number;
    readonly blockedUnauthorizedSubmits: number;
    readonly allowedReleaseSubmits: number;
    readonly releaseSubmitAllowance: "none" | "available" | "consumed";
    readonly recoveryRecognitionRuns: number;
  } {
    return {
      blockedUnauthorizedActivations: this.blockedUnauthorizedActivations,
      blockedUnauthorizedSubmits: this.blockedUnauthorizedSubmits,
      allowedReleaseSubmits: this.allowedReleaseSubmits,
      releaseSubmitAllowance: this.releaseSubmitAllowance,
      recoveryRecognitionRuns: this.recoveryRecognitionRuns,
    };
  }

  /** Test/smoke: release listener installed exactly once (shared component). */
  isReleaseListenerInstalledForTest(): boolean {
    return this.release.isListenerInstalled();
  }

  getReleaseComponentForTest(): Fc007IsolatedReleaseComponent {
    return this.release;
  }

  /** Test: controller-local releaseOnce in-progress flag (zero authority). */
  isReleaseDispatchInProgressForTest(): boolean {
    return this.releaseDispatchInProgress === true;
  }

  /** Test: deferred UI cleanup pending after stop/pagehide during release. */
  isDeferredStopUiCleanupPendingForTest(): boolean {
    return this.deferredStopUiCleanup === true;
  }

  /** Test: actual release.install() invocations (not boolean installed). */
  getReleaseListenerInstallCountForTest(): number {
    return this.releaseListenerInstallCount;
  }

  /** Test: terminal showStopped render attempts (UI resurrection detector). */
  getTerminalUiRenderCountForTest(): number {
    return this.terminalUiRenderCount;
  }

  /** Test: controller started flag. */
  isStartedForTest(): boolean {
    return this.started === true;
  }

  /**
   * Trusted test seam: invoke Continue handler as if a trusted click arrived on the
   * exact retained Continue control. Does not prove literal human intent.
   */
  invokeTrustedContinueForTest(): void {
    const btn = this.previewUi.getContinueButtonForTest();
    if (!btn) return;
    const event = {
      type: "click",
      isTrusted: true,
      currentTarget: btn,
      target: btn,
    } as unknown as MouseEvent;
    this.handlePreviewContinue(event);
  }

  /** Untrusted programmatic Continue — must not accept. */
  invokeUntrustedContinueClickForTest(): void {
    const btn = this.previewUi.getContinueButtonForTest();
    if (!btn) return;
    btn.click();
  }

  /**
   * Smoke/test-only: pause VERIFIED freshness observer delivery.
   * Production bootstrap never calls this. Not page-controllable.
   */
  pauseFreshnessObserverForTest(): void {
    this.freshnessObserverPausedForTest = true;
  }

  resumeFreshnessObserverForTest(): void {
    this.freshnessObserverPausedForTest = false;
  }

  /**
   * Smoke/test-only: invoke production Continue validator against current DOM
   * without requiring a trusted click. Does not accept/retire the decision.
   */
  validateContinueSameDecisionForTest(): ReturnType<typeof validateContinueSameDecision> | null {
    const binding = this.activeDecisionBinding;
    if (!binding) return null;
    return validateContinueSameDecision({
      decision: binding.decision,
      document: this.doc,
      location: this.resolveLocation(),
      ownedPreviewHost: this.previewUi.getHost(),
      expectedControllerEpoch: this.controllerEpoch,
      expectedInterceptEvalSeq: this.interceptEvalSeq,
      expectedDecisionGeneration: binding.decision.decisionGeneration,
      requireTopFrame: this.requireTopFrame,
      ...(this.win ? { win: this.win } : {}),
      ...(this.matchesModal ? { matchesModal: this.matchesModal } : {}),
    });
  }

  /**
   * Smoke/test-only: bounded fresh effects fingerprint from the exact V2
   * Stage-D effects region currently recognized. Not page-controllable.
   */
  fingerprintCurrentEffectsForTest(): string | null {
    const host = this.previewUi.getHost();
    const full = captureFullContractV2(this.doc, this.resolveLocation(), this.captureOptions(host));
    if (full.status !== "matched") return null;
    const region = full.value.effectsRegion;
    if (!(region instanceof HTMLDivElement)) return null;
    const projected = projectEffectsSemantics(region);
    return projected.status === "ok" ? projected.fingerprint : null;
  }

  /** Test/smoke: preview visibility mode. */
  getPreviewMode(): Fc007PreviewMode {
    return this.previewUi.getMode();
  }

  /**
   * Smoke/test-only: arm a one-shot delay before the next engine evaluation(s).
   * Not page-controllable; isolated-world / unit-test only.
   */
  armEvalDelayForTest(): void {
    this.testEvalDelayGate = new Promise<void>((resolve) => {
      this.testEvalDelayRelease = resolve;
    });
  }

  /** Smoke/test-only: release an armed evaluation delay. */
  releaseEvalDelayForTest(): void {
    const release = this.testEvalDelayRelease;
    this.testEvalDelayRelease = null;
    this.testEvalDelayGate = null;
    if (release) release();
  }

  private async runEngineEvaluation(
    context: ActionEvaluationContext,
  ): Promise<{ ok: true; value: ConsequenceAssessment } | { ok: false; error: unknown }> {
    const gate = this.testEvalDelayGate;
    if (gate) await gate;
    if (this.evaluateFn) return this.evaluateFn(context);
    return this.consequenceEngine.evaluate(context);
  }

  isPreviewVisible(): boolean {
    return this.previewUi.isVisible();
  }

  /** Test seam: invoke Cancel path without requiring a trusted DOM click. */
  cancelPreviewForTest(): void {
    this.handlePreviewCancel();
  }

  /** Test seam: current epoch/request counters. */
  getInvalidationCounters(): { readonly epoch: number; readonly requestSequence: number } {
    return { epoch: this.controllerEpoch, requestSequence: this.requestSequence };
  }

  /**
   * Test seam: feed MutationRecords through the real delivery path.
   */
  handleMutationRecordsForTest(records: MutationRecord[]): void {
    this.onMutations(records);
  }

  /** Test seam: feed a click through the production capture handler. */
  handleCaptureClickForTest(event: Event): void {
    this.handleCaptureClick(event);
  }

  private resolveLocation(): Fc007LocationLike {
    if (this.locationProvider) return this.locationProvider();
    if (this.win?.location) {
      return this.win.location;
    }
    return this.loc;
  }

  private captureOptions(ownedPreviewHost?: HTMLDivElement | null): {
    readonly requireTopFrame: boolean;
    readonly win?: Window;
    readonly matchesModal?: ModalPredicate;
    readonly ownedPreviewHost?: HTMLDivElement;
  } {
    return {
      requireTopFrame: this.requireTopFrame,
      ...(this.win ? { win: this.win } : {}),
      ...(this.matchesModal ? { matchesModal: this.matchesModal } : {}),
      ...(ownedPreviewHost ? { ownedPreviewHost } : {}),
    };
  }

  private activeOwnedPreviewHost(): HTMLDivElement | null {
    const host = this.previewUi.getHost();
    const modal = this.blockGuard?.modal;
    if (!host || !modal) return null;
    if (this.previewUi.getMode() !== "verified" && this.previewUi.getMode() !== "pending") {
      return null;
    }
    return host;
  }

  private observationFingerprint(obs: Fc007Observation): string {
    if (isGitHubVisibilityObservationV2(obs)) {
      return observationSemanticFingerprintV2(obs);
    }
    return observationSemanticFingerprint(obs);
  }

  private isActionableObservation(obs: Fc007Observation): boolean {
    if (this.recognitionVersion === "v1") return true;
    return isGitHubVisibilityObservationV2(obs) && obs.stage === "final-confirmation";
  }

  private hasCurrentRecognitionAuthority(): boolean {
    return (
      this.state.kind === "contract-recognized" ||
      this.state.kind === "stage-recognized" ||
      this.state.kind === "evaluated" ||
      this.lastObservation != null ||
      this.lastEvaluation != null
    );
  }

  private freshnessCaptureMatched():
    | { readonly ok: true; readonly observation: Fc007Observation }
    | { readonly ok: false; readonly reason: string } {
    const opts = this.captureOptions(this.activeOwnedPreviewHost());
    const loc = this.resolveLocation();
    if (this.recognitionVersion === "v1") {
      const full = captureFullContract(this.doc, loc, opts);
      if (full.status !== "matched") {
        return { ok: false, reason: full.reason || "FRESHNESS_CAPTURE_FAILED" };
      }
      return { ok: true, observation: full.value.observation };
    }
    const full = captureFullContractV2(this.doc, loc, opts);
    if (full.status !== "matched") {
      return { ok: false, reason: full.reason || "FRESHNESS_CAPTURE_FAILED" };
    }
    return { ok: true, observation: full.value.observation };
  }

  /**
   * Synchronous CURRENT-state freshness guard.
   */
  private ensureCurrentRecognitionFresh(): void {
    if (this.freshnessGuardDepth > 0) return;
    if (!this.hasCurrentRecognitionAuthority()) return;

    this.freshnessGuardDepth += 1;
    try {
      try {
        const fresh = this.freshnessCaptureMatched();
        if (!fresh.ok) {
          this.invalidateCurrentRecognition({
            kind: "abstained",
            reason: fresh.reason,
          });
          return;
        }

        const cached = this.lastObservation;
        if (!cached) {
          this.invalidateCurrentRecognition({
            kind: "abstained",
            reason: "FRESHNESS_NO_CACHED_OBSERVATION",
          });
          return;
        }

        if (
          this.observationFingerprint(fresh.observation) !== this.observationFingerprint(cached)
        ) {
          this.invalidateCurrentRecognition({
            kind: "abstained",
            reason: "FRESHNESS_SEMANTIC_MISMATCH",
          });
        }
      } catch {
        this.invalidateCurrentRecognition({
          kind: "unknown",
          reason: "FRESHNESS_EXCEPTION",
        });
      }
    } finally {
      this.freshnessGuardDepth -= 1;
    }
  }

  private invalidateCurrentRecognition(
    next:
      | { readonly kind: "unknown"; readonly reason: string }
      | {
          readonly kind: "abstained";
          readonly reason: string;
        },
  ): void {
    this.requestSequence += 1;
    this.interceptEvalSeq += 1;
    this.bumpPreviewGeneration();
    this.lastObservation = null;
    this.lastEvaluation = null;
    // Fail-closed: do NOT clear blockGuard solely because recognition failed.
    this.stopPreviewFreshnessWatch();
    this.dismissPreviewQuietly();
    this.state = next;
    this.emitDiagnostic(next);
  }

  private setState(next: Fc007PassiveState): void {
    this.state = next;
    if (
      next.kind === "abstained" ||
      next.kind === "unknown" ||
      next.kind === "idle" ||
      next.kind === "route-armed" ||
      next.kind === "awaiting-dom"
    ) {
      if (next.kind === "abstained" || next.kind === "unknown" || next.kind === "idle") {
        this.lastObservation = null;
        this.lastEvaluation = null;
        // Keep blockGuard across abstain/unknown; idle/stop clears separately.
        if (next.kind === "idle") {
          this.clearBlockGuard();
        }
        this.stopPreviewFreshnessWatch();
        this.dismissPreviewQuietly();
      }
    }
    if (next.kind === "evaluated") {
      this.lastEvaluation = next.assessment;
      this.lastObservation = next.observation;
    }
    if (next.kind === "contract-recognized") {
      this.lastEvaluation = next.assessment;
      this.lastObservation = next.observation;
    }
    if (next.kind === "stage-recognized") {
      this.lastObservation = next.observation;
      this.lastEvaluation = null;
      this.stopPreviewFreshnessWatch();
      this.dismissPreviewQuietly();
    }
    this.emitDiagnostic(next);
  }

  private emitDiagnostic(state: Fc007PassiveState): void {
    if (!this.onDiagnostic) return;
    try {
      const sprint3a = {
        continueVisible: this.isContinueVisibleForTest(),
        trustedContinueAttempts: this.trustedContinueAttempts,
        acceptedContinueAttempts: this.acceptedContinueAttempts,
        continueValidationPass: this.continueValidationPass,
        continueValidationFail: this.continueValidationFail,
        armCount: this.armCount,
        executorCount: this.executorCount,
        authorizedReleaseCount: this.authorizedReleaseCount,
        releaseCalls: this.releaseCalls,
        consumptions: this.consumptions,
        retries: this.retries,
        fallbacks: this.fallbacks,
        terminalOutcome: this.terminalOutcome,
      };
      const base: Fc007TrustedDiagnostic = {
        kind: state.kind,
        ...("reason" in state ? { reason: state.reason } : {}),
        previewMode: this.previewUi.getMode(),
        ...sprint3a,
      };
      if (
        state.kind === "contract-recognized" ||
        state.kind === "evaluated" ||
        state.kind === "stage-recognized"
      ) {
        const obs = state.observation;
        this.onDiagnostic({
          ...base,
          contractId: obs.contractId ?? FC007_V2_CONTRACT_ID,
          ...(isGitHubVisibilityObservationV2(obs) ? { stage: obs.stage } : {}),
          ownerNormalized: obs.ownerNormalized,
          repoNormalized: obs.repoNormalized,
          currentVisibility: obs.currentVisibility,
          requestedVisibility: obs.requestedVisibility,
          readiness: obs.readiness,
        });
        return;
      }
      this.onDiagnostic(base);
    } catch {
      // Diagnostic must never break recognition.
    }
  }

  start(): void {
    this.stop();
    this.controllerEpoch += 1;
    this.started = true;
    this.resetContinueDiagnostics();
    this.ensureReleaseListenerInstalled();

    const loc = this.resolveLocation();
    const auth = authorizeFc007SettingsLocation(loc, {
      requireTopFrame: this.requireTopFrame,
      ...(this.win ? { win: this.win } : {}),
    });
    if (auth.status !== "authorized") {
      this.setState({ kind: "abstained", reason: auth.reason });
      return;
    }

    this.setState({ kind: "route-armed" });
    this.installInterceptionListener();
    this.previewUi.init({
      onCancel: () => this.handlePreviewCancel(),
      onContinue: (event) => this.handlePreviewContinue(event),
      ...(this.trustClickForTest ? { isTrustedUiEvent: this.trustClickForTest } : {}),
    });
    this.installObserver();
    this.installPageHideListener();

    const ready = this.doc.readyState;
    if (ready === "loading") {
      this.setState({ kind: "awaiting-dom" });
      const onReady = (): void => {
        this.clearDomContentLoadedListener();
        if (!this.started) return;
        void this.attemptFullRecognition();
      };
      this.domContentLoadedListener = onReady;
      this.doc.addEventListener("DOMContentLoaded", onReady, { once: true });
      return;
    }

    void this.attemptFullRecognition();
  }

  stop(): void {
    const dispatchActive = this.releaseDispatchInProgress === true;
    this.started = false;
    this.controllerEpoch += 1;
    this.requestSequence += 1;
    this.interceptEvalSeq += 1;
    this.bumpPreviewGeneration();
    this.freshnessObserverPausedForTest = false;
    // During active release: retire authority only — do not mutate retained host/UI yet.
    this.clearActiveDecision({ skipUiMutation: dispatchActive });
    this.clearDomContentLoadedListener();
    this.clearPageHideListener();
    this.removeInterceptionListener({ keepSubmitListener: dispatchActive });
    this.stopPreviewFreshnessWatch();
    this.clearBlockGuard();
    try {
      this.release.invalidate("controller-stop");
    } catch {
      // ignore
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.lastObservation = null;
    this.lastEvaluation = null;
    // Do NOT setState("idle") while dispatch is active — setState idle dismisses/removes
    // the modal preview host. Logical idle is recorded without UI teardown.
    if (dispatchActive) {
      this.state = { kind: "idle" };
      this.deferredStopUiCleanup = true;
      this.emitDiagnostic(this.state);
      return;
    }

    this.setState({ kind: "idle" });
    this.deferredStopUiCleanup = false;
    try {
      this.previewUi.destroy();
    } catch {
      // ignore
    }
    if (this.ownsReleaseLifecycle) {
      this.release.uninstall();
    }
  }

  private finishDeferredStopUiCleanup(): void {
    if (!this.deferredStopUiCleanup) return;
    this.deferredStopUiCleanup = false;
    if (!this.started) this.removeInterceptionListener();
    try {
      this.previewUi.destroy();
    } catch {
      // ignore
    }
    if (this.ownsReleaseLifecycle) {
      try {
        this.release.uninstall();
      } catch {
        // ignore
      }
    }
  }
  private clearDomContentLoadedListener(): void {
    if (this.domContentLoadedListener) {
      this.doc.removeEventListener("DOMContentLoaded", this.domContentLoadedListener);
      this.domContentLoadedListener = null;
    }
  }

  async attemptFullRecognition(): Promise<Fc007PassiveState> {
    if (!this.started) {
      return this.state;
    }

    const epoch = this.controllerEpoch;
    const seq = ++this.requestSequence;
    const opts = this.captureOptions();
    const loc = this.resolveLocation();

    if (this.recognitionVersion === "v1") {
      return this.attemptFullRecognitionV1(epoch, seq, loc, opts);
    }
    return this.attemptFullRecognitionV2(epoch, seq, loc, opts);
  }

  private async attemptFullRecognitionV1(
    epoch: number,
    seq: number,
    loc: Fc007LocationLike,
    opts: ReturnType<Fc007PassiveController["captureOptions"]>,
  ): Promise<Fc007PassiveState> {
    const full = captureFullContract(this.doc, loc, opts);

    if (full.status !== "matched") {
      if (epoch !== this.controllerEpoch || seq !== this.requestSequence) {
        return this.state;
      }
      this.setState({ kind: "abstained", reason: full.reason });
      return this.state;
    }

    const adapted = adaptGithubVisibilityObservationToCanonicalContext(full.value.observation);
    if (adapted.status !== "ok") {
      if (epoch !== this.controllerEpoch || seq !== this.requestSequence) {
        return this.state;
      }
      this.setState({ kind: "abstained", reason: adapted.reason });
      return this.state;
    }

    const evaluatedObservation = full.value.observation;
    const evaluatedFingerprint = observationSemanticFingerprint(evaluatedObservation);

    if (epoch === this.controllerEpoch && seq === this.requestSequence) {
      this.lastObservation = evaluatedObservation;
      this.setState({
        kind: "contract-recognized",
        observation: evaluatedObservation,
        context: adapted.context,
        assessment: null,
      });
    }

    if (!this.evaluateOnRecognize) {
      return this.state;
    }

    const result = await this.runEngineEvaluation(adapted.context);

    if (epoch !== this.controllerEpoch || seq !== this.requestSequence || !this.started) {
      return this.state;
    }

    const fresh = captureFullContract(this.doc, loc, opts);
    if (fresh.status !== "matched") {
      this.setState({ kind: "abstained", reason: fresh.reason });
      return this.state;
    }
    if (observationSemanticFingerprint(fresh.value.observation) !== evaluatedFingerprint) {
      this.setState({ kind: "abstained", reason: "EVALUATION_STATE_CHANGED" });
      return this.state;
    }

    if (!result.ok) {
      this.setState({
        kind: "contract-recognized",
        observation: fresh.value.observation,
        context: adapted.context,
        assessment: null,
      });
      return this.state;
    }

    this.lastObservation = fresh.value.observation;
    this.setState({
      kind: "evaluated",
      observation: fresh.value.observation,
      context: adapted.context,
      assessment: result.value,
    });
    return this.state;
  }

  private async attemptFullRecognitionV2(
    epoch: number,
    seq: number,
    loc: Fc007LocationLike,
    opts: ReturnType<Fc007PassiveController["captureOptions"]>,
  ): Promise<Fc007PassiveState> {
    const full = captureFullContractV2(this.doc, loc, opts);

    if (full.status !== "matched") {
      if (epoch !== this.controllerEpoch || seq !== this.requestSequence) {
        return this.state;
      }
      this.setState({ kind: "abstained", reason: full.reason });
      return this.state;
    }

    const observation = full.value.observation;

    if (!this.isActionableObservation(observation)) {
      if (epoch === this.controllerEpoch && seq === this.requestSequence) {
        this.setState({
          kind: "stage-recognized",
          observation,
        });
      }
      return this.state;
    }

    const adapted = adaptGithubVisibilityObservationV2ToCanonicalContext(observation);
    if (adapted.status !== "ok") {
      if (epoch !== this.controllerEpoch || seq !== this.requestSequence) {
        return this.state;
      }
      this.setState({ kind: "abstained", reason: adapted.reason });
      return this.state;
    }

    const evaluatedFingerprint = observationSemanticFingerprintV2(observation);
    const finalButton = full.value.finalButton;
    if (!(finalButton instanceof HTMLButtonElement)) {
      if (epoch === this.controllerEpoch && seq === this.requestSequence) {
        this.setState({ kind: "abstained", reason: "STAGE_D_FINAL_BUTTON_MISSING" });
      }
      return this.state;
    }

    const form = full.value.form instanceof HTMLFormElement ? full.value.form : null;
    const modal = full.value.dialog instanceof HTMLDialogElement ? full.value.dialog : null;

    if (epoch === this.controllerEpoch && seq === this.requestSequence) {
      this.installBlockGuard(finalButton, form, modal);
      this.lastObservation = observation;
      this.setState({
        kind: "contract-recognized",
        observation,
        context: adapted.context,
        assessment: null,
      });
    }

    if (!this.evaluateOnRecognize) {
      return this.state;
    }

    const result = await this.runEngineEvaluation(adapted.context);

    if (epoch !== this.controllerEpoch || seq !== this.requestSequence || !this.started) {
      return this.state;
    }

    const fresh = captureFullContractV2(this.doc, loc, opts);
    if (fresh.status !== "matched") {
      this.setState({ kind: "abstained", reason: fresh.reason });
      return this.state;
    }
    if (observationSemanticFingerprintV2(fresh.value.observation) !== evaluatedFingerprint) {
      this.setState({ kind: "abstained", reason: "EVALUATION_STATE_CHANGED" });
      return this.state;
    }
    if (fresh.value.finalButton !== finalButton) {
      this.setState({ kind: "abstained", reason: "FINAL_BUTTON_IDENTITY_CHANGED" });
      return this.state;
    }

    if (!result.ok) {
      this.installBlockGuard(finalButton, form, modal);
      this.setState({
        kind: "contract-recognized",
        observation: fresh.value.observation,
        context: adapted.context,
        assessment: null,
      });
      return this.state;
    }

    this.installBlockGuard(finalButton, form, modal);
    this.lastObservation = fresh.value.observation;
    this.setState({
      kind: "evaluated",
      observation: fresh.value.observation,
      context: adapted.context,
      assessment: result.value,
    });
    return this.state;
  }

  private observeRoot(): Node {
    // Prefer an Element root. Observing a detached createHTMLDocument Document
    // is unreliable for attribute delivery in happy-dom (and some Chromium paths).
    return this.doc.documentElement ?? this.doc.body ?? this.doc;
  }

  private installObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.observer = new MutationObserver((records) => {
      this.onMutations(records);
    });
    // Recognition observer: structural + common authority attributes.
    // While VERIFIED, installVerifiedFreshnessObserver replaces this with all-attributes.
    this.observer.observe(this.observeRoot(), {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: [
        "disabled",
        "aria-disabled",
        "open",
        "aria-modal",
        "hidden",
        "inert",
        "form",
        "formaction",
        "formmethod",
        "formenctype",
        "formtarget",
        "formnovalidate",
        "action",
        "method",
        "target",
        "enctype",
        "novalidate",
        "role",
        "lang",
        "name",
        "aria-label",
        "type",
        "tabindex",
      ],
    });
  }

  /** While VERIFIED: observe ALL attributes — validator is source of truth. */
  private installVerifiedFreshnessObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.observer = new MutationObserver((records) => {
      this.onMutations(records);
    });
    this.observer.observe(this.observeRoot(), {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      // No attributeFilter — all attribute mutations trigger bounded recapture.
    });
  }

  private onMutations(records: MutationRecord[]): void {
    if (records.length === 0) return;

    // Ignore only the narrow FutureClick host mount/unmount transaction.
    if (this.pendingMountTransaction) {
      return;
    }

    // While evaluation is pending (pending preview OR in-flight eval): any light-DOM
    // mutation invalidates pending authority so a stale assessment cannot VERIFIED.
    if (this.previewUi.getMode() === "pending" || this.interceptEvalPending) {
      this.invalidatePendingEvaluation("PENDING_MUTATION");
      return;
    }

    // While VERIFIED, any light-DOM mutation (including exact host mutations) triggers recapture.
    // Do NOT ignore mutations because target === previewHost.
    if (this.previewUi.getMode() === "verified") {
      this.runVerifiedPreviewFreshness("mutation");
      return;
    }

    const delivery = processMutationDelivery(records);
    if (delivery.status === "overflow") {
      this.invalidateCurrentRecognition({
        kind: "unknown",
        reason: delivery.reason,
      });
      return;
    }
    if (delivery.status === "relevant") {
      if (delivery.hadRemovals) {
        this.invalidateCurrentRecognition({
          kind: "abstained",
          reason: "MUTATION_REMOVAL",
        });
      }
      if (this.previewUi.isVisible()) {
        this.dismissPreviewQuietly();
      }
      void this.attemptFullRecognition();
    }
  }

  /**
   * Pending evaluation authority is no longer current. Keep fail-closed block guard
   * for the exact button/modal; do not publish VERIFIED from the in-flight assessment.
   */
  private invalidatePendingEvaluation(reason: string): void {
    this.bumpPreviewGeneration();
    this.interceptEvalSeq += 1;
    this.interceptEvalPending = false;
    this.lastObservation = null;
    this.lastEvaluation = null;
    this.stopPreviewFreshnessWatch();
    this.state = { kind: "abstained", reason };
    this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
    this.emitDiagnostic(this.state);
    this.scheduleRecoveryRecognition();
  }

  /**
   * After a surface change demotes pending/VERIFIED authority, re-run full recognition once so
   * the guard moves to the current Stage-D button. Coalesced to one queued run; stale async
   * results still lose to requestSequence / interceptEvalSeq / previewGeneration. Skipped while
   * a new preview or release is in flight, so it cannot loop (re-entering pending/VERIFIED
   * requires a human activation).
   */
  private scheduleRecoveryRecognition(): void {
    if (this.recoveryRecognitionQueued || !this.started) return;
    this.recoveryRecognitionQueued = true;
    const epoch = this.controllerEpoch;
    queueMicrotask(() => {
      this.recoveryRecognitionQueued = false;
      if (!this.started || epoch !== this.controllerEpoch) return;
      const mode = this.previewUi.getMode();
      if (
        mode === "verified" ||
        mode === "pending" ||
        this.interceptEvalPending ||
        this.releaseDispatchInProgress ||
        this.continueInProgress
      ) {
        return;
      }
      this.recoveryRecognitionRuns += 1;
      void this.attemptFullRecognition();
    });
  }

  private demoteVerifiedPreviewForSurfaceChange(reason: string): void {
    this.demoteVerifiedPreview(reason);
    this.scheduleRecoveryRecognition();
  }

  private installInterceptionListener(): void {
    if (this.interceptionInstalled) return;
    if (this.recognitionVersion !== "v2") return;
    const target: Window | Document = this.win ?? this.doc.defaultView ?? this.doc;
    const listener = (event: Event): void => {
      this.handleCaptureClick(event);
    };
    target.addEventListener("click", listener, { capture: true, passive: false });
    if (!this.windowSubmitListener) {
      const submitListener = (event: Event): void => {
        this.handleCaptureSubmit(event);
      };
      target.addEventListener("submit", submitListener, { capture: true, passive: false });
      this.windowSubmitListener = submitListener;
    }
    this.windowClickListener = listener;
    this.interceptionInstalled = true;
  }

  private removeInterceptionListener(options?: { readonly keepSubmitListener?: boolean }): void {
    const target: Window | Document = this.win ?? this.doc.defaultView ?? this.doc;
    if (this.windowSubmitListener && options?.keepSubmitListener !== true) {
      target.removeEventListener("submit", this.windowSubmitListener, {
        capture: true,
      } as EventListenerOptions);
      this.windowSubmitListener = null;
    }
    if (!this.interceptionInstalled || !this.windowClickListener) {
      this.interceptionInstalled = false;
      this.windowClickListener = null;
      return;
    }
    target.removeEventListener("click", this.windowClickListener, {
      capture: true,
    } as EventListenerOptions);
    this.windowClickListener = null;
    this.interceptionInstalled = false;
  }

  private installBlockGuard(
    button: HTMLButtonElement,
    form: HTMLFormElement | null,
    modal: HTMLDialogElement | null,
  ): void {
    this.blockGuard = { button, form, modal };
  }

  /**
   * The guard is never dropped because the surface changed: a closed modal or a
   * detached-then-reinserted button can still reach the form's default action through a
   * page-generated activation. Cleared only on idle/stop, or replaced by a newer guard.
   */
  private clearBlockGuard(): void {
    this.blockGuard = null;
  }

  private bumpPreviewGeneration(): void {
    this.previewGeneration += 1;
  }

  private snapshotRouteKey(): string {
    const win = this.win ?? this.doc.defaultView;
    if (win?.location?.href) return win.location.href;
    const loc = this.resolveLocation();
    return `${loc.protocol}//${loc.hostname}${loc.port ? `:${loc.port}` : ""}${loc.pathname}`;
  }

  private computePreviewAuthorityDigest(guard: Fc007BlockGuard): string {
    const modal = guard.modal;
    const effects = modal ? findExactEffectsRegion(modal, this.doc) : null;
    const effectsText = effects
      ? (effects.textContent || "").replace(/[\t\n\r\f\v ]+/g, " ").trim()
      : "";
    const effectsAria = effects?.getAttribute("aria-label") ?? "";
    const btnOwn = normalizedOwnText(guard.button);
    const btnText = btnOwn.status === "ok" ? btnOwn.text : "";
    const btnName = guard.button.getAttribute("name") ?? guard.button.name ?? "";
    const formAction = guard.form?.getAttribute("action") ?? "";
    const formMethod = guard.form?.getAttribute("method") ?? "";
    const disabled = guard.button.disabled || guard.button.getAttribute("aria-disabled") === "true";
    const modalOpen = modal?.open === true;
    const host = this.previewUi.getHost();
    const hostAttrCount = host?.attributes.length ?? -1;
    const hostChildCount = host?.childNodes.length ?? -1;
    return [
      effectsText,
      effectsAria,
      btnText,
      btnName,
      formAction,
      formMethod,
      disabled ? "1" : "0",
      modalOpen ? "1" : "0",
      String(hostAttrCount),
      String(hostChildCount),
    ].join("|");
  }

  private startPreviewFreshnessWatch(): void {
    this.stopPreviewFreshnessWatch();
    this.installVerifiedFreshnessObserver();
    this.previewRouteSnapshot = this.snapshotRouteKey();
    const win = this.win ?? this.doc.defaultView;
    const onNav = (): void => {
      if (this.previewUi.getMode() === "pending" || this.interceptEvalPending) {
        this.invalidatePendingEvaluation("PENDING_ROUTE");
        return;
      }
      if (this.previewUi.getMode() === "verified") {
        this.runVerifiedPreviewFreshness("route-event");
      }
    };
    if (win) {
      win.addEventListener("popstate", onNav);
      win.addEventListener("hashchange", onNav);
    }
    const timerSource: Pick<Window, "setInterval" | "clearInterval"> = win ?? globalThis;
    const timer = timerSource.setInterval(() => {
      if (this.previewUi.getMode() === "pending" || this.interceptEvalPending) {
        const now = this.snapshotRouteKey();
        if (this.previewRouteSnapshot != null && now !== this.previewRouteSnapshot) {
          this.invalidatePendingEvaluation("PENDING_ROUTE_POLL");
        }
        return;
      }
      if (this.previewUi.getMode() !== "verified") return;
      const now = this.snapshotRouteKey();
      if (this.previewRouteSnapshot != null && now !== this.previewRouteSnapshot) {
        this.runVerifiedPreviewFreshness("route-poll");
        return;
      }
      // Fail-safe: bounded recapture while VERIFIED so missed attribute deliveries
      // cannot leave stale VERIFIED (validator remains source of truth).
      this.runVerifiedPreviewFreshness("verified-poll");
    }, 200);
    this.routeWatchCleanup = (): void => {
      if (win) {
        win.removeEventListener("popstate", onNav);
        win.removeEventListener("hashchange", onNav);
      }
      timerSource.clearInterval(timer);
    };
  }

  private stopPreviewFreshnessWatch(): void {
    if (this.routeWatchCleanup) {
      try {
        this.routeWatchCleanup();
      } catch {
        // ignore
      }
      this.routeWatchCleanup = null;
    }
    this.previewRouteSnapshot = null;
    // Restore recognition observer after VERIFIED freshness ends.
    if (this.started) {
      this.installObserver();
    }
  }

  private clearPreviewAuthorityDigest(): void {
    this.previewAuthorityDigest = null;
  }

  private runVerifiedPreviewFreshness(_reason: string): void {
    if (this.freshnessObserverPausedForTest) return;
    if (this.previewUi.getMode() !== "verified") return;
    const gen = this.previewGeneration;
    const guard = this.blockGuard;
    if (!guard) {
      this.demoteVerifiedPreviewForSurfaceChange("PREVIEW_GUARD_GONE");
      return;
    }

    const host = this.previewUi.getHost();
    let full: ReturnType<typeof captureFullContractV2>;
    try {
      full = captureFullContractV2(this.doc, this.resolveLocation(), this.captureOptions(host));
    } catch {
      if (gen === this.previewGeneration) {
        this.demoteVerifiedPreviewForSurfaceChange("PREVIEW_FRESHNESS_EXCEPTION");
      }
      return;
    }
    if (gen !== this.previewGeneration) return;

    if (
      full.status !== "matched" ||
      full.value.stage !== "final-confirmation" ||
      full.value.finalButton !== guard.button ||
      (guard.form != null && full.value.form !== guard.form) ||
      (guard.modal != null && full.value.dialog !== guard.modal)
    ) {
      this.demoteVerifiedPreviewForSurfaceChange("PREVIEW_STALE");
      return;
    }

    const observation = full.value.observation;
    if (!isGitHubVisibilityObservationV2(observation) || observation.readiness !== "enabled") {
      this.demoteVerifiedPreviewForSurfaceChange("PREVIEW_READINESS");
      return;
    }

    if (
      this.lastObservation &&
      isGitHubVisibilityObservationV2(this.lastObservation) &&
      observationSemanticFingerprintV2(observation) !==
        observationSemanticFingerprintV2(this.lastObservation)
    ) {
      this.demoteVerifiedPreviewForSurfaceChange("PREVIEW_SEMANTIC_STALE");
      return;
    }

    if (
      this.previewAuthorityDigest != null &&
      this.computePreviewAuthorityDigest(guard) !== this.previewAuthorityDigest
    ) {
      this.demoteVerifiedPreviewForSurfaceChange("PREVIEW_DIGEST_STALE");
    }
  }

  private demoteVerifiedPreview(reason: string): void {
    this.bumpPreviewGeneration();
    this.interceptEvalSeq += 1;
    this.clearActiveDecision();
    this.stopPreviewFreshnessWatch();
    this.clearPreviewAuthorityDigest();
    this.lastObservation = null;
    this.lastEvaluation = null;
    this.state = { kind: "abstained", reason };
    // Automatic freshness demotion dismisses preview chrome (non-authoritative).
    try {
      this.previewUi.dismiss();
    } catch {
      // ignore
    }
    this.emitDiagnostic(this.state);
  }

  private dismissPreviewQuietly(): void {
    this.clearActiveDecision();
    this.stopPreviewFreshnessWatch();
    this.clearPreviewAuthorityDigest();
    try {
      this.previewUi.dismiss();
    } catch {
      // ignore
    }
  }

  private handlePreviewCancel(): void {
    this.bumpPreviewGeneration();
    this.interceptEvalSeq += 1;
    this.clearActiveDecision();
    this.dismissPreviewQuietly();
    this.emitDiagnostic(this.state);
  }

  private resetContinueDiagnostics(): void {
    this.trustedContinueAttempts = 0;
    this.acceptedContinueAttempts = 0;
    this.continueValidationPass = 0;
    this.continueValidationFail = 0;
    this.armCount = 0;
    this.executorCount = 0;
    this.authorizedReleaseCount = 0;
    this.releaseCalls = 0;
    this.consumptions = 0;
    this.retries = 0;
    this.fallbacks = 0;
    this.terminalOutcome = null;
    this.continueInProgress = false;
  }

  private ensureReleaseListenerInstalled(): void {
    if (this.release.isListenerInstalled()) return;
    const opts = {
      ...(this.matchesModal ? { matchesModal: this.matchesModal } : {}),
    };
    // Prefer Window only when it belongs to this controller document (production).
    const win =
      this.win ??
      (typeof this.doc.defaultView !== "undefined"
        ? (this.doc.defaultView as Window | null)
        : null);
    if (win && win.document === this.doc) {
      this.releaseListenerInstallCount += 1;
      this.release.install(win, opts);
      return;
    }
    // Orphan fixture documents (unit tests): Document capture — same as Sprint-3B.
    this.releaseListenerInstallCount += 1;
    this.release.install(this.doc, opts);
  }

  private syncReleaseDiagnosticsFromComponent(): void {
    const c = this.release.getCounters();
    this.armCount = c.arms;
    this.executorCount = c.executorCalls;
    this.authorizedReleaseCount = c.authorizedEventsObserved;
    this.consumptions = c.permissionConsumptions;
    this.retries = c.retries;
    this.fallbacks = c.fallbacks;
  }

  private terminalMessageForRelease(
    outcome: Fc007ReleaseOutcome,
    consumed: boolean,
  ): { readonly message: string; readonly reason: string } {
    if (consumed === true) {
      if (outcome === "EXECUTOR_FAILED_AFTER_CONSUME" || outcome === "INVALIDATED_AFTER_CONSUME") {
        return {
          message: "FutureClick admitted the action once; downstream completion was not confirmed.",
          reason: "ACTION_ADMITTED_ONCE_UNCONFIRMED",
        };
      }
      return {
        message: "Action admitted once.",
        reason: "ACTION_ADMITTED_ONCE",
      };
    }
    return {
      message: "Action stopped — FutureClick could not complete the reviewed action.",
      reason: `RELEASE_${outcome}`,
    };
  }

  private clearActiveDecision(options?: { readonly skipUiMutation?: boolean }): void {
    if (this.activeDecisionBinding) {
      this.activeDecisionBinding.status = "retired";
    }
    this.activeDecisionBinding = null;
    this.continueInProgress = false;
    if (options?.skipUiMutation === true) return;
    try {
      this.previewUi.inertContinue();
    } catch {
      // ignore
    }
  }

  private installPageHideListener(): void {
    this.clearPageHideListener();
    const target = this.win ?? (typeof window !== "undefined" ? window : null);
    if (!target) return;
    const onHide = (): void => {
      const dispatchActive = this.releaseDispatchInProgress === true;
      this.clearActiveDecision({ skipUiMutation: dispatchActive });
      this.bumpPreviewGeneration();
      try {
        this.release.invalidate("pagehide");
      } catch {
        // ignore
      }
      if (dispatchActive) {
        this.started = false;
        this.controllerEpoch += 1;
        this.deferredStopUiCleanup = true;
        return;
      }
      try {
        this.previewUi.destroy();
      } catch {
        // ignore
      }
    };
    this.pageHideListener = onHide;
    target.addEventListener("pagehide", onHide);
  }

  private clearPageHideListener(): void {
    if (!this.pageHideListener) return;
    const target = this.win ?? (typeof window !== "undefined" ? window : null);
    if (target) {
      target.removeEventListener("pagehide", this.pageHideListener);
    }
    this.pageHideListener = null;
  }

  /**
   * Sprint 3C Continue — trusted browser-generated click only.
   * Accepts at most one Continue per VerifiedDecision; then atomic releaseOnce.
   */
  private handlePreviewContinue(event: MouseEvent): void {
    const continueControl = this.previewUi.getContinueButtonForTest();
    if (!continueControl) return;
    if (event.type !== "click") return;
    const trusted =
      this.trustClickForTest != null ? this.trustClickForTest(event) : event.isTrusted === true;
    if (!trusted) return;
    if (event.currentTarget !== continueControl) return;
    if (this.previewUi.getMode() !== "verified") return;
    if (!this.started) return;

    this.trustedContinueAttempts += 1;

    if (this.continueInProgress) {
      this.emitDiagnostic(this.state);
      return;
    }

    const binding = this.activeDecisionBinding;
    if (!binding || binding.decision.continueControl !== continueControl) {
      this.emitDiagnostic(this.state);
      return;
    }
    if (binding.decision.controllerEpoch !== this.controllerEpoch) {
      this.clearActiveDecision();
      this.emitDiagnostic(this.state);
      return;
    }
    if (binding.status !== "eligible") {
      this.emitDiagnostic(this.state);
      return;
    }

    // Private eligibility only — NO UI mutation before final validation (L1).
    binding.status = "accepted";
    this.continueInProgress = true;
    this.acceptedContinueAttempts += 1;
    const decision = binding.decision;
    const lifecycleEpochAtAccept = this.controllerEpoch;

    try {
      const validation = validateContinueSameDecision({
        decision,
        document: this.doc,
        location: this.resolveLocation(),
        ownedPreviewHost: this.previewUi.getHost(),
        expectedControllerEpoch: this.controllerEpoch,
        expectedInterceptEvalSeq: this.interceptEvalSeq,
        expectedDecisionGeneration: decision.decisionGeneration,
        requireTopFrame: this.requireTopFrame,
        ...(this.win ? { win: this.win } : {}),
        ...(this.matchesModal ? { matchesModal: this.matchesModal } : {}),
      });

      if (validation.status === "VALID_SAME_DECISION") {
        this.continueValidationPass += 1;
        // Private assignments only — host must remain until releaseOnce returns.
        binding.status = "retired";
        this.activeDecisionBinding = null;
        this.stopPreviewFreshnessWatch();
        this.clearPreviewAuthorityDigest();

        let outcome: Fc007ReleaseOutcome = "INVALIDATED";
        let consumed = false;
        this.releaseDispatchInProgress = true;
        this.releaseSubmitAllowance = "available";
        this.releaseAuthorizedClick = null;
        this.releaseGuardedButton = decision.finalButton;
        try {
          this.ensureReleaseListenerInstalled();
          const result = this.release.releaseOnce(decision);
          outcome = result.outcome;
          consumed = result.receipt.consumed === true;
        } catch {
          outcome = "INVALIDATED";
          consumed = false;
        } finally {
          this.releaseDispatchInProgress = false;
          this.releaseSubmitAllowance = "none";
          this.releaseAuthorizedClick = null;
          this.releaseGuardedButton = null;
        }
        this.releaseCalls += 1;
        this.terminalOutcome = outcome;
        this.syncReleaseDiagnosticsFromComponent();

        // Lifecycle check: stop/pagehide during dispatch must not resurrect UI.
        if (
          !this.started ||
          this.deferredStopUiCleanup ||
          this.controllerEpoch !== lifecycleEpochAtAccept
        ) {
          this.finishDeferredStopUiCleanup();
          return;
        }

        // Terminal UI ONLY after releaseOnce has fully returned/unwound.
        this.bumpPreviewGeneration();
        this.previewUi.dismiss();
        const terminal = this.terminalMessageForRelease(outcome, consumed);
        this.showStoppedPreview(terminal.message);
        this.state = { kind: "abstained", reason: terminal.reason };
        this.emitDiagnostic(this.state);
        return;
      }

      this.continueValidationFail += 1;
      binding.status = "retired";
      this.activeDecisionBinding = null;
      // Post-validation UI mutation is allowed on failure.
      try {
        this.previewUi.inertContinue();
      } catch {
        // ignore
      }
      this.demoteVerifiedPreview(`CONTINUE_INVALID_${validation.reason}`);
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
    } finally {
      this.continueInProgress = false;
      if (this.deferredStopUiCleanup) {
        this.finishDeferredStopUiCleanup();
      }
    }
  }

  /**
   * True only while synchronous releaseOnce() runs AND the frozen release component's
   * dispatch guard is active. In that window the release component's own Window-capture
   * listener is the sole authority: it allows exactly the armed one-shot generated event
   * and blocks every other matching activation.
   */
  private isReleaseAuthorityActive(): boolean {
    return this.releaseDispatchInProgress === true && this.release.isDispatchGuardActive();
  }

  /**
   * Matching consequential activation is blocked unless it is the exact authorized
   * release event. Only a trusted first human activation proceeds to interception/preview;
   * page-generated click()/dispatchEvent never substitutes for a human decision.
   */
  private handleCaptureClick(event: Event): void {
    try {
      if (!this.started || this.recognitionVersion !== "v2") return;
      const guard = this.blockGuard;
      if (!guard) return;
      if (!eventTargetsBlockButton(event, guard.button)) return;
      if (this.isReleaseAuthorityActive()) {
        this.noteAuthorizedReleaseClick(event);
        return;
      }

      const humanActivation =
        this.interceptDepth === 0 && passesTrustedActivationGates(event, this.trustClickForTest);

      // ONE early decision at window/document capture — before page ancestors.
      blockSupportedActivationEvent(event);
      if (!humanActivation) {
        this.blockedUnauthorizedActivations += 1;
        return;
      }
      this.afterBlockedSupportedActivation();
    } catch {
      try {
        blockSupportedActivationEvent(event);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Non-cancelable synthetic clicks still run button activation (preventDefault is a no-op),
   * so the resulting cancelable submit is blocked when its submitter is the guarded button.
   * During a release (even if stop() ran mid-dispatch) the released button stays guarded and
   * at most one submit passes.
   */
  private handleCaptureSubmit(event: Event): void {
    try {
      if (this.recognitionVersion !== "v2") return;
      const releaseActive = this.releaseDispatchInProgress === true;
      if (!this.started && !releaseActive) return;
      const guarded = releaseActive ? this.releaseGuardedButton : (this.blockGuard?.button ?? null);
      if (!guarded) return;
      if (typeof SubmitEvent === "undefined" || !(event instanceof SubmitEvent)) return;
      if (event.submitter !== guarded) return;
      if (this.consumeReleaseSubmitAllowance()) return;
      blockSupportedActivationEvent(event);
      this.blockedUnauthorizedSubmits += 1;
    } catch {
      try {
        blockSupportedActivationEvent(event);
      } catch {
        // ignore
      }
    }
  }

  /**
   * The release component's Window-capture listener runs before this controller's, so the
   * matching click seen here right after its consumption (with no later release-listener
   * event in between) is the authorized generated click. Nested matching clicks are stopped
   * by the release component and never reach this listener.
   */
  private noteAuthorizedReleaseClick(event: Event): void {
    if (this.releaseAuthorizedClick !== null) return;
    if (this.release.getReceipt().consumed !== true) return;
    if (this.release.getFcWindowSequenceAtConsume() !== this.release.getFcWindowSequence()) return;
    this.releaseAuthorizedClick = event;
  }

  /**
   * Page-nested submissions or activations fire while the authorized click is still
   * propagating; its own default-action submit fires after dispatch ends (eventPhase NONE).
   */
  private consumeReleaseSubmitAllowance(): boolean {
    if (!this.isReleaseAuthorityActive()) return false;
    if (this.releaseSubmitAllowance !== "available") return false;
    const click = this.releaseAuthorizedClick;
    if (click === null || click.eventPhase !== Event.NONE) return false;
    this.releaseSubmitAllowance = "consumed";
    this.allowedReleaseSubmits += 1;
    return true;
  }

  private afterBlockedSupportedActivation(): void {
    this.interceptDepth += 1;
    try {
      this.revalidateAfterBlockedActivation();
    } finally {
      this.interceptDepth -= 1;
    }
  }

  /**
   * Synchronous fresh V2 proof after block. Evaluation may complete async afterward;
   * the page action remains blocked either way. Failed revalidation clears authority
   * but keeps the fail-closed block guard while the original surface remains.
   *
   * Mount sequence:
   * 1) pre-mount capture (no host)
   * 2) mount pending host in modal
   * 3) post-mount capture with exact owned-host context
   * 4) only then evaluate → VERIFIED
   */
  private revalidateAfterBlockedActivation(): void {
    const guard = this.blockGuard;
    if (!guard) {
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    }

    const loc = this.resolveLocation();
    let preMount: ReturnType<typeof captureFullContractV2>;
    try {
      preMount = captureFullContractV2(this.doc, loc, this.captureOptions());
    } catch {
      this.clearAuthorityKeepBlockGuard("REVALIDATE_EXCEPTION");
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    }

    if (preMount.status !== "matched") {
      this.clearAuthorityKeepBlockGuard(preMount.reason);
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    }

    if (preMount.value.stage !== "final-confirmation") {
      this.clearAuthorityKeepBlockGuard("STAGE_NOT_FINAL");
      this.setState({
        kind: "stage-recognized",
        observation: preMount.value.observation,
      });
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    }

    if (preMount.value.finalButton !== guard.button) {
      this.clearAuthorityKeepBlockGuard("FINAL_BUTTON_REBIND_FAILED");
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    }

    // Form may be replaced since the prior guard snapshot. Require a current native form
    // for Stage-D; do not fail solely because form object identity differs — update after block.
    if (!(preMount.value.form instanceof HTMLFormElement)) {
      this.clearAuthorityKeepBlockGuard("FORM_MISSING");
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    }

    const modal =
      preMount.value.dialog instanceof HTMLDialogElement ? preMount.value.dialog : guard.modal;
    if (!(modal instanceof HTMLDialogElement) || (guard.modal != null && modal !== guard.modal)) {
      this.clearAuthorityKeepBlockGuard("MODAL_REBIND_FAILED");
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    }

    // Stop VERIFIED freshness before mount; mount pending host; post-mount validate.
    this.stopPreviewFreshnessWatch();
    let ownedHost: HTMLDivElement;
    this.pendingMountTransaction = true;
    try {
      ownedHost = this.previewUi.mountPendingInDialog(modal);
    } catch {
      this.pendingMountTransaction = false;
      this.clearAuthorityKeepBlockGuard("PREVIEW_HOST_MOUNT_FAILED");
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    }

    let postMount: ReturnType<typeof captureFullContractV2>;
    try {
      postMount = captureFullContractV2(this.doc, loc, this.captureOptions(ownedHost));
    } catch {
      this.pendingMountTransaction = false;
      this.dismissPreviewQuietly();
      this.clearAuthorityKeepBlockGuard("POST_MOUNT_EXCEPTION");
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    } finally {
      this.pendingMountTransaction = false;
    }

    if (
      postMount.status !== "matched" ||
      postMount.value.stage !== "final-confirmation" ||
      postMount.value.finalButton !== guard.button ||
      !(postMount.value.form instanceof HTMLFormElement) ||
      postMount.value.dialog !== modal
    ) {
      this.dismissPreviewQuietly();
      this.clearAuthorityKeepBlockGuard(
        postMount.status === "matched" ? "POST_MOUNT_STALE" : postMount.reason,
      );
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    }

    const evalForm = postMount.value.form;
    const observation = postMount.value.observation;
    if (!isGitHubVisibilityObservationV2(observation)) {
      this.dismissPreviewQuietly();
      this.clearAuthorityKeepBlockGuard("OBSERVATION_TYPE");
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    }

    if (observation.readiness !== "enabled") {
      this.dismissPreviewQuietly();
      this.clearAuthorityKeepBlockGuard("READINESS");
      this.showStoppedPreview("Action stopped — FutureClick could not verify the current action.");
      return;
    }

    const adapted = adaptGithubVisibilityObservationV2ToCanonicalContext(observation);
    if (adapted.status !== "ok") {
      this.dismissPreviewQuietly();
      this.clearAuthorityKeepBlockGuard(adapted.reason);
      this.showStoppedPreview(
        "Action stopped — FutureClick could not evaluate the current action.",
      );
      return;
    }

    // Update guard form to the current post-mount form (may differ after replacement).
    this.installBlockGuard(guard.button, evalForm, modal);
    this.lastObservation = observation;
    this.setState({
      kind: "contract-recognized",
      observation,
      context: adapted.context,
      assessment: null,
    });

    // Observe all attributes/childList/characterData + route while evaluation is pending.
    this.startPreviewFreshnessWatch();

    const evalSeq = ++this.interceptEvalSeq;
    const epoch = this.controllerEpoch;
    const previewGen = this.previewGeneration;
    const authorityFingerprint = observationSemanticFingerprintV2(observation);
    this.interceptEvalPending = true;
    void this.completeInterceptEvaluation({
      evalSeq,
      epoch,
      previewGen,
      retained: guard.button,
      form: evalForm,
      observation,
      authorityFingerprint,
      context: adapted.context,
      ownedHost,
      modal,
    }).finally(() => {
      if (evalSeq === this.interceptEvalSeq) {
        this.interceptEvalPending = false;
      }
    });
  }

  private clearAuthorityKeepBlockGuard(reason: string): void {
    this.bumpPreviewGeneration();
    this.interceptEvalSeq += 1;
    this.lastObservation = null;
    this.lastEvaluation = null;
    this.stopPreviewFreshnessWatch();
    this.state = { kind: "abstained", reason };
    this.emitDiagnostic(this.state);
  }

  private async completeInterceptEvaluation(args: {
    readonly evalSeq: number;
    readonly epoch: number;
    readonly previewGen: number;
    readonly retained: HTMLButtonElement;
    readonly form: HTMLFormElement;
    readonly observation: GitHubVisibilityObservationV2;
    readonly authorityFingerprint: string;
    readonly context: ActionEvaluationContext;
    readonly ownedHost: HTMLDivElement;
    readonly modal: HTMLDialogElement;
  }): Promise<void> {
    try {
      const result = await this.runEngineEvaluation(args.context);

      if (
        args.evalSeq !== this.interceptEvalSeq ||
        args.epoch !== this.controllerEpoch ||
        args.previewGen !== this.previewGeneration ||
        !this.started
      ) {
        // Stale — pending mutation already invalidated; do not publish VERIFIED.
        return;
      }

      if (this.blockGuard?.button !== args.retained) {
        this.dismissPreviewQuietly();
        this.showStoppedPreview(
          "Action stopped — FutureClick could not verify the current action.",
        );
        return;
      }

      // FINAL PUBLISH GATE — fresh capture required even if no mutation was observed.
      const fresh = captureFullContractV2(
        this.doc,
        this.resolveLocation(),
        this.captureOptions(args.ownedHost),
      );
      if (
        fresh.status !== "matched" ||
        fresh.value.stage !== "final-confirmation" ||
        fresh.value.finalButton !== args.retained ||
        fresh.value.form !== args.form ||
        fresh.value.dialog !== args.modal ||
        !(fresh.value.effectsRegion instanceof HTMLDivElement) ||
        this.previewUi.getHost() !== args.ownedHost
      ) {
        this.dismissPreviewQuietly();
        this.clearAuthorityKeepBlockGuard("PUBLISH_GATE_STALE");
        this.showStoppedPreview(
          "Action stopped — FutureClick could not verify the current action.",
        );
        return;
      }

      const freshObs = fresh.value.observation;
      if (
        !isGitHubVisibilityObservationV2(freshObs) ||
        freshObs.readiness !== "enabled" ||
        observationSemanticFingerprintV2(freshObs) !== args.authorityFingerprint ||
        freshObs.ownerNormalized !== args.observation.ownerNormalized ||
        freshObs.repoNormalized !== args.observation.repoNormalized ||
        freshObs.routeIdentity.pathnameCanonical !==
          args.observation.routeIdentity.pathnameCanonical
      ) {
        this.dismissPreviewQuietly();
        this.clearAuthorityKeepBlockGuard("PUBLISH_GATE_IDENTITY");
        this.showStoppedPreview(
          "Action stopped — FutureClick could not verify the current action.",
        );
        return;
      }

      if (!result.ok) {
        this.dismissPreviewQuietly();
        this.setState({
          kind: "contract-recognized",
          observation: args.observation,
          context: args.context,
          assessment: null,
        });
        this.showStoppedPreview(
          "Action stopped — FutureClick could not evaluate the current action.",
        );
        return;
      }

      if (args.evalSeq !== this.interceptEvalSeq || args.previewGen !== this.previewGeneration) {
        return;
      }

      this.lastObservation = freshObs;
      this.setState({
        kind: "evaluated",
        observation: freshObs,
        context: args.context,
        assessment: result.value,
      });

      const model = buildVerifiedPreviewModel({
        ownerDisplay: freshObs.ownerDisplay,
        repoDisplay: freshObs.repoDisplay,
        assessment: result.value,
      });
      if (model.evidenceLabel !== "VERIFIED") {
        this.dismissPreviewQuietly();
        this.showStoppedPreview(
          "Action stopped — FutureClick could not evaluate the current action.",
        );
        return;
      }

      this.previewUi.showVerified(model, args.modal);
      const continueControl = this.previewUi.getContinueButtonForTest();
      const effectsRegion = fresh.value.effectsRegion;
      if (!(continueControl instanceof HTMLButtonElement)) {
        this.dismissPreviewQuietly();
        this.clearAuthorityKeepBlockGuard("CONTINUE_CONTROL_MISSING");
        this.showStoppedPreview(
          "Action stopped — FutureClick could not verify the current action.",
        );
        return;
      }
      if (!(effectsRegion instanceof HTMLDivElement)) {
        this.dismissPreviewQuietly();
        this.clearAuthorityKeepBlockGuard("EFFECTS_REGION_MISSING");
        this.showStoppedPreview(
          "Action stopped — FutureClick could not verify the current action.",
        );
        return;
      }
      const created = createVerifiedDecision({
        document: this.doc,
        controllerEpoch: this.controllerEpoch,
        interceptEvalSeq: args.evalSeq,
        issuancePreviewGeneration: this.previewGeneration,
        modal: args.modal,
        form: args.form,
        finalButton: args.retained,
        ownedHost: args.ownedHost,
        continueControl,
        effectsRegion,
        observation: freshObs,
        observationFingerprint: args.authorityFingerprint,
        context: args.context,
        assessment: result.value,
      });
      if (created.status !== "ok") {
        this.dismissPreviewQuietly();
        this.clearAuthorityKeepBlockGuard(`DECISION_CREATE_${created.reason}`);
        this.showStoppedPreview(
          "Action stopped — FutureClick could not verify the current action.",
        );
        return;
      }
      this.activeDecisionBinding = {
        decision: created.value,
        status: "eligible",
      };
      this.startPreviewFreshnessWatch();
      this.previewAuthorityDigest = this.computePreviewAuthorityDigest(
        this.blockGuard ?? { button: args.retained, form: args.form, modal: args.modal },
      );
      this.emitDiagnostic(this.state);
    } catch {
      if (
        args.evalSeq === this.interceptEvalSeq &&
        args.epoch === this.controllerEpoch &&
        args.previewGen === this.previewGeneration
      ) {
        this.dismissPreviewQuietly();
        this.showStoppedPreview(
          "Action stopped — FutureClick could not evaluate the current action.",
        );
      }
    }
  }

  private showStoppedPreview(message: string): void {
    try {
      this.terminalUiRenderCount += 1;
      const mount =
        this.blockGuard?.modal && this.doc.contains(this.blockGuard.modal)
          ? this.blockGuard.modal
          : this.doc.body;
      this.previewUi.showStopped(message, mount);
      this.emitDiagnostic(this.state);
    } catch {
      // ignore UI failures — action remains blocked
    }
  }
}
