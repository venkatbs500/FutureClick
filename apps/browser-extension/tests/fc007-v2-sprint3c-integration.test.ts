/**
 * FC-007 Sprint 3C — production Continue → one-shot release integration tests.
 *
 * Happy-dom cannot emit isTrusted===false via native .click(); tests set the
 * approved Sprint-3B component test executor via getReleaseComponentForTest().
 * Production controller options expose no executor/callback injection.
 * Chrome smoke proves real native trust on the normal production bundle.
 */

import { describe, expect, it, vi } from "vitest";
import * as continueValidator from "../src/fc007/continue-validator.js";
import { validateContinueSameDecision } from "../src/fc007/continue-validator.js";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import {
  createClickEventWithTrustForTest,
  Fc007IsolatedReleaseComponent,
} from "../src/fc007/release-attempt.js";
import type { Fc007VerifiedDecision } from "../src/fc007/verified-decision.js";
import { createFc007V2SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

function trustAll(event: Event): boolean {
  return event.type === "click" || event.type === "keydown";
}

function authorizedDispatchExecutor(btn: HTMLButtonElement): void {
  btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
}

function createCancelableClick(target: EventTarget): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, "target", { configurable: true, value: target });
  return event;
}

function armHappyDomExecutor(controller: Fc007PassiveController): void {
  controller.getReleaseComponentForTest().setTestExecutorForTest(authorizedDispatchExecutor);
}

async function reachVerified(options?: {
  readonly releaseComponent?: Fc007IsolatedReleaseComponent;
}): Promise<{
  readonly controller: Fc007PassiveController;
  readonly document: Document;
  readonly finalButton: HTMLButtonElement;
  readonly form: HTMLFormElement;
  readonly modal: HTMLDialogElement;
}> {
  const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
  const controller = new Fc007PassiveController({
    document: doc,
    location,
    requireTopFrame: false,
    recognitionVersion: "v2",
    matchesModal: testMatchesModal,
    evaluateOnRecognize: true,
    trustClickForTest: trustAll,
    ...(options?.releaseComponent ? { releaseComponent: options.releaseComponent } : {}),
  });
  controller.start();
  await controller.attemptFullRecognition();
  const finalButton = controller.getRetainedFinalButton();
  expect(finalButton).toBeInstanceOf(HTMLButtonElement);
  if (!(finalButton instanceof HTMLButtonElement)) throw new Error("no final");
  const form = doc.getElementById("visibility-form");
  const modal = doc.getElementById("visibility-dialog");
  if (!(form instanceof HTMLFormElement)) throw new Error("no form");
  if (!(modal instanceof HTMLDialogElement)) throw new Error("no modal");
  form.addEventListener("submit", (e) => e.preventDefault());
  controller.handleCaptureClickForTest(createCancelableClick(finalButton));
  await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
  armHappyDomExecutor(controller);
  return { controller, document: doc, finalButton, form, modal };
}

function assertOneShotConsumed(controller: Fc007PassiveController): void {
  const d = controller.getSprint3cDiagnosticsForTest();
  expect(d.acceptedContinueAttempts).toBe(1);
  expect(d.continueValidationPass).toBe(1);
  expect(d.releaseCalls).toBe(1);
  expect(d.armCount).toBe(1);
  expect(d.executorCount).toBe(1);
  expect(d.authorizedReleaseCount).toBe(1);
  expect(d.consumptions).toBe(1);
  expect(d.retries).toBe(0);
  expect(d.fallbacks).toBe(0);
  expect(d.terminalOutcome).toBe("CONSUMED");
}

function assertZeroRelease(controller: Fc007PassiveController): void {
  const d = controller.getSprint3cDiagnosticsForTest();
  expect(d.armCount).toBe(0);
  expect(d.executorCount).toBe(0);
  expect(d.authorizedReleaseCount).toBe(0);
  expect(d.releaseCalls === 0 || d.consumptions === 0).toBe(true);
}

