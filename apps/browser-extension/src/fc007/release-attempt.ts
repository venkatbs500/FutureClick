/**
 * FC-007 Sprint 3B — isolated one-shot release (security-hardened).
 *
 * Two-lifetime model (must not collapse):
 *   LIFETIME A — one-shot armed permission (consumed at most once)
 *   LIFETIME B — dispatch-in-progress block-only protection (zero authority)
 *
 * Authoritative interception: early WINDOW capture only.
 * Production authorization requires event.isTrusted === false EXACTLY.
 *
 * NOT wired to production Continue. Tests / dedicated 3B smoke only.
 */

import { type ModalPredicate, defaultMatchesModal } from "./dialog-inventory.js";
import { blockSupportedActivationEvent, eventTargetsBlockButton } from "./interception.js";
import { invokeCapturedNativeClick } from "./native-click-executor.js";
import { ownedPreviewHostInvariantFailure } from "./preview-host.js";
import type { Fc007VerifiedDecision } from "./verified-decision.js";

/** Closed terminal outcomes — no ambiguous booleans alone. */
export type Fc007ReleaseOutcome =
  | "CONSUMED"
  | "NO_AUTHORIZED_EVENT"
  | "INVALIDATED"
  | "INVALIDATED_AFTER_CONSUME"
  | "EXECUTOR_FAILED_BEFORE_CONSUME"
  | "EXECUTOR_FAILED_AFTER_CONSUME"
  | "DOUBLE_ARM_REJECTED"
  | "DECISION_ALREADY_ATTEMPTED"
  | "STALE_TARGET"
  | "NOT_ARMED"
  | "LISTENER_MISSING"
  | "LISTENER_BUSY";

export type Fc007ReleasePermission = "none" | "armed" | "consumed" | "revoked";

export type Fc007ReleasePhase =
  | "NONE"
  | "ARMED"
  | "DISPATCH_ACTIVE"
  | "CONSUMED_DISPATCH_ACTIVE"
  | "ATTEMPT_COMPLETE"
  | "FAILED_NOT_CONSUMED"
  | "INVALIDATED";

export interface Fc007ReleaseReceipt {
  readonly consumed: boolean;
  readonly authorizedEventObserved: boolean;
  readonly invalidationObserved: boolean;
  readonly executorThrew: boolean;
  readonly executorFailurePhase: "before_consume" | "after_consume" | null;
  readonly consumedAtGeneration: number | null;
  readonly attemptId: string | null;
}

export interface Fc007ReleaseCounters {
  attemptsCreated: number;
  arms: number;
  executorCalls: number;
  authorizedEventsObserved: number;
  permissionConsumptions: number;
  nestedEventsObserved: number;
  nestedEventsPrevented: number;
  blockedMatchingEvents: number;
  pagePrimaryHandlers: number;
  pageNestedHandlers: number;
  submitEvents: number;
  cleanupCount: number;
  retries: number;
  fallbacks: number;
  /** Smoke/diagnostic: FutureClick Window capture invocations while attempt active. */
  fcWindowCaptureSeen: number;
}

export type Fc007TestNativeExecutor = (exactButton: HTMLButtonElement) => void;

/**
 * Test-only normalized view for classification unit tests.
 * Production Window listener never uses this — it reads the real Event.
 */
export interface Fc007AuthorizedEventView {
  readonly type: string;
  readonly target: EventTarget | null;
  readonly isTrusted: boolean;
  readonly cancelable: boolean;
  readonly defaultPrevented: boolean;
}

interface ActiveAttempt {
  readonly attemptId: string;
  readonly releaseGeneration: number;
  readonly decision: Fc007VerifiedDecision;
  readonly document: Document;
  readonly finalButton: HTMLButtonElement;
  readonly form: HTMLFormElement;
  readonly modal: HTMLDialogElement;
  readonly ownedHost: HTMLDivElement;
  permission: Fc007ReleasePermission;
  phase: Fc007ReleasePhase;
  dispatchGuardActive: boolean;
  outcome: Fc007ReleaseOutcome | null;
  invalidationObserved: boolean;
  executorThrew: boolean;
  thrownValue: unknown;
  receipt: {
    consumed: boolean;
    authorizedEventObserved: boolean;
    invalidationObserved: boolean;
    executorThrew: boolean;
    executorFailurePhase: "before_consume" | "after_consume" | null;
    consumedAtGeneration: number | null;
    attemptId: string | null;
  };
  /** Diagnostic only — NOT used for security early-return. */
  lastAuthorizedEvent: Event | null;
}

