/**
 * FC-006 Interception Controller (Sprint 3)
 *
 * Epistemological Boundary:
 * Trusted pre-action interception + evaluating UI + deterministic preview +
 * Cancel / Stop / trusted Continue with one-shot private release.
 *
 * Sprint 3 release claim:
 * "At most one authorized continuation activation is issued for one valid
 * Continue decision." Authorization is a private in-memory one-shot capability
 * (not cryptographic). The released click event itself is typically untrusted;
 * authority derives from the trusted Continue decision + ArmedContinuation.
 */

import type { ActionEvaluationContext, ConsequenceAssessment } from "@futureclick/action-schema";
import { BrowserAdapterEngine, type BrowserObservation } from "@futureclick/browser-adapter";
import {
  ConsequenceEngine,
  createDeterministicRuleEvaluator,
} from "@futureclick/consequence-engine";
import { generateEntityId } from "@futureclick/shared";
import {
  buildRetainedReleaseFingerprints,
  revalidatePendingForContinue,
} from "./continue-revalidation.js";
import {
  type ContinueDecisionToken,
  continueDecisionTokensEqual,
  createContinueDecisionToken,
} from "./decision-token.js";
import {
  type Fc006LifecycleKind,
  type PendingMatchOptions,
  blockPendingActivationEvent,
  eventTargetsPendingElement,
  passesNewPreviewEventGates,
  resolveExactFc006SupportedCandidate,
} from "./interception.js";
import { invokeCapturedNativeButtonClick } from "./native-click.js";
import { FC006_PREVIEW_COPY, type Fc006PreviewModel, Fc006Ui } from "./preview.js";
import type {
  Fc006ReleaseAssessmentFingerprint,
  Fc006ReleaseContextFingerprint,
} from "./release-fingerprints.js";
import { syntheticRepositoryInterceptionAdapter } from "./synthetic-repository-interception-adapter.js";

export type Fc006ControllerState =
  | { readonly kind: "off" }
  | { readonly kind: "observing" }
  | { readonly kind: "evaluating" }
  | { readonly kind: "preview-ready" }
  | { readonly kind: "abstention" }
  | { readonly kind: "stale" }
  | { readonly kind: "continuing" };

export interface Fc006PendingAction {
  readonly pendingId: string;
  readonly element: HTMLButtonElement;
  readonly observation: BrowserObservation;
  readonly sessionEpoch: number;
  readonly requestSequence: number;
  context?: ActionEvaluationContext;
  assessment?: ConsequenceAssessment;
  contextFingerprint?: Fc006ReleaseContextFingerprint;
  assessmentFingerprint?: Fc006ReleaseAssessmentFingerprint;
  decisionToken?: ContinueDecisionToken;
}

/** Private in-memory one-shot continuation capability — not cryptographic. */
export interface ArmedContinuation {
  readonly pendingId: string;
  readonly element: HTMLButtonElement;
  readonly sessionEpoch: number;
  readonly requestSequence: number;
  readonly releaseGeneration: number;
  consumed: boolean;
}

export type Fc006EvaluationOutcome =
  | {
      readonly kind: "verified";
      readonly context: ActionEvaluationContext;
      readonly assessment: ConsequenceAssessment;
      readonly preview: Fc006PreviewModel;
    }
  | { readonly kind: "abstention" };

export type Fc006PendingEvaluator = (args: {
  readonly observation: BrowserObservation;
  readonly pendingId: string;
  readonly sessionEpoch: number;
  readonly requestSequence: number;
}) => Promise<Fc006EvaluationOutcome>;

/** Test-only native click seam — production uses captured HTMLButtonElement.prototype.click. */
export type Fc006NativeButtonClickInvoker = (element: HTMLButtonElement) => void;

export interface Fc006ControllerOptions {
  readonly ui?: Fc006Ui | undefined;
  readonly adapterEngine?: BrowserAdapterEngine | undefined;
  readonly consequenceEngine?: ConsequenceEngine | undefined;
  readonly evaluator?: Fc006PendingEvaluator | undefined;
  /** Test seam: observe parentElement reads in the window pending fast path. */
  readonly pendingMatchOptions?: PendingMatchOptions | undefined;
  /** Test seam: replace native click invocation (failure / no-dispatch). */
  readonly nativeButtonClick?: Fc006NativeButtonClickInvoker | undefined;
}

