/**
 * FC-007 Sprint 3B — isolated one-shot release security-fix tests.
 *
 * Production Continue remains unwired. No live GitHub. No real mutation.
 */

import { describe, expect, it, vi } from "vitest";
import { isNativeClickCaptureAvailable } from "../src/fc007/native-click-executor.js";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import {
  type Fc007AuthorizedEventView,
  Fc007IsolatedReleaseComponent,
  type Fc007ReleaseCounters,
  createClickEventWithTrustForTest,
  isAuthorizedReleaseEventView,
} from "../src/fc007/release-attempt.js";
import type { Fc007VerifiedDecision } from "../src/fc007/verified-decision.js";
import { createFc007V2SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

function trustAll(event: Event): boolean {
  return event.type === "click" || event.type === "keydown";
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

/** Happy-dom cannot emit isTrusted === false via native .click — use test seam. */
function authorizedDispatchExecutor(btn: HTMLButtonElement): void {
  btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
}

async function reachVerifiedDecision(): Promise<{
  readonly controller: Fc007PassiveController;
  readonly document: Document;
  readonly window: Window;
  readonly decision: Fc007VerifiedDecision;
  readonly finalButton: HTMLButtonElement;
}> {
  const { document: doc, location, window: win } = createFc007V2SettingsWindow({ stage: "d" });
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
  expect(finalButton).toBeInstanceOf(HTMLButtonElement);
  if (!(finalButton instanceof HTMLButtonElement)) throw new Error("no final");
  controller.handleCaptureClickForTest(createCancelableClick(finalButton));
  await vi.waitFor(() => {
    expect(controller.getPreviewMode()).toBe("verified");
  });
  const decision = controller.getActiveDecisionForTest();
  expect(decision).toBeTruthy();
  if (!decision) throw new Error("no decision");
  // Remove Sprint-2 interception. stop() destroys preview host — re-attach exact
  // retained host so Sprint-3B currentness can validate exact refs (no selector recovery).
  const retainedHost = decision.ownedHost;
  const retainedModal = decision.modal;
  controller.stop();
  if (!retainedHost.isConnected && retainedModal.isConnected) {
    retainedModal.appendChild(retainedHost);
  }
  expect(decision.finalButton.isConnected).toBe(true);
  expect(retainedHost.isConnected).toBe(true);
  return {
    controller,
    document: doc,
    window: win,
    decision,
    finalButton: decision.finalButton,
  };
}

function installRelease(doc: Document): Fc007IsolatedReleaseComponent {
  const release = new Fc007IsolatedReleaseComponent();
  // Fixture docs from createHTMLDocument have no defaultView — install on Document
  // (event-path root). Chrome smoke installs on Window at document_start.
  release.install(doc, { matchesModal: testMatchesModal });
  expect(release.isListenerInstalled()).toBe(true);
  return release;
}

function assertZeroProductionRelease(controller: Fc007PassiveController): void {
  const d = controller.getSprint3aDiagnosticsForTest();
  expect(d.armCount).toBe(0);
  expect(d.executorCount).toBe(0);
  expect(d.authorizedReleaseCount).toBe(0);
}

describe("FC-007 Sprint 3B — H1 strict trust", () => {
  it("missing isTrusted rejects authorization and consumption", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    expect(release.armForTest(decision).status).toBe("ok");

    // Explicit view with NO isTrusted — classify rejects.
    const view = {
      type: "click",
      target: finalButton,
      cancelable: true,
      defaultPrevented: false,
    } as unknown as Fc007AuthorizedEventView;
    expect(isAuthorizedReleaseEventView(view, finalButton, true, false)).toBe(false);
    expect(release.classifyAuthorizedViewForTest(view).authorized).toBe(false);

    // Event object without isTrusted property → not authorized, blocked if matching.
    const missing = {
      type: "click",
      target: finalButton,
      cancelable: true,
      defaultPrevented: false,
      preventDefault() {
        (this as { defaultPrevented: boolean }).defaultPrevented = true;
      },
      stopImmediatePropagation() {},
      stopPropagation() {},
    } as unknown as Event;
    release.processEventForTest(missing);
    expect(release.getReceipt().consumed).toBe(false);
    expect(release.getCounters().authorizedEventsObserved).toBe(0);
    expect(release.getCounters().permissionConsumptions).toBe(0);
    expect(release.getPermission()).toBe("armed");
    release.invalidate();
    release.uninstall();
  });

  it("isTrusted === true never consumes", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    expect(release.armForTest(decision).status).toBe("ok");
    const trusted = createClickEventWithTrustForTest(finalButton, true);
    finalButton.dispatchEvent(trusted);
    expect(trusted.defaultPrevented).toBe(true);
    expect(release.getReceipt().consumed).toBe(false);
    expect(release.getPermission()).toBe("armed");
    release.invalidate();
    release.uninstall();
  });

  it("isTrusted === false may consume only with all other conditions", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.form.addEventListener("submit", (e) => e.preventDefault());
    release.setTestExecutorForTest(authorizedDispatchExecutor);
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("CONSUMED");
    expect(r.receipt.consumed).toBe(true);
    expect(release.getCounters().authorizedEventsObserved).toBe(1);
    void win;
    void finalButton;
    release.uninstall();
  });

  it("pre-prevented cancelable event rejects (genuinely preventDefault before classify)", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    expect(release.armForTest(decision).status).toBe("ok");
    const ev = createClickEventWithTrustForTest(finalButton, false, {
      preventDefaultBeforeDispatch: true,
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(ev.cancelable).toBe(true);
    finalButton.dispatchEvent(ev);
    expect(release.getReceipt().consumed).toBe(false);
    expect(release.getCounters().authorizedEventsObserved).toBe(0);
    expect(release.getCounters().blockedMatchingEvents).toBeGreaterThanOrEqual(1);
    release.invalidate();
    release.uninstall();
  });
});