describe("FC-007 Sprint 3C production Continue → release", () => {
  it("installs production release component once at start", async () => {
    const { controller } = await reachVerified();
    expect(controller.isReleaseListenerInstalledForTest()).toBe(true);
    expect(controller.getReleaseListenerInstallCountForTest()).toBe(1);
    controller.stop();
    expect(controller.isReleaseListenerInstalledForTest()).toBe(false);
  });

  it("Document fallback release listener registration count stays 1 (orphan fixture)", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    // Orphan createHTMLDocument has null defaultView — Document capture fallback only.
    // Not production Window proof (see Window registration test below).
    const originalAdd = doc.addEventListener.bind(doc);
    let documentFallbackRegistrations = 0;

    const shared = new Fc007IsolatedReleaseComponent();
    const origInstall = shared.install.bind(shared);
    shared.install = ((docOrWin, options) => {
      doc.addEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        opts?: boolean | AddEventListenerOptions,
      ) => {
        const capture =
          opts === true || (typeof opts === "object" && opts != null && opts.capture === true);
        if (type === "click" && capture === true) {
          documentFallbackRegistrations += 1;
        }
        return originalAdd(type, listener, opts as never);
      }) as Document["addEventListener"];
      try {
        return origInstall(docOrWin, options);
      } finally {
        doc.addEventListener = originalAdd;
      }
    }) as typeof shared.install;

    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      trustClickForTest: trustAll,
      releaseComponent: shared,
    });
    controller.start();
    await controller.attemptFullRecognition();
    const finalButton = controller.getRetainedFinalButton();
    if (!(finalButton instanceof HTMLButtonElement)) throw new Error("no final");
    const form = doc.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("no form");
    form.addEventListener("submit", (e) => e.preventDefault());
    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    armHappyDomExecutor(controller);

    expect(controller.getReleaseListenerInstallCountForTest()).toBe(1);
    expect(documentFallbackRegistrations).toBe(1);
    expect(shared.isWindowCaptureInstalled()).toBe(false);

    controller.cancelPreviewForTest();
    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    armHappyDomExecutor(controller);
    expect(documentFallbackRegistrations).toBe(1);

    controller.invokeTrustedContinueForTest();
    assertOneShotConsumed(controller);
    expect(documentFallbackRegistrations).toBe(1);

    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    armHappyDomExecutor(controller);
    expect(documentFallbackRegistrations).toBe(1);
    expect(controller.getReleaseListenerInstallCountForTest()).toBe(1);

    controller.stop();
    shared.uninstall();
  });

  it("Window release-security listener registration count stays 1 across decisions", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    // Production Window-like browsing-context target (EventTarget + document).
    const et = new EventTarget();
    let installingRelease = false;
    let windowReleaseSecurityRegistrations = 0;
    const winLike = {
      document: doc,
      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        opts?: boolean | AddEventListenerOptions,
      ) {
        const capture =
          opts === true || (typeof opts === "object" && opts != null && opts.capture === true);
        if (installingRelease && type === "click" && capture === true) {
          windowReleaseSecurityRegistrations += 1;
        }
        return et.addEventListener(type, listener, opts);
      },
      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        opts?: boolean | AddEventListenerOptions,
      ) {
        return et.removeEventListener(type, listener, opts);
      },
    } as unknown as Window;

    const shared = new Fc007IsolatedReleaseComponent();
    const origInstall = shared.install.bind(shared);
    // Redirect install onto the Window-like target used by production (not Document fallback).
    shared.install = ((docOrWin, options) => {
      installingRelease = true;
      try {
        return origInstall(winLike, options);
      } finally {
        installingRelease = false;
      }
    }) as typeof shared.install;

    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      trustClickForTest: trustAll,
      releaseComponent: shared,
    });
    controller.start();
    expect(shared.isWindowCaptureInstalled()).toBe(true);
    expect(windowReleaseSecurityRegistrations).toBe(1);
    expect(controller.getReleaseListenerInstallCountForTest()).toBe(1);

    await controller.attemptFullRecognition();
    const finalButton = controller.getRetainedFinalButton();
    if (!(finalButton instanceof HTMLButtonElement)) throw new Error("no final");
    const form = doc.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("no form");
    form.addEventListener("submit", (e) => e.preventDefault());
    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    // Window-like target is not on the orphan-doc bubble path — feed capture via test seam
    // while still counting real Window addEventListener("click", capture) registrations.
    controller.getReleaseComponentForTest().setTestExecutorForTest((btn) => {
      const ev = createClickEventWithTrustForTest(btn, false);
      shared.processEventForTest(ev);
      btn.dispatchEvent(ev);
    });
    expect(windowReleaseSecurityRegistrations).toBe(1);

    controller.cancelPreviewForTest();
    expect(windowReleaseSecurityRegistrations).toBe(1);

    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    controller.getReleaseComponentForTest().setTestExecutorForTest((btn) => {
      const ev = createClickEventWithTrustForTest(btn, false);
      shared.processEventForTest(ev);
      btn.dispatchEvent(ev);
    });
    expect(windowReleaseSecurityRegistrations).toBe(1);

    controller.invokeTrustedContinueForTest();
    assertOneShotConsumed(controller);
    expect(windowReleaseSecurityRegistrations).toBe(1);

    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    controller.getReleaseComponentForTest().setTestExecutorForTest((btn) => {
      const ev = createClickEventWithTrustForTest(btn, false);
      shared.processEventForTest(ev);
      btn.dispatchEvent(ev);
    });
    expect(windowReleaseSecurityRegistrations).toBe(1);
    expect(controller.getReleaseListenerInstallCountForTest()).toBe(1);

    // Duplicate install must be observable as count 2 if it ever occurs.
    expect(windowReleaseSecurityRegistrations).not.toBe(2);

    controller.stop();
    shared.uninstall();
  });

  it("trusted Continue valid → releaseOnce once with consumed receipt", async () => {
    const { controller } = await reachVerified();
    controller.invokeTrustedContinueForTest();
    assertOneShotConsumed(controller);
    expect(controller.getState().kind).toBe("abstained");
    expect((controller.getState() as { reason?: string }).reason).toBe("ACTION_ADMITTED_ONCE");
    expect(controller.getPreviewMode()).not.toBe("verified");
    expect(controller.getActiveDecisionForTest()).toBeNull();
    controller.stop();
  });

  it("L1: Continue DOM not inerted before releaseOnce; host intact at executor", async () => {
    const { controller } = await reachVerified();
    const cont = controller.getContinueButtonForTest();
    expect(cont).toBeInstanceOf(HTMLButtonElement);
    expect(cont?.disabled).toBe(false);
    expect(cont?.isConnected).toBe(true);
    expect(controller.getPreviewHostForTest()?.isConnected).toBe(true);
    let continueDisabledAtRelease = true;
    let hostConnectedAtRelease = false;
    controller.getReleaseComponentForTest().setTestExecutorForTest((btn) => {
      const c = controller.getContinueButtonForTest();
      continueDisabledAtRelease = c == null || c.disabled === true;
      hostConnectedAtRelease = controller.getPreviewHostForTest()?.isConnected === true;
      btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
    });
    controller.invokeTrustedContinueForTest();
    expect(hostConnectedAtRelease).toBe(true);
    expect(continueDisabledAtRelease).toBe(false);
    assertOneShotConsumed(controller);
    controller.stop();
  });

  it("L1: real Continue handler reaches validator with accepted eligibility and unchanged UI", async () => {
    const { controller } = await reachVerified();
    const cont = controller.getContinueButtonForTest();
    expect(cont?.disabled).toBe(false);
    expect(cont?.isConnected).toBe(true);
    const host = controller.getPreviewHostForTest();
    expect(host?.isConnected).toBe(true);
    const terminalBefore = controller.getTerminalUiRenderCountForTest();

    let validatorEntries = 0;
    const originalValidate = continueValidator.validateContinueSameDecision;
    const spy = vi
      .spyOn(continueValidator, "validateContinueSameDecision")
      .mockImplementation((args) => {
        validatorEntries += 1;
        // At production validator entry (via real Continue handler): eligibility accepted,
        // Continue still present/enabled, host connected, no terminal UI yet.
        expect(controller.getDecisionLifecycleStatusForTest()).toBe("accepted");
        const c = controller.getContinueButtonForTest();
        expect(c).toBeInstanceOf(HTMLButtonElement);
        expect(c?.disabled).toBe(false);
        expect(c?.hidden).toBe(false);
        expect(c?.isConnected).toBe(true);
        expect(controller.getPreviewHostForTest()?.isConnected).toBe(true);
        expect(controller.getTerminalUiRenderCountForTest()).toBe(terminalBefore);
        expect(controller.getPreviewMode()).toBe("verified");
        return originalValidate(args);
      });

    controller.invokeTrustedContinueForTest();
    expect(validatorEntries).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    assertOneShotConsumed(controller);
    spy.mockRestore();
    controller.stop();
  });

  it("L1: after invalid validation, Continue may inert; before validator UI unchanged", async () => {
    const { controller, modal } = await reachVerified();
    controller.pauseFreshnessObserverForTest();
    const region = modal.querySelector(
      'div[role="region"][aria-label="Effects of making this repository public"]',
    );
    expect(region).toBeTruthy();
    const p = region?.querySelector("p");
    if (p) p.textContent = "CHANGED REVIEWED EFFECTS MEANING FOR VALIDATOR ENTRY";

    let sawEntry = false;
    const originalValidate = continueValidator.validateContinueSameDecision;
    const spy = vi
      .spyOn(continueValidator, "validateContinueSameDecision")
      .mockImplementation((args) => {
        sawEntry = true;
        expect(controller.getDecisionLifecycleStatusForTest()).toBe("accepted");
        expect(controller.getContinueButtonForTest()?.disabled).toBe(false);
        expect(controller.getPreviewHostForTest()?.isConnected).toBe(true);
        return originalValidate(args);
      });

    controller.invokeTrustedContinueForTest();
    expect(sawEntry).toBe(true);
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(d.continueValidationPass).toBe(0);
    expect(d.continueValidationFail).toBeGreaterThanOrEqual(1);
    expect(d.releaseCalls).toBe(0);
    // Post-invalid cleanup may demote/inert — distinct from pre-validator invariants.
    expect(controller.getPreviewMode()).not.toBe("verified");
    spy.mockRestore();
    controller.stop();
  });

  it("untrusted Continue → zero release", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      trustClickForTest: (event) => {
        return (event as { __fc007Trust?: boolean }).__fc007Trust === true;
      },
    });
    controller.start();
    await controller.attemptFullRecognition();
    const final = controller.getRetainedFinalButton();
    if (!(final instanceof HTMLButtonElement)) throw new Error("no final");
    final.form?.addEventListener("submit", (e) => e.preventDefault());
    const intercept = createCancelableClick(final);
    Object.defineProperty(intercept, "__fc007Trust", { value: true });
    controller.handleCaptureClickForTest(intercept);
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    controller.invokeUntrustedContinueClickForTest();
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(d.acceptedContinueAttempts).toBe(0);
    expect(d.releaseCalls).toBe(0);
    assertZeroRelease(controller);
    expect(controller.getPreviewMode()).toBe("verified");
    controller.stop();
  });

  it("Cancel → zero release", async () => {
    const { controller } = await reachVerified();
    controller.cancelPreviewForTest();
    expect(controller.getActiveDecisionForTest()).toBeNull();
    expect(controller.getSprint3cDiagnosticsForTest().releaseCalls).toBe(0);
    assertZeroRelease(controller);
    controller.stop();
  });

  it("Escape → zero release", async () => {
    const { controller, document: doc } = await reachVerified();
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(controller.getActiveDecisionForTest()).toBeNull());
    expect(controller.getSprint3cDiagnosticsForTest().releaseCalls).toBe(0);
    assertZeroRelease(controller);
    controller.stop();
  });

  it("duplicate Continue → one release", async () => {
    const { controller } = await reachVerified();
    controller.invokeTrustedContinueForTest();
    controller.invokeTrustedContinueForTest();
    controller.invokeTrustedContinueForTest();
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(d.acceptedContinueAttempts).toBe(1);
    expect(d.releaseCalls).toBe(1);
    expect(d.authorizedReleaseCount).toBe(1);
    controller.stop();
  });

  it("old Continue control is actually invoked and releases neither A nor B", async () => {
    const first = await reachVerified();
    const continueA = first.controller.getContinueButtonForTest();
    expect(continueA).toBeInstanceOf(HTMLButtonElement);
    if (!(continueA instanceof HTMLButtonElement)) throw new Error("no continue A");
    first.controller.cancelPreviewForTest();

    const final = first.controller.getRetainedFinalButton();
    if (!(final instanceof HTMLButtonElement)) throw new Error("no final");
    first.controller.handleCaptureClickForTest(createCancelableClick(final));
    await vi.waitFor(() => expect(first.controller.getPreviewMode()).toBe("verified"));
    armHappyDomExecutor(first.controller);
    const continueB = first.controller.getContinueButtonForTest();
    expect(continueB).toBeInstanceOf(HTMLButtonElement);
    expect(continueB).not.toBe(continueA);

    const before = first.controller.getSprint3cDiagnosticsForTest();
    const synth = {
      type: "click",
      isTrusted: true,
      currentTarget: continueA,
      target: continueA,
    } as unknown as MouseEvent;
    Reflect.apply(
      (
        first.controller as unknown as {
          handlePreviewContinue: (e: MouseEvent) => void;
        }
      ).handlePreviewContinue,
      first.controller,
      [synth],
    );
    const after = first.controller.getSprint3cDiagnosticsForTest();
    expect(after.releaseCalls).toBe(before.releaseCalls);
    expect(after.acceptedContinueAttempts).toBe(before.acceptedContinueAttempts);
    expect(after.armCount).toBe(0);
    expect(after.executorCount).toBe(0);
    expect(after.authorizedReleaseCount).toBe(0);
    expect(first.controller.getDecisionLifecycleStatusForTest()).toBe("eligible");
    expect(first.controller.getContinueButtonForTest()).toBe(continueB);
    first.controller.stop();
  });

  it("validator stale effects → zero release", async () => {
    const { controller, modal } = await reachVerified();
    controller.pauseFreshnessObserverForTest();
    const region = modal.querySelector(
      'div[role="region"][aria-label="Effects of making this repository public"]',
    );
    expect(region).toBeTruthy();
    const p = region?.querySelector("p");
    if (p) p.textContent = "CHANGED REVIEWED EFFECTS MEANING";
    controller.invokeTrustedContinueForTest();
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(d.acceptedContinueAttempts).toBe(1);
    expect(d.continueValidationPass).toBe(0);
    expect(d.continueValidationFail).toBeGreaterThanOrEqual(1);
    expect(d.releaseCalls).toBe(0);
    assertZeroRelease(controller);
    controller.stop();
  });

  it("defensive release rejection via test-only orchestration outside controller", async () => {
    const { controller, document: doc } = await reachVerified();
    const decision = controller.getActiveDecisionForTest();
    expect(decision).toBeTruthy();
    if (!decision) throw new Error("no decision");
    const validation = validateContinueSameDecision({
      decision,
      document: doc,
      location: {
        protocol: "https:",
        hostname: "github.com",
        port: "",
        pathname: "/fixture-owner/fixture-repo/settings",
      },
      ownedPreviewHost: controller.getPreviewHostForTest(),
      expectedControllerEpoch: decision.controllerEpoch,
      expectedInterceptEvalSeq: decision.interceptEvalSeq,
      expectedDecisionGeneration: decision.decisionGeneration,
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(validation.status).toBe("VALID_SAME_DECISION");
    // Stale exact host AFTER successful validator — call release component directly.
    decision.ownedHost.remove();
    const release = new Fc007IsolatedReleaseComponent();
    release.install(doc, { matchesModal: testMatchesModal });
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("STALE_TARGET");
    expect(release.getCounters().arms).toBe(0);
    expect(release.getCounters().executorCalls).toBe(0);
    expect(release.getCounters().authorizedEventsObserved).toBe(0);
    expect(release.getCounters().retries).toBe(0);
    release.uninstall();
    // Production controller never released.
    expect(controller.getSprint3cDiagnosticsForTest().releaseCalls).toBe(0);
    controller.stop();
  });

  it("stale form → zero executor", async () => {
    const { controller, form, document: doc } = await reachVerified();
    controller.pauseFreshnessObserverForTest();
    const replacement = doc.createElement("form");
    replacement.id = "visibility-form";
    form.replaceWith(replacement);
    controller.invokeTrustedContinueForTest();
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(d.continueValidationPass).toBe(0);
    expect(d.releaseCalls).toBe(0);
    assertZeroRelease(controller);
    controller.stop();
  });

  it("modal closed → zero executor", async () => {
    const { controller, modal } = await reachVerified();
    controller.pauseFreshnessObserverForTest();
    modal.open = false;
    modal.removeAttribute("open");
    controller.invokeTrustedContinueForTest();
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(d.continueValidationPass).toBe(0);
    expect(d.releaseCalls).toBe(0);
    assertZeroRelease(controller);
    controller.stop();
  });

  it("button wrong form → zero executor", async () => {
    const { controller, document: doc, finalButton } = await reachVerified();
    controller.pauseFreshnessObserverForTest();
    const other = doc.createElement("form");
    other.id = "other-form";
    doc.body.appendChild(other);
    other.appendChild(finalButton);
    controller.invokeTrustedContinueForTest();
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(d.releaseCalls).toBe(0);
    assertZeroRelease(controller);
    controller.stop();
  });

  it("M1: stop during active release keeps host; no UI resurrection after unwind", async () => {
    const { controller } = await reachVerified();
    const hostBefore = controller.getPreviewHostForTest();
    expect(hostBefore?.isConnected).toBe(true);
    const terminalBefore = controller.getTerminalUiRenderCountForTest();

    controller.getReleaseComponentForTest().setTestExecutorForTest((btn) => {
      expect(controller.isReleaseDispatchInProgressForTest()).toBe(true);
      expect(controller.getReleaseComponentForTest().isDispatchGuardActive()).toBe(true);
      expect(hostBefore?.isConnected).toBe(true);
      // Consume first via authorized event, then stop mid-dispatch.
      btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
      expect(hostBefore?.isConnected).toBe(true);
      controller.stop();
      expect(controller.isStartedForTest()).toBe(false);
      expect(controller.isDeferredStopUiCleanupPendingForTest()).toBe(true);
      // Host MUST remain connected after stop while dispatch has not unwound.
      expect(hostBefore?.isConnected).toBe(true);
      expect(controller.getReleaseComponentForTest().isDispatchGuardActive()).toBe(true);
      // Nested matching event still blocked.
      const nested = createClickEventWithTrustForTest(btn, false);
      btn.dispatchEvent(nested);
      expect(nested.defaultPrevented).toBe(true);
    });

    controller.invokeTrustedContinueForTest();

    expect(controller.isStartedForTest()).toBe(false);
    expect(hostBefore?.isConnected).toBe(false);
    expect(controller.getTerminalUiRenderCountForTest()).toBe(terminalBefore);
    expect(controller.getPreviewMode()).not.toBe("verified");
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(d.releaseCalls).toBe(1);
    expect(d.authorizedReleaseCount).toBe(1);
    expect(d.consumptions).toBe(1);
    expect(d.retries).toBe(0);
    expect(controller.isDeferredStopUiCleanupPendingForTest()).toBe(false);
  });

  it("failure-after-consume via Sprint-3B component test API; no controller retry", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      trustClickForTest: trustAll,
    });
    controller.start();
    await controller.attemptFullRecognition();
    const finalButton = controller.getRetainedFinalButton();
    if (!(finalButton instanceof HTMLButtonElement)) throw new Error("no final");
    finalButton.form?.addEventListener("submit", (e) => e.preventDefault());
    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    let thrown = false;
    controller.getReleaseComponentForTest().setTestExecutorForTest((btn) => {
      btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
      thrown = true;
      throw new Error("executor-after-consume");
    });
    controller.invokeTrustedContinueForTest();
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(thrown).toBe(true);
    expect(d.releaseCalls).toBe(1);
    expect(d.consumptions).toBe(1);
    expect(d.authorizedReleaseCount).toBe(1);
    expect(d.retries).toBe(0);
    expect(d.terminalOutcome).toBe("EXECUTOR_FAILED_AFTER_CONSUME");
    controller.invokeTrustedContinueForTest();
    expect(controller.getSprint3cDiagnosticsForTest().releaseCalls).toBe(1);
    controller.stop();
  });

  it("consumed receipt preserved; terminal UI after unwind; listener inert until stop", async () => {
    const { controller } = await reachVerified();
    controller.invokeTrustedContinueForTest();
    const receipt = controller.getReleaseComponentForTest().getReceipt();
    expect(receipt.consumed).toBe(true);
    expect(receipt.authorizedEventObserved).toBe(true);
    expect(controller.getPreviewMode()).not.toBe("verified");
    expect(controller.isReleaseListenerInstalledForTest()).toBe(true);
    expect(controller.getReleaseComponentForTest().isDispatchGuardActive()).toBe(false);
    controller.stop();
    expect(controller.isReleaseListenerInstalledForTest()).toBe(false);
  });

  it("listener remains installed/inert for shared release after Continue", async () => {
    const shared = new Fc007IsolatedReleaseComponent();
    const { controller } = await reachVerified({ releaseComponent: shared });
    controller.invokeTrustedContinueForTest();
    assertOneShotConsumed(controller);
    expect(shared.isListenerInstalled()).toBe(true);
    expect(shared.isDispatchGuardActive()).toBe(false);
    controller.stop();
    shared.uninstall();
  });

  it("pagehide invalidates active decision", async () => {
    const { controller, document: doc } = await reachVerified();
    const win = doc.defaultView ?? window;
    win.dispatchEvent(new Event("pagehide"));
    expect(controller.getActiveDecisionForTest()).toBeNull();
    expect(controller.getSprint3cDiagnosticsForTest().releaseCalls).toBe(0);
    controller.stop();
  });

  it("next fresh decision can release after prior Cancel", async () => {
    const { controller, finalButton } = await reachVerified();
    controller.cancelPreviewForTest();
    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    armHappyDomExecutor(controller);
    controller.invokeTrustedContinueForTest();
    assertOneShotConsumed(controller);
    controller.stop();
  });

  it("no generic page release API; production options lack test injection hooks", async () => {
    const { controller } = await reachVerified();
    const c = controller as unknown as Record<string, unknown>;
    expect(typeof c.releaseOnce).toBe("undefined");
    expect(typeof c.arm).toBe("undefined");
    expect(typeof c.armForTest).toBe("undefined");
    expect(typeof c.betweenValidationAndReleaseForTest).toBe("undefined");
    expect(typeof c.testNativeExecutorForTest).toBe("undefined");
    controller.stop();
  });
});

describe("FC-007 Sprint 3C production options surface", () => {
  it("Fc007PassiveControllerOptions does not accept removed test hooks at runtime", () => {
    const opts = {
      recognitionVersion: "v2" as const,
      betweenValidationAndReleaseForTest: (_d: Fc007VerifiedDecision) => {},
      testNativeExecutorForTest: (_b: HTMLButtonElement) => {},
    };
    // Excess properties must not be read by the controller constructor.
    const controller = new Fc007PassiveController(
      opts as ConstructorParameters<typeof Fc007PassiveController>[0],
    );
    expect(
      (controller as unknown as { betweenValidationAndReleaseForTest?: unknown })
        .betweenValidationAndReleaseForTest,
    ).toBeUndefined();
    expect(
      (controller as unknown as { testNativeExecutorForTest?: unknown }).testNativeExecutorForTest,
    ).toBeUndefined();
    controller.stop();
  });
});