export interface Fc006ReleaseDebugState {
  readonly releaseInProgress: boolean;
  readonly releaseGeneration: number;
  readonly armed: ArmedContinuation | null;
  readonly hasAuthorizedReleasedEvent: boolean;
  readonly stopRequestedAfterRelease: boolean;
  readonly pendingGuardInstalled: boolean;
}

function buildPreviewFromAssessment(assessment: ConsequenceAssessment): Fc006PreviewModel | null {
  const verified = assessment.consequences.filter((c) =>
    c.evidence.some((e) => e.mode === "verified"),
  );
  const first = verified[0];
  if (!first) return null;

  const change = first.stateChanges?.[0];
  const before = change?.before.status === "known" ? String(change.before.value) : null;
  const after = change?.after.status === "known" ? String(change.after.value) : null;

  if (before !== "private" || after !== "public") {
    return null;
  }

  if (first.risk?.severity !== "high") {
    return null;
  }

  return {
    riskLabel: FC006_PREVIEW_COPY.riskLabel,
    beforeLabel: FC006_PREVIEW_COPY.beforeLabel,
    afterLabel: FC006_PREVIEW_COPY.afterLabel,
    evidenceLabel: FC006_PREVIEW_COPY.evidenceLabel,
    categories: [...FC006_PREVIEW_COPY.categories],
    reversibilityLabel: FC006_PREVIEW_COPY.reversibilityLabel,
    engineSummary: first.summary,
    fixedExplanation: FC006_PREVIEW_COPY.fixedExplanation,
    syntheticDisclaimer: FC006_PREVIEW_COPY.syntheticDisclaimer,
  };
}

export class Fc006InterceptionController {
  private state: Fc006ControllerState = { kind: "off" };
  private sessionEpoch = 0;
  private requestSequence = 0;
  private pending: Fc006PendingAction | null = null;
  private listenerInstalled = false;
  private pendingElementGuard: ((event: Event) => void) | null = null;
  private pendingGuardElement: HTMLButtonElement | null = null;
  /** Test instrumentation: increments on each direct pending-element guard invocation. */
  private pendingGuardInvocations = 0;

  private releaseGeneration = 0;
  private previewGeneration = 0;
  private releaseInProgress = false;
  private armedContinuation: ArmedContinuation | null = null;
  private authorizedReleasedEvent: Event | null = null;
  private stopRequestedAfterRelease = false;
  private activeDecisionToken: ContinueDecisionToken | null = null;

  private readonly ui: Fc006Ui;
  private readonly adapterEngine: BrowserAdapterEngine;
  private readonly consequenceEngine: ConsequenceEngine;
  private readonly evaluator: Fc006PendingEvaluator;
  private readonly pendingMatchOptions: PendingMatchOptions | undefined;
  private readonly nativeButtonClick: Fc006NativeButtonClickInvoker;

  constructor(options?: Fc006ControllerOptions) {
    this.ui = options?.ui ?? new Fc006Ui();
    this.pendingMatchOptions = options?.pendingMatchOptions;
    this.nativeButtonClick = options?.nativeButtonClick ?? invokeCapturedNativeButtonClick;
    this.adapterEngine =
      options?.adapterEngine ??
      new BrowserAdapterEngine({
        registry: [syntheticRepositoryInterceptionAdapter],
      });

    if (options?.consequenceEngine) {
      this.consequenceEngine = options.consequenceEngine;
    } else {
      this.consequenceEngine = new ConsequenceEngine();
      this.consequenceEngine.registerEvaluator(createDeterministicRuleEvaluator());
    }

    this.evaluator = options?.evaluator ?? ((args) => this.defaultEvaluate(args));
  }

  public getState(): Fc006ControllerState {
    return this.state;
  }

  public getLifecycleKind(): Fc006LifecycleKind {
    return this.state.kind;
  }

  public getPending(): Fc006PendingAction | null {
    return this.pending;
  }

  public getSessionEpoch(): number {
    return this.sessionEpoch;
  }

  public getRequestSequence(): number {
    return this.requestSequence;
  }

  public getUi(): Fc006Ui {
    return this.ui;
  }