describe("FC-007 Sprint 3B — H2 event redispatch / no identity bypass", () => {
  it("reused same Event object is blocked on first and second dispatch", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.form.addEventListener("submit", (e) => e.preventDefault());

    release.setTestExecutorForTest((btn) => {
      btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
      // Same Event object twice — processEventForTest proves no identity early-return
      // (happy-dom may suppress second native redispatch of a prevented Event).
      const nested = {
        type: "click",
        target: btn,
        isTrusted: false,
        cancelable: true,
        defaultPrevented: false,
        preventDefault() {
          (this as { defaultPrevented: boolean }).defaultPrevented = true;
        },
        stopImmediatePropagation() {},
        stopPropagation() {},
      } as unknown as Event;
      release.processEventForTest(nested);
      // Second evaluation of SAME object (may already be defaultPrevented)
      release.processEventForTest(nested);
    });

    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("CONSUMED");
    expect(r.receipt.consumed).toBe(true);
    expect(release.getCounters().authorizedEventsObserved).toBe(1);
    expect(release.getCounters().blockedMatchingEvents).toBeGreaterThanOrEqual(2);
    expect(release.getCounters().permissionConsumptions).toBe(1);
    void win;
    void finalButton;
    release.uninstall();
  });

  it("no Event-identity early-return: processEventForTest evaluates every call", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    release.setTestExecutorForTest(() => {
      // Matching protected event that is NOT authorized (already defaultPrevented).
      const nested = {
        type: "click",
        target: finalButton,
        isTrusted: false,
        cancelable: true,
        defaultPrevented: true,
        preventDefault() {},
        stopImmediatePropagation() {},
        stopPropagation() {},
      } as unknown as Event;
      release.processEventForTest(nested);
      release.processEventForTest(nested);
    });
    expect(release.armForTest(decision).status).toBe("ok");
    const r = release.executeArmedForTest();
    expect(r.receipt.consumed).toBe(false);
    expect(release.getCounters().blockedMatchingEvents).toBeGreaterThanOrEqual(2);
    expect(release.getCounters().fcWindowCaptureSeen).toBeGreaterThanOrEqual(2);
    void win;
    release.uninstall();
  });
});