function decisionKey(d: Fc007VerifiedDecision): string {
  return `${d.decisionId}:${d.decisionGeneration}`;
}

function emptyCounters(): Fc007ReleaseCounters {
  return {
    attemptsCreated: 0,
    arms: 0,
    executorCalls: 0,
    authorizedEventsObserved: 0,
    permissionConsumptions: 0,
    nestedEventsObserved: 0,
    nestedEventsPrevented: 0,
    blockedMatchingEvents: 0,
    pagePrimaryHandlers: 0,
    pageNestedHandlers: 0,
    submitEvents: 0,
    cleanupCount: 0,
    retries: 0,
    fallbacks: 0,
    fcWindowCaptureSeen: 0,
  };
}

function emptyReceipt(): Fc007ReleaseReceipt {
  return {
    consumed: false,
    authorizedEventObserved: false,
    invalidationObserved: false,
    executorThrew: false,
    executorFailurePhase: null,
    consumedAtGeneration: null,
    attemptId: null,
  };
}

/**
 * Pure classification against an explicit view (TEST-ONLY / shared logic).
 * Production Window path builds the view from the real Event with strict reads.
 */
export function isAuthorizedReleaseEventView(
  view: Fc007AuthorizedEventView,
  exactButton: HTMLButtonElement,
  permissionArmed: boolean,
  alreadyConsumed: boolean,
): boolean {
  if (!permissionArmed || alreadyConsumed) return false;
  if (view.type !== "click") return false;
  if (view.target !== exactButton) return false;
  // STRICT: must be exactly false — undefined/missing/true all reject.
  if (view.isTrusted === false) {
    // continue
  } else {
    return false;
  }
  if (view.cancelable === true) {
    // continue
  } else {
    return false;
  }
  if (view.defaultPrevented === false) {
    // continue
  } else {
    return false;
  }
  return true;
}

/**
 * Test-only: synthesize a cancelable click with an explicit isTrusted value.
 * Production never uses this — Chrome native click already yields isTrusted === false.
 */
export function createClickEventWithTrustForTest(
  target: EventTarget,
  isTrusted: boolean,
  options?: { readonly cancelable?: boolean; readonly preventDefaultBeforeDispatch?: boolean },
): MouseEvent {
  const cancelable = options?.cancelable !== false;
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable,
    composed: true,
  });
  Object.defineProperty(event, "isTrusted", {
    configurable: true,
    enumerable: true,
    value: isTrusted,
  });
  Object.defineProperty(event, "target", {
    configurable: true,
    enumerable: true,
    value: target,
  });
  if (options?.preventDefaultBeforeDispatch === true && cancelable) {
    event.preventDefault();
  }
  return event;
}

/**
 * Isolated Sprint-3B release component.
 * Install Window capture at document_start (smoke bootstrap) before page handlers.
 */
export class Fc007IsolatedReleaseComponent {
  private attempt: ActiveAttempt | null = null;
  private releaseGenerationSeq = 0;
  private attemptSeq = 0;
  private readonly usedDecisionKeys = new Set<string>();
  private listener: ((event: Event) => void) | null = null;
  private listenerWindow: Window | null = null;
  /** Authoritative capture target: Window when available; Document for fixture docs without browsing context. */
  private listenerTarget: EventTarget | null = null;
  private listenerDoc: Document | null = null;
  private uninstallRequested = false;
  private testExecutor: Fc007TestNativeExecutor | null = null;
  private matchesModal: ModalPredicate = defaultMatchesModal;
  private readonly counters: Fc007ReleaseCounters = emptyCounters();
  /** Smoke/diagnostic sequence counter for Window-order proof (non-authority). */
  private fcWindowSequence = 0;
  private lastFcWindowSequenceAtConsume = 0;