  /** Test seam: whether a direct pending-element capture guard is installed. */
  public hasPendingElementGuard(): boolean {
    return this.pendingElementGuard !== null && this.pendingGuardElement !== null;
  }

  public getPendingGuardInvocations(): number {
    return this.pendingGuardInvocations;
  }

  /** Test seam: release / armed continuation snapshot. */
  public getReleaseDebugState(): Fc006ReleaseDebugState {
    return {
      releaseInProgress: this.releaseInProgress,
      releaseGeneration: this.releaseGeneration,
      armed: this.armedContinuation
        ? {
            pendingId: this.armedContinuation.pendingId,
            element: this.armedContinuation.element,
            sessionEpoch: this.armedContinuation.sessionEpoch,
            requestSequence: this.armedContinuation.requestSequence,
            releaseGeneration: this.armedContinuation.releaseGeneration,
            consumed: this.armedContinuation.consumed,
          }
        : null,
      hasAuthorizedReleasedEvent: this.authorizedReleasedEvent !== null,
      stopRequestedAfterRelease: this.stopRequestedAfterRelease,
      pendingGuardInstalled: this.hasPendingElementGuard(),
    };
  }

  /**
   * Install capture-phase click listener immediately (document_start).
   * Listener remains for document lifetime. Controller starts in `off`.
   */
  public installEarlyListener(): void {
    if (this.listenerInstalled || typeof window === "undefined") return;
    if (typeof window.addEventListener !== "function") return;
    window.addEventListener("click", this.handleCaptureClick, {
      capture: true,
      passive: false,
    });
    this.listenerInstalled = true;
  }

  public initUi(): void {
    this.ui.init({
      onStart: () => this.start(),
      onStop: () => this.stop(),
      onCancel: () => this.cancelPending(),
      onDismiss: () => this.dismissDecision(),
      onContinueDecision: (token) => this.continueDecision(token),
    });
    this.ui.setActive(false);
  }

  /** Internal start — used by trusted UI and tests. Not page-exposed. */
  public start(): void {
    if (this.state.kind !== "off") return;
    this.sessionEpoch += 1;
    this.requestSequence = 0;
    this.activeDecisionToken = null;
    this.clearPendingRecord();
    this.clearReleaseAuthorization();
    this.state = { kind: "observing" };
    this.ui.setActive(true);
  }

  /** Internal stop — used by trusted UI and tests. Not page-exposed. */
  public stop(): void {
    if (this.state.kind === "off") return;

    // During release stack: defer teardown until native click returns.
    if (this.releaseInProgress) {
      this.stopRequestedAfterRelease = true;
      return;
    }

    this.sessionEpoch += 1;
    this.requestSequence += 1;
    this.activeDecisionToken = null;
    this.clearPendingRecord();
    this.clearReleaseAuthorization();
    this.state = { kind: "off" };
    this.ui.clearDialog();
    this.ui.setActive(false);
  }

  /** Internal cancel — evaluating / preview-ready. Not page-exposed. */
  public cancelPending(): void {
    if (this.state.kind !== "evaluating" && this.state.kind !== "preview-ready") {
      return;
    }
    this.requestSequence += 1;
    this.activeDecisionToken = null;
    this.clearPendingRecord();
    this.clearReleaseAuthorization();
    this.state = { kind: "observing" };
    this.ui.clearDialog();
  }

  /** Internal dismiss — abstention or stale. */
  public dismissDecision(): void {
    if (this.state.kind !== "abstention" && this.state.kind !== "stale") return;
    this.requestSequence += 1;
    this.activeDecisionToken = null;
    this.clearPendingRecord();
    this.clearReleaseAuthorization();
    this.state = { kind: "observing" };
    this.ui.clearDialog();
  }

  /** @deprecated Use dismissDecision — kept for Sprint 2 call sites. */
  public dismissAbstention(): void {
    this.dismissDecision();
  }

  /**
   * Test seam: begin pending evaluation as if a trusted exact interception
   * already cancelled the event. Does not call preventDefault.
   */
  public beginPendingFromCandidate(
    button: HTMLButtonElement,
    observation: BrowserObservation,
  ): string | null {
    if (this.state.kind !== "observing" || this.pending) {
      return null;
    }
    return this.registerPendingAndEvaluate(button, observation);
  }