describe("FC-007 Sprint 3B — H3 Window capture architecture", () => {
  it("authoritative listener is Window capture; install before arm; no add after arm", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    expect(release.isListenerInstalled()).toBe(true);
    // releaseOnce does not re-register
    release.setTestExecutorForTest(() => {});
    release.releaseOnce(decision);
    expect(release.isListenerInstalled()).toBe(true);
    release.uninstall();
    expect(release.isListenerInstalled()).toBe(false);
  });

  it("FutureClick capture runs before later handlers; permission consumed first", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.form.addEventListener("submit", (e) => e.preventDefault());
    // Fixture docs have no Window on the event path — register a LATER Document
    // capture listener to model page Window ordering (Chrome smoke uses real Window).
    let laterSawConsumed = false;
    let laterCount = 0;
    doc.addEventListener(
      "click",
      () => {
        laterCount += 1;
        laterSawConsumed = release.getReceipt().consumed === true;
      },
      true,
    );
    release.setTestExecutorForTest(authorizedDispatchExecutor);
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("CONSUMED");
    expect(laterCount).toBe(1);
    expect(laterSawConsumed).toBe(true);
    expect(release.getFcWindowSequenceAtConsume()).toBeGreaterThan(0);
    void win;
    void finalButton;
    release.uninstall();
  });
});

describe("FC-007 Sprint 3B — happy path + nested", () => {
  it("admits exactly one untrusted exact-target click; consume-before-handler; guard active", async () => {
    expect(isNativeClickCaptureAvailable()).toBe(true);
    const {
      window: win,
      controller,
      document: doc,
      decision,
      finalButton,
    } = await reachVerifiedDecision();
    assertZeroProductionRelease(controller);

    const release = installRelease(doc);
    let handlerSawConsumed = false;
    let handlerSawGuard = false;
    let primaryCount = 0;
    const onPrimary = (): void => {
      primaryCount += 1;
      release.notePagePrimaryHandlerForTest();
      handlerSawConsumed = release.getReceipt().consumed === true;
      handlerSawGuard = release.isDispatchGuardActive() === true;

      let prevented = false;
      const nested = {
        type: "click",
        target: finalButton,
        isTrusted: false,
        cancelable: true,
        get defaultPrevented() {
          return prevented;
        },
        preventDefault() {
          prevented = true;
        },
        stopImmediatePropagation() {},
        stopPropagation() {},
      } as unknown as Event;
      release.processEventForTest(nested);
      expect(prevented).toBe(true);
    };
    finalButton.addEventListener("click", onPrimary);
    decision.form.addEventListener("submit", (e) => {
      e.preventDefault();
      release.noteSubmitForTest();
    });

    release.setTestExecutorForTest(authorizedDispatchExecutor);
    const result = release.releaseOnce(decision);
    expect(result.outcome).toBe("CONSUMED");
    expect(result.receipt.consumed).toBe(true);
    expect(primaryCount).toBe(1);
    expect(handlerSawConsumed).toBe(true);
    expect(handlerSawGuard).toBe(true);

    const c = release.getCounters();
    expect(c.attemptsCreated).toBe(1);
    expect(c.arms).toBe(1);
    expect(c.executorCalls).toBe(1);
    expect(c.authorizedEventsObserved).toBe(1);
    expect(c.permissionConsumptions).toBe(1);
    expect(c.retries).toBe(0);
    expect(c.fallbacks).toBe(0);

    finalButton.removeEventListener("click", onPrimary);
    release.uninstall();
    assertZeroProductionRelease(controller);
  });

  it("blocks nested descendant; never grants descendant authority", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    const span = doc.createElement("span");
    span.textContent = "inner";
    finalButton.appendChild(span);
    let nestedDescendantHandlers = 0;
    span.addEventListener("click", () => {
      nestedDescendantHandlers += 1;
    });
    decision.form.addEventListener("submit", (e) => e.preventDefault());
    finalButton.addEventListener("click", () => {
      let prevented = false;
      const nested = {
        type: "click",
        target: span,
        isTrusted: false,
        cancelable: true,
        get defaultPrevented() {
          return prevented;
        },
        preventDefault() {
          prevented = true;
        },
        stopImmediatePropagation() {},
        stopPropagation() {},
      } as unknown as Event;
      release.processEventForTest(nested);
      expect(prevented).toBe(true);
    });
    release.setTestExecutorForTest(authorizedDispatchExecutor);
    expect(release.releaseOnce(decision).outcome).toBe("CONSUMED");
    expect(nestedDescendantHandlers).toBe(0);
    expect(release.getCounters().authorizedEventsObserved).toBe(1);
    release.uninstall();
  });
});