  /**
   * Install early capture listener.
   * Production / Chrome: WINDOW capture at document_start.
   * Fixture documents without defaultView (happy-dom createHTMLDocument): Document capture
   * is the event-path root — still a single authoritative listener, not Document+Window+button.
   */
  install(docOrWin: Document | Window, options?: { readonly matchesModal?: ModalPredicate }): void {
    if (this.attempt?.dispatchGuardActive) {
      throw new Error("FC007_INSTALL_DURING_DISPATCH");
    }
    if (options?.matchesModal) {
      this.matchesModal = options.matchesModal;
    }
    let doc: Document;
    let target: EventTarget;
    let win: Window | null = null;

    const asNode = docOrWin as unknown as { nodeType?: number; defaultView?: Window | null };
    if (asNode && asNode.nodeType === 9) {
      doc = docOrWin as Document;
      const dv = asNode.defaultView ?? null;
      if (dv && typeof dv.addEventListener === "function") {
        win = dv;
        target = dv;
      } else {
        // Orphan fixture document: Document is the top of the dispatch path.
        target = doc;
      }
    } else if (
      docOrWin &&
      typeof (docOrWin as Window).addEventListener === "function" &&
      (docOrWin as Window).document
    ) {
      win = docOrWin as Window;
      doc = win.document;
      target = win;
    } else {
      throw new Error("FC007_INSTALL_BAD_TARGET");
    }

    if (this.listener && this.listenerTarget) {
      this.listenerTarget.removeEventListener("click", this.listener, true);
    }
    const listener = (event: Event): void => {
      this.onWindowCapture(event);
    };
    this.listener = listener;
    this.listenerWindow = win;
    this.listenerTarget = target;
    this.listenerDoc = doc;
    this.uninstallRequested = false;
    target.addEventListener("click", listener, true);
  }

  /**
   * Request uninstall. If dispatch is active, defer physical removal until unwind.
   */
  uninstall(): void {
    if (this.attempt?.dispatchGuardActive) {
      this.uninstallRequested = true;
      return;
    }
    this.physicalUninstall();
  }

  private physicalUninstall(): void {
    if (this.listener && this.listenerTarget) {
      this.listenerTarget.removeEventListener("click", this.listener, true);
    }
    this.listener = null;
    this.listenerWindow = null;
    this.listenerTarget = null;
    this.listenerDoc = null;
    this.uninstallRequested = false;
  }

  isListenerInstalled(): boolean {
    return this.listener !== null && this.listenerTarget !== null;
  }

  /** True when authoritative target is Window (production/Chrome). */
  isWindowCaptureInstalled(): boolean {
    return this.listenerWindow !== null && this.listenerTarget === this.listenerWindow;
  }

  wasUninstallDeferred(): boolean {
    return this.uninstallRequested === true;
  }

  setTestExecutorForTest(executor: Fc007TestNativeExecutor | null): void {
    if (this.attempt?.phase === "ARMED" || this.attempt?.dispatchGuardActive) {
      throw new Error("FC007_TEST_EXECUTOR_AFTER_ARM");
    }
    this.testExecutor = executor;
  }

  getCounters(): Readonly<Fc007ReleaseCounters> {
    return { ...this.counters };
  }

  getPhase(): Fc007ReleasePhase {
    return this.attempt?.phase ?? "NONE";
  }

  getPermission(): Fc007ReleasePermission {
    return this.attempt?.permission ?? "none";
  }

  getOutcome(): Fc007ReleaseOutcome | null {
    return this.attempt?.outcome ?? null;
  }

  getReceipt(): Fc007ReleaseReceipt {
    const r = this.attempt?.receipt;
    if (!r) return emptyReceipt();
    return {
      consumed: r.consumed === true,
      authorizedEventObserved: r.authorizedEventObserved === true,
      invalidationObserved: r.invalidationObserved === true,
      executorThrew: r.executorThrew === true,
      executorFailurePhase: r.executorFailurePhase,
      consumedAtGeneration: r.consumedAtGeneration,
      attemptId: r.attemptId,
    };
  }