  /**
   * Private Continue path bound to an exact decision token.
   * Trusted UI supplies the token captured when the preview was rendered.
   * Token mismatch is inert and does not disturb a different current pending B.
   */
  public continueDecision(token: ContinueDecisionToken): void {
    // Obsolete Continue A must never disturb a different valid pending B.
    if (this.state.kind !== "preview-ready") {
      return;
    }
    if (this.releaseInProgress || this.armedContinuation) {
      return;
    }

    const pending = this.pending;
    if (!pending || !pending.decisionToken || !pending.context || !pending.assessment) {
      return;
    }
    if (!continueDecisionTokensEqual(token, pending.decisionToken)) {
      return;
    }
    if (this.activeDecisionToken && !continueDecisionTokensEqual(token, this.activeDecisionToken)) {
      return;
    }
    if (token.pendingId !== pending.pendingId) return;
    if (token.sessionEpoch !== this.sessionEpoch) return;
    if (token.requestSequence !== pending.requestSequence) return;
    if (token.sessionEpoch !== pending.sessionEpoch) return;

    if (typeof window === "undefined" || typeof document === "undefined") {
      this.enterStale();
      return;
    }

    if (!pending.contextFingerprint || !pending.assessmentFingerprint) {
      this.enterStale();
      return;
    }

    // Leave preview-ready immediately so duplicate Continue cannot re-enter.
    this.state = { kind: "continuing" };

    // ALL page-callback-triggering UI work BEFORE final revalidation (H3).
    this.ui.beginContinuing();

    const ok = revalidatePendingForContinue({
      pendingId: pending.pendingId,
      sessionEpoch: pending.sessionEpoch,
      requestSequence: pending.requestSequence,
      element: pending.element,
      observation: pending.observation,
      context: pending.context,
      assessment: pending.assessment,
      retainedContextFingerprint: pending.contextFingerprint,
      retainedAssessmentFingerprint: pending.assessmentFingerprint,
      controllerSessionEpoch: this.sessionEpoch,
      controllerRequestSequence: this.requestSequence,
      releaseInProgress: this.releaseInProgress,
      hasArmedContinuation: this.armedContinuation !== null,
      adapterEngine: this.adapterEngine,
      location: window.location,
      ownerDocument: document,
    });

    if (!ok) {
      this.enterStale();
      return;
    }

    // FINAL validation succeeded — only private assignments + native click.
    const element = pending.element;
    this.releaseGeneration += 1;
    const generation = this.releaseGeneration;

    this.releaseInProgress = true;
    this.authorizedReleasedEvent = null;
    this.armedContinuation = {
      pendingId: pending.pendingId,
      element,
      sessionEpoch: pending.sessionEpoch,
      requestSequence: pending.requestSequence,
      releaseGeneration: generation,
      consumed: false,
    };

    try {
      this.nativeButtonClick(element);
    } catch {
      // Errors handled by finally — no secret leakage into UI.
    } finally {
      this.finishReleaseCleanup();
    }
  }

  /**
   * Test seam: Continue using the currently active decision token.
   * Prefer continueDecision(token) for explicit isolation tests.
   */
  public continuePendingSyntheticRepositoryAction(): void {
    const token = this.activeDecisionToken ?? this.pending?.decisionToken;
    if (!token) return;
    this.continueDecision(token);
  }

  /** Test seam: current active Continue decision token. */
  public getActiveDecisionToken(): ContinueDecisionToken | null {
    return this.activeDecisionToken;
  }

  /**
   * Test seam: desync releaseGeneration from the armed continuation so window
   * authorization must reject (Sprint 3A generation identity).
   */
  public testDesyncArmedReleaseGeneration(): void {
    this.releaseGeneration += 1;
  }