describe("FC-007 Sprint 3B — M1 stale authority", () => {
  it("host removed → reject; executor 0", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.ownedHost.remove();
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("STALE_TARGET");
    expect(release.getCounters().executorCalls).toBe(0);
    expect(release.getCounters().authorizedEventsObserved).toBe(0);
    release.uninstall();
  });

  it("host reparented outside modal → reject", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    doc.body.appendChild(decision.ownedHost);
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("STALE_TARGET");
    expect(release.getCounters().executorCalls).toBe(0);
    release.uninstall();
  });

  it("form reparented outside modal → reject; executor 0", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    doc.body.appendChild(decision.form);
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("STALE_TARGET");
    expect(release.getCounters().executorCalls).toBe(0);
    release.uninstall();
  });

  it("button moved to different form → reject; executor 0", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    const other = doc.createElement("form");
    doc.body.appendChild(other);
    other.appendChild(finalButton);
    expect(finalButton.form).not.toBe(decision.form);
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("STALE_TARGET");
    expect(release.getCounters().executorCalls).toBe(0);
    release.uninstall();
  });

  it("modal closed while connected → reject; executor 0", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.modal.close();
    expect(decision.modal.open).toBe(false);
    expect(decision.modal.isConnected).toBe(true);
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("STALE_TARGET");
    expect(release.getCounters().executorCalls).toBe(0);
    release.uninstall();
  });

  it("modal disconnected → reject", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.modal.remove();
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("STALE_TARGET");
    expect(release.getCounters().executorCalls).toBe(0);
    release.uninstall();
  });

  it("form disconnected → reject", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.form.remove();
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("STALE_TARGET");
    expect(release.getCounters().executorCalls).toBe(0);
    release.uninstall();
  });
});

describe("FC-007 Sprint 3B — M2 deferred uninstall", () => {
  it("uninstall during dispatch defers removal; nested still blocked", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.form.addEventListener("submit", (e) => e.preventDefault());
    let nestedBlocked = false;
    finalButton.addEventListener("click", () => {
      release.uninstall(); // during dispatch
      expect(release.wasUninstallDeferred()).toBe(true);
      expect(release.isListenerInstalled()).toBe(true);
      let prevented = false;
      const nested = {
        type: "click",
        target: finalButton,
        isTrusted: false,
        cancelable: true,
        get defaultPrevented() {
          return prevented;
        },
        preventDefault() {
          prevented = true;
        },
        stopImmediatePropagation() {},
        stopPropagation() {},
      } as unknown as Event;
      release.processEventForTest(nested);
      nestedBlocked = prevented;
    });
    release.setTestExecutorForTest(authorizedDispatchExecutor);
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("CONSUMED");
    expect(nestedBlocked).toBe(true);
    // After unwind, pending uninstall applied
    expect(release.isListenerInstalled()).toBe(false);
    expect(release.wasUninstallDeferred()).toBe(false);
  });
});