  isDispatchGuardActive(): boolean {
    return this.attempt?.dispatchGuardActive === true;
  }

  getActiveReleaseGeneration(): number | null {
    return this.attempt?.releaseGeneration ?? null;
  }

  getAttemptId(): string | null {
    return this.attempt?.attemptId ?? null;
  }

  getFcWindowSequenceAtConsume(): number {
    return this.lastFcWindowSequenceAtConsume;
  }

  getFcWindowSequence(): number {
    return this.fcWindowSequence;
  }

  /**
   * Production-intended atomic entry for Sprint 3C.
   * Synchronously: currentness → arm → guard → Reflect.apply → finalize.
   * No caller gap between arm and native invoke.
   */
  releaseOnce(decision: Fc007VerifiedDecision): {
    readonly outcome: Fc007ReleaseOutcome;
    readonly receipt: Fc007ReleaseReceipt;
    readonly reason?: string;
  } {
    const armed = this.armInternal(decision);
    if (armed.status !== "ok") {
      return {
        outcome: armed.outcome,
        receipt: this.getReceipt(),
        reason: armed.reason,
      };
    }
    return this.executeArmedInternal();
  }

  /**
   * Test-only low-level arm. Production-intended path is releaseOnce().
   * Must not be used with a caller-controlled gap before execute in Sprint 3C.
   */
  armForTest(decision: Fc007VerifiedDecision):
    | { readonly status: "ok"; readonly attemptId: string; readonly releaseGeneration: number }
    | {
        readonly status: "invalid";
        readonly outcome: Fc007ReleaseOutcome;
        readonly reason: string;
      } {
    return this.armInternal(decision);
  }

  /** @deprecated Test-only alias — prefer releaseOnce() or armForTest(). */
  arm(decision: Fc007VerifiedDecision): ReturnType<Fc007IsolatedReleaseComponent["armForTest"]> {
    return this.armForTest(decision);
  }

  /** Test-only low-level execute after armForTest. Prefer releaseOnce(). */
  executeArmedForTest(): {
    readonly outcome: Fc007ReleaseOutcome;
    readonly receipt: Fc007ReleaseReceipt;
  } {
    return this.executeArmedInternal();
  }

  /** @deprecated Test-only alias — prefer releaseOnce() or executeArmedForTest(). */
  executeArmed(): ReturnType<Fc007IsolatedReleaseComponent["executeArmedForTest"]> {
    return this.executeArmedForTest();
  }

  invalidate(reason = "INVALIDATED"): Fc007ReleaseOutcome {
    void reason;
    const a = this.attempt;
    if (!a || this.isTerminal(a.phase)) {
      return a?.outcome ?? "INVALIDATED";
    }
    a.invalidationObserved = true;
    a.receipt.invalidationObserved = true;
    if (a.permission === "armed") {
      a.permission = "revoked";
    }
    if (a.dispatchGuardActive) {
      // Do not overwrite consumption history; finalize will derive outcome.
      return a.receipt.consumed ? "INVALIDATED_AFTER_CONSUME" : "INVALIDATED";
    }
    a.phase = "INVALIDATED";
    a.outcome = a.receipt.consumed ? "INVALIDATED_AFTER_CONSUME" : "INVALIDATED";
    this.counters.cleanupCount += 1;
    return a.outcome;
  }

  notePagePrimaryHandlerForTest(): void {
    this.counters.pagePrimaryHandlers += 1;
  }

  notePageNestedHandlerForTest(): void {
    this.counters.pageNestedHandlers += 1;
  }

  noteSubmitForTest(): void {
    this.counters.submitEvents += 1;
  }

  /**
   * Test-only: feed a real or synthetic Event through Window capture logic.
   * Used for classification / nested probes; does NOT skip security checks.
   * No Event-identity early-return — every call is fully evaluated.
   */
  processEventForTest(event: Event): void {
    this.onWindowCapture(event);
  }