  public handleCaptureClick = (event: MouseEvent): void => {
    // Continuing: with releaseInProgress — one-shot authorize; otherwise preflight block.
    if (this.state.kind === "continuing") {
      if (this.releaseInProgress) {
        if (this.tryAuthorizeReleaseEvent(event)) {
          return;
        }
      }
      if (
        this.pending &&
        eventTargetsPendingElement(event, this.pending.element, this.pendingMatchOptions)
      ) {
        blockPendingActivationEvent(event);
        return;
      }
      if (typeof window !== "undefined") {
        const secondary = resolveExactFc006SupportedCandidate(event.target, window.location);
        if (secondary) {
          blockPendingActivationEvent(event);
        }
      }
      return;
    }

    // 1. Window pending fast path (exact target or ≤4 hops). No composedPath.
    if (
      this.pending &&
      eventTargetsPendingElement(event, this.pending.element, this.pendingMatchOptions)
    ) {
      blockPendingActivationEvent(event);
      return;
    }

    // 2. Secondary exact protected actions while a decision is open.
    if (
      this.pending &&
      (this.state.kind === "evaluating" ||
        this.state.kind === "preview-ready" ||
        this.state.kind === "abstention" ||
        this.state.kind === "stale")
    ) {
      if (typeof window !== "undefined") {
        const secondary = resolveExactFc006SupportedCandidate(event.target, window.location);
        if (secondary) {
          blockPendingActivationEvent(event);
        }
      }
      return;
    }

    // 3. New previews only while observing — still requires trusted/cancelable/etc.
    if (!passesNewPreviewEventGates(event, this.state.kind)) {
      return;
    }

    if (typeof window === "undefined") return;

    const candidate = resolveExactFc006SupportedCandidate(event.target, window.location);
    if (!candidate) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    this.registerPendingAndEvaluate(candidate.button, candidate.observation);
  };

  /**
   * Window capture: consume one-shot authorization for the exact pending target
   * BEFORE target/bubble page handlers. Retains exact Event object identity.
   */
  private tryAuthorizeReleaseEvent(event: Event): boolean {
    const armed = this.armedContinuation;
    const pending = this.pending;
    if (!armed || !pending || armed.consumed) {
      return false;
    }
    if (armed.pendingId !== pending.pendingId) return false;
    if (armed.sessionEpoch !== pending.sessionEpoch) return false;
    if (armed.requestSequence !== pending.requestSequence) return false;
    if (armed.releaseGeneration !== this.releaseGeneration) return false;
    if (armed.element !== pending.element) return false;
    if (event.target !== pending.element) return false;

    armed.consumed = true;
    this.authorizedReleasedEvent = event;
    return true;
  }

  private clearPendingRecord(): void {
    this.removePendingElementGuard();
    this.pending = null;
  }

  private clearReleaseAuthorization(): void {
    this.armedContinuation = null;
    this.authorizedReleasedEvent = null;
    this.releaseInProgress = false;
    this.stopRequestedAfterRelease = false;
  }

  private installPendingElementGuard(element: HTMLButtonElement): void {
    this.removePendingElementGuard();
    if (typeof element.addEventListener !== "function") {
      return;
    }
    const guard = (event: Event): void => {
      this.pendingGuardInvocations += 1;
      if (this.shouldAllowAuthorizedReleaseThroughGuard(event)) {
        return;
      }
      blockPendingActivationEvent(event);
    };
    element.addEventListener("click", guard, true);
    this.pendingElementGuard = guard;
    this.pendingGuardElement = element;
  }

  private shouldAllowAuthorizedReleaseThroughGuard(event: Event): boolean {
    if (!this.releaseInProgress) return false;
    if (this.authorizedReleasedEvent === null) return false;
    if (event !== this.authorizedReleasedEvent) return false;
    const armed = this.armedContinuation;
    const pending = this.pending;
    if (!armed || !pending || !armed.consumed) return false;
    if (armed.pendingId !== pending.pendingId) return false;
    if (armed.releaseGeneration !== this.releaseGeneration) return false;
    return true;
  }

  private removePendingElementGuard(): void {
    if (this.pendingGuardElement && this.pendingElementGuard) {
      if (typeof this.pendingGuardElement.removeEventListener === "function") {
        this.pendingGuardElement.removeEventListener("click", this.pendingElementGuard, true);
      }
    }
    this.pendingElementGuard = null;
    this.pendingGuardElement = null;
  }

  private enterStale(): void {
    // Keep pending + guard so the original action remains blocked.
    this.activeDecisionToken = null;
    this.clearReleaseAuthorization();
    this.state = { kind: "stale" };
    this.ui.showStale();
  }