describe("FC-007 Sprint 3B — M3 receipt / outcome integrity", () => {
  it("throw null before consume → EXECUTOR_FAILED_BEFORE_CONSUME", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    release.setTestExecutorForTest(() => {
      throw null;
    });
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("EXECUTOR_FAILED_BEFORE_CONSUME");
    expect(r.receipt.consumed).toBe(false);
    expect(r.receipt.authorizedEventObserved).toBe(false);
    expect(r.receipt.executorThrew).toBe(true);
    expect(r.receipt.executorFailurePhase).toBe("before_consume");
    release.uninstall();
  });

  it("throw undefined before consume → EXECUTOR_FAILED_BEFORE_CONSUME", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    release.setTestExecutorForTest(() => {
      throw undefined;
    });
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("EXECUTOR_FAILED_BEFORE_CONSUME");
    expect(r.receipt.executorThrew).toBe(true);
    release.uninstall();
  });

  it("throw matrix before consume all recognized", async () => {
    const values: unknown[] = [new Error("e"), null, undefined, false, 0];
    for (const v of values) {
      const { window: win, document: doc, decision } = await reachVerifiedDecision();
      const release = installRelease(doc);
      release.setTestExecutorForTest(() => {
        throw v;
      });
      const r = release.releaseOnce(decision);
      expect(r.outcome).toBe("EXECUTOR_FAILED_BEFORE_CONSUME");
      expect(r.receipt.executorThrew).toBe(true);
      expect(r.receipt.consumed).toBe(false);
      release.uninstall();
    }
  });

  it("throw null after consume → EXECUTOR_FAILED_AFTER_CONSUME; consumed true", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.form.addEventListener("submit", (e) => e.preventDefault());
    release.setTestExecutorForTest((btn) => {
      btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
      throw null;
    });
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("EXECUTOR_FAILED_AFTER_CONSUME");
    expect(r.receipt.consumed).toBe(true);
    expect(r.receipt.authorizedEventObserved).toBe(true);
    expect(r.receipt.executorThrew).toBe(true);
    expect(r.receipt.executorFailurePhase).toBe("after_consume");
    release.uninstall();
  });

  it("throw Error/null/undefined after consume preserve failure-after", async () => {
    for (const v of [new Error("after"), null, undefined]) {
      const { window: win, document: doc, decision } = await reachVerifiedDecision();
      const release = installRelease(doc);
      decision.form.addEventListener("submit", (e) => e.preventDefault());
      release.setTestExecutorForTest((btn) => {
        btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
        throw v;
      });
      const r = release.releaseOnce(decision);
      expect(r.outcome).toBe("EXECUTOR_FAILED_AFTER_CONSUME");
      expect(r.receipt.consumed).toBe(true);
      release.uninstall();
    }
  });

  it("invalidation during dispatch before consume → INVALIDATED not NO_AUTHORIZED_EVENT", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    release.setTestExecutorForTest(() => {
      release.invalidate();
      // no event
    });
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("INVALIDATED");
    expect(r.receipt.invalidationObserved).toBe(true);
    expect(r.receipt.consumed).toBe(false);
    expect(r.outcome).not.toBe("NO_AUTHORIZED_EVENT");
    release.uninstall();
  });

  it("invalidation after consume preserves consumed + invalidation", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.form.addEventListener("submit", (e) => e.preventDefault());
    release.setTestExecutorForTest((btn) => {
      btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
      release.invalidate();
    });
    const r = release.releaseOnce(decision);
    expect(r.receipt.consumed).toBe(true);
    expect(r.receipt.invalidationObserved).toBe(true);
    expect(r.outcome).toBe("INVALIDATED_AFTER_CONSUME");
    expect(r.outcome).not.toBe("CONSUMED");
    release.uninstall();
  });

  it("invalidate before release → executor 0", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    expect(release.armForTest(decision).status).toBe("ok");
    expect(release.invalidate()).toBe("INVALIDATED");
    expect(release.executeArmedForTest().outcome).toBe("NOT_ARMED");
    expect(release.getCounters().executorCalls).toBe(0);
    release.uninstall();
  });
});

describe("FC-007 Sprint 3B failure / receipt semantics", () => {
  it("no-event executor → NO_AUTHORIZED_EVENT; no retry", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    release.setTestExecutorForTest(() => {});
    const r = release.releaseOnce(decision);
    expect(r.outcome).toBe("NO_AUTHORIZED_EVENT");
    expect(r.receipt.consumed).toBe(false);
    expect(release.getCounters().executorCalls).toBe(1);
    expect(release.getCounters().retries).toBe(0);
    release.uninstall();
  });

  it("noncancelable event cannot consume", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    release.setTestExecutorForTest(() => {
      finalButton.dispatchEvent(
        createClickEventWithTrustForTest(finalButton, false, { cancelable: false }),
      );
    });
    expect(release.releaseOnce(decision).receipt.consumed).toBe(false);
    release.uninstall();
  });

  it("descendant target cannot consume", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    const span = doc.createElement("span");
    finalButton.appendChild(span);
    release.setTestExecutorForTest(() => {
      span.dispatchEvent(createClickEventWithTrustForTest(span, false));
    });
    const r = release.releaseOnce(decision);
    expect(r.receipt.consumed).toBe(false);
    expect(r.outcome).toBe("NO_AUTHORIZED_EVENT");
    release.uninstall();
  });
});