  /**
   * Test-only classification against an explicit view (missing isTrusted etc.).
   */
  classifyAuthorizedViewForTest(view: Fc007AuthorizedEventView): { readonly authorized: boolean } {
    const a = this.attempt;
    if (!a) return { authorized: false };
    return {
      authorized: isAuthorizedReleaseEventView(
        view,
        a.finalButton,
        a.permission === "armed",
        a.receipt.consumed,
      ),
    };
  }

  private armInternal(decision: Fc007VerifiedDecision):
    | { readonly status: "ok"; readonly attemptId: string; readonly releaseGeneration: number }
    | {
        readonly status: "invalid";
        readonly outcome: Fc007ReleaseOutcome;
        readonly reason: string;
      } {
    if (!this.listener || !this.listenerTarget || !this.listenerDoc) {
      return { status: "invalid", outcome: "LISTENER_MISSING", reason: "LISTENER_MISSING" };
    }
    if (this.attempt && !this.isTerminal(this.attempt.phase)) {
      return { status: "invalid", outcome: "DOUBLE_ARM_REJECTED", reason: "DOUBLE_ARM" };
    }

    const key = decisionKey(decision);
    if (this.usedDecisionKeys.has(key)) {
      return {
        status: "invalid",
        outcome: "DECISION_ALREADY_ATTEMPTED",
        reason: "DECISION_ALREADY_ATTEMPTED",
      };
    }

    // ALL currentness checks BEFORE permission becomes armed.
    const stale = this.validateExactAuthorityCurrentness(decision);
    if (stale) {
      return { status: "invalid", outcome: "STALE_TARGET", reason: stale };
    }

    this.releaseGenerationSeq += 1;
    this.attemptSeq += 1;
    const releaseGeneration = this.releaseGenerationSeq;
    const attemptId = `fc007-release-${this.attemptSeq}`;

    this.attempt = {
      attemptId,
      releaseGeneration,
      decision,
      document: decision.document,
      finalButton: decision.finalButton,
      form: decision.form,
      modal: decision.modal,
      ownedHost: decision.ownedHost,
      permission: "armed",
      phase: "ARMED",
      dispatchGuardActive: false,
      outcome: null,
      invalidationObserved: false,
      executorThrew: false,
      thrownValue: undefined,
      receipt: {
        consumed: false,
        authorizedEventObserved: false,
        invalidationObserved: false,
        executorThrew: false,
        executorFailurePhase: null,
        consumedAtGeneration: null,
        attemptId: null,
      },
      lastAuthorizedEvent: null,
    };
    this.usedDecisionKeys.add(key);
    this.counters.attemptsCreated += 1;
    this.counters.arms += 1;
    // Listener already installed — no addEventListener after arm.
    return { status: "ok", attemptId, releaseGeneration };
  }

  private executeArmedInternal(): {
    readonly outcome: Fc007ReleaseOutcome;
    readonly receipt: Fc007ReleaseReceipt;
  } {
    const a = this.attempt;
    if (!a || a.phase !== "ARMED" || a.permission !== "armed") {
      return { outcome: "NOT_ARMED", receipt: this.getReceipt() };
    }
    if (!this.listener || !this.listenerTarget) {
      a.permission = "revoked";
      a.phase = "FAILED_NOT_CONSUMED";
      a.outcome = "LISTENER_MISSING";
      return { outcome: "LISTENER_MISSING", receipt: this.getReceipt() };
    }

    // --- CRITICAL SECTION after arm: private assignments + Reflect.apply only ---
    const btn = a.finalButton;
    a.dispatchGuardActive = true;
    a.phase = "DISPATCH_ACTIVE";

    let executorThrew = false;
    let thrownValue: unknown;
    try {
      this.counters.executorCalls += 1;
      const exec = this.testExecutor;
      if (exec) {
        exec(btn);
      } else {
        invokeCapturedNativeClick(btn);
      }
    } catch (value: unknown) {
      executorThrew = true;
      thrownValue = value;
    } finally {
      a.executorThrew = executorThrew;
      a.thrownValue = thrownValue;
      a.receipt.executorThrew = executorThrew;
      if (executorThrew) {
        a.receipt.executorFailurePhase = a.receipt.consumed ? "after_consume" : "before_consume";
      }
      a.outcome = this.deriveOutcome(a);
      if (a.receipt.consumed) {
        a.permission = "consumed";
        a.phase =
          a.outcome === "INVALIDATED_AFTER_CONSUME" || a.outcome === "EXECUTOR_FAILED_AFTER_CONSUME"
            ? "ATTEMPT_COMPLETE"
            : "ATTEMPT_COMPLETE";
      } else if (a.outcome === "INVALIDATED") {
        a.permission = "revoked";
        a.phase = "INVALIDATED";
      } else {
        a.permission = "revoked";
        a.phase = "FAILED_NOT_CONSUMED";
      }
      a.dispatchGuardActive = false;
      this.counters.cleanupCount += 1;
      if (this.uninstallRequested) {
        this.physicalUninstall();
      }
    }

    return {
      outcome: a.outcome ?? "NO_AUTHORIZED_EVENT",
      receipt: this.getReceipt(),
    };
  }