  private finishReleaseCleanup(): void {
    const consumed = this.armedContinuation?.consumed === true;
    const stopRequested = this.stopRequestedAfterRelease;

    this.armedContinuation = null;
    this.authorizedReleasedEvent = null;
    this.releaseInProgress = false;
    this.stopRequestedAfterRelease = false;
    this.activeDecisionToken = null;

    if (stopRequested) {
      this.sessionEpoch += 1;
      this.requestSequence += 1;
      this.clearPendingRecord();
      this.state = { kind: "off" };
      this.ui.clearDialog();
      this.ui.setActive(false);
      return;
    }

    if (consumed) {
      this.clearPendingRecord();
      this.state = { kind: "observing" };
      this.ui.clearDialog();
      return;
    }

    // Native click returned without a consumed continuation event — fail closed.
    this.enterStale();
  }

  private registerPendingAndEvaluate(
    button: HTMLButtonElement,
    observation: BrowserObservation,
  ): string {
    this.requestSequence += 1;
    const pendingId = generateEntityId<"Fc006PendingId">("pend");
    const sessionEpoch = this.sessionEpoch;
    const requestSequence = this.requestSequence;

    this.clearPendingRecord();
    this.clearReleaseAuthorization();
    this.pending = {
      pendingId,
      element: button,
      observation,
      sessionEpoch,
      requestSequence,
    };
    this.installPendingElementGuard(button);
    this.state = { kind: "evaluating" };
    this.ui.showEvaluating();

    void this.evaluator({
      observation,
      pendingId,
      sessionEpoch,
      requestSequence,
    })
      .then((outcome) => {
        this.applyEvaluationOutcome(outcome, pendingId, sessionEpoch, requestSequence);
      })
      .catch(() => {
        this.applyEvaluationOutcome(
          { kind: "abstention" },
          pendingId,
          sessionEpoch,
          requestSequence,
        );
      });

    return pendingId;
  }

  private applyEvaluationOutcome(
    outcome: Fc006EvaluationOutcome,
    pendingId: string,
    sessionEpoch: number,
    requestSequence: number,
  ): void {
    if (
      this.state.kind !== "evaluating" ||
      !this.pending ||
      this.pending.pendingId !== pendingId ||
      this.pending.sessionEpoch !== sessionEpoch ||
      this.pending.requestSequence !== requestSequence ||
      this.sessionEpoch !== sessionEpoch ||
      this.requestSequence !== requestSequence
    ) {
      return;
    }

    if (outcome.kind === "verified") {
      const fingerprints = buildRetainedReleaseFingerprints(
        outcome.context,
        outcome.assessment,
        this.pending.observation,
      );
      if (!fingerprints) {
        this.state = { kind: "abstention" };
        this.ui.showAbstention();
        return;
      }

      this.previewGeneration += 1;
      const decisionToken = createContinueDecisionToken({
        pendingId,
        sessionEpoch,
        requestSequence,
        previewGeneration: this.previewGeneration,
      });

      this.pending.context = outcome.context;
      this.pending.assessment = outcome.assessment;
      this.pending.contextFingerprint = fingerprints.contextFingerprint;
      this.pending.assessmentFingerprint = fingerprints.assessmentFingerprint;
      this.pending.decisionToken = decisionToken;
      this.activeDecisionToken = decisionToken;
      this.state = { kind: "preview-ready" };
      this.ui.showPreview(outcome.preview, decisionToken);
      return;
    }

    this.activeDecisionToken = null;
    this.state = { kind: "abstention" };
    this.ui.showAbstention();
  }

  private async defaultEvaluate(args: {
    readonly observation: BrowserObservation;
    readonly pendingId: string;
    readonly sessionEpoch: number;
    readonly requestSequence: number;
  }): Promise<Fc006EvaluationOutcome> {
    try {
      const adaptOutcome = this.adapterEngine.adapt(args.observation);
      if (adaptOutcome.status !== "matched") {
        return { kind: "abstention" };
      }

      const assessmentResult = await this.consequenceEngine.evaluate(adaptOutcome.context);
      if (!assessmentResult.ok) {
        return { kind: "abstention" };
      }

      const preview = buildPreviewFromAssessment(assessmentResult.value);
      if (!preview) {
        return { kind: "abstention" };
      }

      return {
        kind: "verified",
        context: adaptOutcome.context,
        assessment: assessmentResult.value,
        preview,
      };
    } catch {
      return { kind: "abstention" };
    }
  }
}