describe("FC-007 Sprint 3B lifecycle / tamper / production unwired", () => {
  it("double arm fails closed; decision reuse rejected", async () => {
    const { window: win, document: doc, decision } = await reachVerifiedDecision();
    const release = installRelease(doc);
    release.setTestExecutorForTest(() => {});
    expect(release.armForTest(decision).status).toBe("ok");
    const second = release.armForTest(decision);
    expect(second.status).toBe("invalid");
    if (second.status === "invalid") {
      expect(second.outcome).toBe("DOUBLE_ARM_REJECTED");
    }
    release.executeArmedForTest();
    const third = release.armForTest(decision);
    expect(third.status).toBe("invalid");
    if (third.status === "invalid") {
      expect(third.outcome).toBe("DECISION_ALREADY_ATTEMPTED");
    }
    release.uninstall();
  });

  it("replacement button before arm → STALE_TARGET; executor 0", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    const replacement = doc.createElement("button");
    replacement.type = "submit";
    replacement.id = "final-make-public";
    replacement.textContent = "I understand, make this repository public";
    finalButton.replaceWith(replacement);
    const armed = release.armForTest(decision);
    expect(armed.status).toBe("invalid");
    if (armed.status === "invalid") {
      expect(armed.outcome).toBe("STALE_TARGET");
    }
    expect(release.getCounters().executorCalls).toBe(0);
    release.uninstall();
  });

  it("page-tampered instance/prototype .click does not steal isolated executor", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.form.addEventListener("submit", (e) => e.preventDefault());
    let instanceTamper = 0;
    let protoTamper = 0;
    finalButton.click = (() => {
      instanceTamper += 1;
    }) as typeof finalButton.click;
    const originalProto = HTMLButtonElement.prototype.click;
    HTMLButtonElement.prototype.click = function (this: HTMLButtonElement) {
      protoTamper += 1;
    };
    try {
      const { invokeCapturedNativeClick } = await import("../src/fc007/native-click-executor.js");
      invokeCapturedNativeClick(finalButton);
      expect(instanceTamper).toBe(0);
      expect(protoTamper).toBe(0);

      release.setTestExecutorForTest(authorizedDispatchExecutor);
      const r = release.releaseOnce(decision);
      expect(r.outcome).toBe("CONSUMED");
      expect(instanceTamper).toBe(0);
      expect(protoTamper).toBe(0);
      expect(release.getCounters().authorizedEventsObserved).toBe(1);
    } finally {
      HTMLButtonElement.prototype.click = originalProto;
    }
    release.uninstall();
  });

  it("production Continue path releases exactly once via releaseOnce", async () => {
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
    const form = finalButton.form;
    if (form) form.addEventListener("submit", (e) => e.preventDefault());
    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => {
      expect(controller.getPreviewMode()).toBe("verified");
    });
    controller.getReleaseComponentForTest().setTestExecutorForTest(authorizedDispatchExecutor);
    controller.invokeTrustedContinueForTest();
    const d = controller.getSprint3aDiagnosticsForTest();
    expect(d.acceptedContinueAttempts).toBe(1);
    expect(d.continueValidationPass).toBe(1);
    expect(d.releaseCalls).toBe(1);
    expect(d.armCount).toBe(1);
    expect(d.executorCount).toBe(1);
    expect(d.authorizedReleaseCount).toBe(1);
    expect(d.retries).toBe(0);
    expect(d.fallbacks).toBe(0);
    controller.stop();
  });

  it("counter invariants: no retry/fallback; one auth", async () => {
    const { window: win, document: doc, decision, finalButton } = await reachVerifiedDecision();
    const release = installRelease(doc);
    decision.form.addEventListener("submit", (e) => e.preventDefault());
    finalButton.addEventListener("click", () => {
      const nested = {
        type: "click",
        target: finalButton,
        isTrusted: false,
        cancelable: true,
        defaultPrevented: false,
        preventDefault() {
          (this as { defaultPrevented: boolean }).defaultPrevented = true;
        },
        stopImmediatePropagation() {},
        stopPropagation() {},
      } as unknown as Event;
      release.processEventForTest(nested);
    });
    release.setTestExecutorForTest(authorizedDispatchExecutor);
    release.releaseOnce(decision);
    const c: Fc007ReleaseCounters = release.getCounters();
    expect(c.authorizedEventsObserved).toBe(1);
    expect(c.permissionConsumptions).toBe(1);
    expect(c.executorCalls).toBe(1);
    expect(c.retries).toBe(0);
    expect(c.fallbacks).toBe(0);
    release.uninstall();
  });
});