  /**
   * Outcome precedence (documented):
   * 1. executorThrew → BEFORE/AFTER_CONSUME
   * 2. else invalidationObserved → INVALIDATED / INVALIDATED_AFTER_CONSUME
   * 3. else consumed → CONSUMED
   * 4. else NO_AUTHORIZED_EVENT
   */
  private deriveOutcome(a: ActiveAttempt): Fc007ReleaseOutcome {
    if (a.executorThrew || a.receipt.executorThrew) {
      return a.receipt.consumed
        ? "EXECUTOR_FAILED_AFTER_CONSUME"
        : "EXECUTOR_FAILED_BEFORE_CONSUME";
    }
    if (a.invalidationObserved || a.receipt.invalidationObserved) {
      return a.receipt.consumed ? "INVALIDATED_AFTER_CONSUME" : "INVALIDATED";
    }
    if (a.receipt.consumed) return "CONSUMED";
    return "NO_AUTHORIZED_EVENT";
  }

  private isTerminal(phase: Fc007ReleasePhase): boolean {
    return (
      phase === "ATTEMPT_COMPLETE" ||
      phase === "FAILED_NOT_CONSUMED" ||
      phase === "INVALIDATED" ||
      phase === "NONE"
    );
  }

  /**
   * Exact authority currentness — before arm. No selector recovery.
   */
  private validateExactAuthorityCurrentness(decision: Fc007VerifiedDecision): string | null {
    if (!(decision.finalButton instanceof HTMLButtonElement)) return "FINAL_BUTTON";
    if (!(decision.form instanceof HTMLFormElement)) return "FORM";
    if (!(decision.modal instanceof HTMLDialogElement)) return "MODAL";
    if (!(decision.ownedHost instanceof HTMLDivElement)) return "HOST";

    const doc = decision.document;
    if (!doc || typeof doc !== "object" || (doc as Node).nodeType !== 9) {
      return "DOCUMENT";
    }
    if (this.listenerDoc && doc !== this.listenerDoc) return "DOCUMENT_MISMATCH";

    if (decision.finalButton.ownerDocument !== doc) return "BUTTON_DOC";
    if (decision.form.ownerDocument !== doc) return "FORM_DOC";
    if (decision.modal.ownerDocument !== doc) return "MODAL_DOC";
    if (decision.ownedHost.ownerDocument !== doc) return "HOST_DOC";

    if (!decision.finalButton.isConnected) return "BUTTON_DISCONNECTED";
    if (!decision.form.isConnected) return "FORM_DISCONNECTED";
    if (!decision.modal.isConnected) return "MODAL_DISCONNECTED";
    if (!decision.ownedHost.isConnected) return "HOST_DISCONNECTED";

    // button.form must equal retained form
    if (decision.finalButton.form !== decision.form) return "BUTTON_FORM_MISMATCH";

    // Modal must be open / actual modal (captured matcher — no page-overridden instance)
    if (decision.modal.open !== true) return "MODAL_NOT_OPEN";
    try {
      if (this.matchesModal(decision.modal) !== true) return "MODAL_NOT_ACTUAL";
    } catch {
      return "MODAL_PSEUDO_UNSUPPORTED";
    }

    // Form and button must be inside modal (safe containment via eventTargetsBlockButton helpers)
    if (!this.safeContains(decision.modal, decision.form)) return "FORM_NOT_IN_MODAL";
    if (!this.safeContains(decision.modal, decision.finalButton)) return "BUTTON_NOT_IN_MODAL";
    if (!this.safeContains(decision.form, decision.finalButton)) {
      // Button may be associated via form= attribute while outside form element;
      // still require button.form === retained form (checked above) and modal contains button.
    }

    // Host ownership invariant (Sprint-3A): parentElement === modal
    const hostFail = ownedPreviewHostInvariantFailure(decision.ownedHost, decision.modal, doc);
    if (hostFail) return hostFail;

    return null;
  }

  private safeContains(root: Element, other: Node): boolean {
    const nativeContains =
      typeof Node !== "undefined" && typeof Node.prototype.contains === "function"
        ? Node.prototype.contains
        : null;
    if (nativeContains) {
      try {
        return Reflect.apply(nativeContains, root, [other]) === true;
      } catch {
        return false;
      }
    }
    let cur: Element | null =
      other.nodeType === Node.ELEMENT_NODE ? (other as Element) : (other as Node).parentElement;
    while (cur) {
      if (cur === root) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  private onWindowCapture(event: Event): void {
    // NO Event-identity early-return — every dispatch is fully evaluated.
    const a = this.attempt;
    if (!a) return;
    if (this.isTerminal(a.phase) && !a.dispatchGuardActive) return;

    const protectionActive =
      a.permission === "armed" ||
      a.permission === "consumed" ||
      a.dispatchGuardActive === true ||
      a.phase === "ARMED" ||
      a.phase === "DISPATCH_ACTIVE" ||
      a.phase === "CONSUMED_DISPATCH_ACTIVE";

    if (!protectionActive) return;

    this.counters.fcWindowCaptureSeen += 1;
    this.fcWindowSequence += 1;

    // FIRST: authorized primary while permission still armed?
    if (a.permission === "armed" && this.isAuthorizedGeneratedEvent(event, a)) {
      a.receipt.authorizedEventObserved = true;
      a.receipt.consumed = true;
      a.receipt.consumedAtGeneration = a.releaseGeneration;
      a.receipt.attemptId = a.attemptId;
      a.permission = "consumed";
      a.phase = "CONSUMED_DISPATCH_ACTIVE";
      a.lastAuthorizedEvent = event; // diagnostic only
      this.counters.authorizedEventsObserved += 1;
      this.counters.permissionConsumptions += 1;
      this.lastFcWindowSequenceAtConsume = this.fcWindowSequence;
      // ALLOW — do not preventDefault / stop.
      return;
    }

    // Otherwise matching protected target → BLOCK (including reused / pre-prevented).
    if (eventTargetsBlockButton(event, a.finalButton)) {
      if (a.dispatchGuardActive || a.permission === "armed" || a.permission === "consumed") {
        this.counters.nestedEventsObserved += 1;
        this.counters.blockedMatchingEvents += 1;
        blockSupportedActivationEvent(event);
        if (event.defaultPrevented === true) {
          this.counters.nestedEventsPrevented += 1;
        }
      }
    }
  }

  /**
   * Production authorization — reads REAL Event fields.
   * Requires isTrusted === false EXACTLY (undefined/missing/true all fail).
   * No happy-dom accommodation. No missing-property soft-fail.
   */
  private isAuthorizedGeneratedEvent(event: Event, a: ActiveAttempt): boolean {
    if (a.permission !== "armed" || a.receipt.consumed) return false;
    if (event.type !== "click") return false;
    if (event.target !== a.finalButton) return false;
    // STRICT equality — undefined / missing / true all fail.
    if (event.isTrusted === false) {
      // ok
    } else {
      return false;
    }
    if (event.cancelable === true) {
      // ok
    } else {
      return false;
    }
    if (event.defaultPrevented === false) {
      // ok
    } else {
      return false;
    }
    return true;
  }
}
