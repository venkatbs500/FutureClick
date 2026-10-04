/**
 * FC-007 H1 — matching consequential activation is blocked unless it is the exact
 * authorized release event.
 *
 * Trust is granted ONLY to events explicitly marked by the test (stands in for a real
 * human click); page-style click()/dispatchEvent stay untrusted. The fixture form has
 * no harness-side submit preventDefault: a submit reaching the form is a bypass.
 * Chrome smoke proves the same on the normal production bundle.
 */

import { describe, expect, it, vi } from "vitest";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import { createClickEventWithTrustForTest } from "../src/fc007/release-attempt.js";
import { createFc007V2SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

const humanEvents = new WeakSet<Event>();

function humanClick(target: EventTarget): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, "target", { configurable: true, value: target });
  humanEvents.add(event);
  return event;
}

async function setup(): Promise<{
  readonly controller: Fc007PassiveController;
  readonly doc: Document;
  readonly finalButton: HTMLButtonElement;
  readonly form: HTMLFormElement;
  readonly modal: HTMLDialogElement;
  readonly submits: () => number;
}> {
  const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
  const controller = new Fc007PassiveController({
    document: doc,
    location,
    requireTopFrame: false,
    recognitionVersion: "v2",
    matchesModal: testMatchesModal,
    evaluateOnRecognize: true,
    // Marked events, or the controller's own non-Event trusted-Continue test object.
    trustClickForTest: (event) =>
      humanEvents.has(event) ||
      (!(event instanceof Event) && (event as { isTrusted?: unknown }).isTrusted === true),
  });
  controller.start();
  await controller.attemptFullRecognition();
  const finalButton = controller.getRetainedFinalButton();
  if (!(finalButton instanceof HTMLButtonElement)) throw new Error("no final");
  const form = doc.getElementById("visibility-form");
  const modal = doc.getElementById("visibility-dialog");
  if (!(form instanceof HTMLFormElement)) throw new Error("no form");
  if (!(modal instanceof HTMLDialogElement)) throw new Error("no modal");
  let submitCount = 0;
  // Counts only — never prevents. Window/Document-capture FutureClick runs first.
  form.addEventListener("submit", () => {
    submitCount += 1;
  });
  return { controller, doc, finalButton, form, modal, submits: () => submitCount };
}

async function reachVerified(): Promise<Awaited<ReturnType<typeof setup>>> {
  const s = await setup();
  s.controller.handleCaptureClickForTest(humanClick(s.finalButton));
  await vi.waitFor(() => expect(s.controller.getPreviewMode()).toBe("verified"));
  return s;
}

function armExecutor(controller: Fc007PassiveController, seen?: MouseEvent[]): void {
  controller.getReleaseComponentForTest().setTestExecutorForTest((btn) => {
    const ev = createClickEventWithTrustForTest(btn, false);
    seen?.push(ev);
    btn.dispatchEvent(ev);
  });
}

function expectZeroRelease(controller: Fc007PassiveController): void {
  const d = controller.getSprint3cDiagnosticsForTest();
  expect(d.releaseCalls).toBe(0);
  expect(d.armCount).toBe(0);
  expect(d.executorCount).toBe(0);
  expect(d.authorizedReleaseCount).toBe(0);
  expect(d.consumptions).toBe(0);
}

function syntheticClick(target: EventTarget, cancelable = true): MouseEvent {
  return new MouseEvent("click", { bubbles: true, cancelable, composed: true });
}

describe("FC-007 H1 — before first human decision", () => {
  it("CASE A: page finalButton.click() is blocked; no submit, no preview, no release", async () => {
    const { controller, finalButton, submits } = await setup();
    finalButton.click();
    await new Promise((r) => setTimeout(r, 30));
    expect(submits()).toBe(0);
    expect(controller.isPreviewVisible()).toBe(false);
    expect(controller.getActiveDecisionForTest()).toBeNull();
    expectZeroRelease(controller);
    expect(controller.getActivationGuardDiagnosticsForTest().blockedUnauthorizedActivations).toBe(
      1,
    );
    controller.stop();
  });

  it("CASE B: page dispatchEvent(cancelable bubbling click) is prevented; no submit", async () => {
    const { controller, finalButton, submits } = await setup();
    const ev = syntheticClick(finalButton);
    finalButton.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(submits()).toBe(0);
    expect(controller.isPreviewVisible()).toBe(false);
    expectZeroRelease(controller);
    controller.stop();
  });

  it("non-cancelable synthetic click still activates; the resulting submit is blocked", async () => {
    const { controller, finalButton, submits } = await setup();
    const ev = syntheticClick(finalButton, false);
    finalButton.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(submits()).toBe(0);
    const g = controller.getActivationGuardDiagnosticsForTest();
    expect(g.blockedUnauthorizedActivations).toBe(1);
    expect(g.blockedUnauthorizedSubmits).toBe(1);
    expectZeroRelease(controller);
    controller.stop();
  });

  it("page requestSubmit(finalButton) is blocked (submitter is the guarded button)", async () => {
    const { controller, form, finalButton, submits } = await setup();
    form.requestSubmit(finalButton);
    expect(submits()).toBe(0);
    expect(controller.getActivationGuardDiagnosticsForTest().blockedUnauthorizedSubmits).toBe(1);
    controller.stop();
  });

  it("descendant of the retained button: page click() is blocked", async () => {
    const { controller, finalButton, submits } = await setup();
    const span = finalButton.ownerDocument.createElement("span");
    finalButton.appendChild(span);
    span.click();
    expect(submits()).toBe(0);
    expect(controller.isPreviewVisible()).toBe(false);
    expect(controller.getActivationGuardDiagnosticsForTest().blockedUnauthorizedActivations).toBe(
      1,
    );
    controller.stop();
  });
});

describe("FC-007 H1 — VERIFIED waiting for Continue", () => {
  it("CASE C: exact freeze reproduction — page click() never substitutes for Continue", async () => {
    const { controller, finalButton, submits } = await reachVerified();
    armExecutor(controller);
    finalButton.click();
    expect(submits()).toBe(0);
    expect(controller.getActivationGuardDiagnosticsForTest()).toMatchObject({
      blockedUnauthorizedActivations: 1,
      blockedUnauthorizedSubmits: 0,
      allowedReleaseSubmits: 0,
    });
    expectZeroRelease(controller);
    expect(controller.getPreviewMode()).toBe("verified");
    expect(controller.getSprint3cDiagnosticsForTest().acceptedContinueAttempts).toBe(0);
    controller.stop();
  });

  it("CASE D: page dispatchEvent while waiting is prevented; no submit, no release", async () => {
    const { controller, finalButton, submits } = await reachVerified();
    armExecutor(controller);
    const ev = syntheticClick(finalButton);
    finalButton.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(submits()).toBe(0);
    expectZeroRelease(controller);
    controller.stop();
  });

  it("descendant while waiting: page click() is blocked", async () => {
    const { controller, finalButton, submits } = await reachVerified();
    const span = finalButton.ownerDocument.createElement("span");
    finalButton.appendChild(span);
    span.click();
    expect(submits()).toBe(0);
    expectZeroRelease(controller);
    controller.stop();
  });

  it("blocked page click while waiting does not disturb the later authorized release", async () => {
    const { controller, finalButton, submits } = await reachVerified();
    armExecutor(controller);
    finalButton.click();
    expect(submits()).toBe(0);
    controller.invokeTrustedContinueForTest();
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(d.releaseCalls).toBe(1);
    expect(d.consumptions).toBe(1);
    expect(submits()).toBe(1);
    controller.stop();
  });
});

describe("FC-007 H1 — authorized release survives", () => {
  it("CASE E: trusted Continue → exactly one authorized, unprevented generated event", async () => {
    const { controller, submits } = await reachVerified();
    const seen: MouseEvent[] = [];
    armExecutor(controller, seen);
    controller.invokeTrustedContinueForTest();
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(d.releaseCalls).toBe(1);
    expect(d.armCount).toBe(1);
    expect(d.executorCount).toBe(1);
    expect(d.authorizedReleaseCount).toBe(1);
    expect(d.consumptions).toBe(1);
    expect(d.retries).toBe(0);
    expect(d.fallbacks).toBe(0);
    expect(d.terminalOutcome).toBe("CONSUMED");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.isTrusted).toBe(false);
    expect(seen[0]?.defaultPrevented).toBe(false);
    expect(submits()).toBe(1);
    const g = controller.getActivationGuardDiagnosticsForTest();
    expect(g.blockedUnauthorizedActivations).toBe(0);
    expect(g.blockedUnauthorizedSubmits).toBe(0);
    controller.stop();
  });

  it("nested page click during the authorized dispatch is blocked by the release component", async () => {
    const { controller, finalButton } = await reachVerified();
    const nested: MouseEvent[] = [];
    controller.getReleaseComponentForTest().setTestExecutorForTest((btn) => {
      btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
      const n = syntheticClick(finalButton);
      nested.push(n);
      btn.dispatchEvent(n);
    });
    controller.invokeTrustedContinueForTest();
    expect(nested[0]?.defaultPrevented).toBe(true);
    const d = controller.getSprint3cDiagnosticsForTest();
    expect(d.consumptions).toBe(1);
    expect(d.authorizedReleaseCount).toBe(1);
    controller.stop();
  });
});

describe("FC-007 H1 — unrelated synthetic events are untouched", () => {
  it("CASE F: unrelated button click is neither prevented nor counted", async () => {
    const { controller, doc } = await setup();
    const otherForm = doc.createElement("form");
    const other = doc.createElement("button");
    other.type = "submit";
    otherForm.appendChild(other);
    doc.body.appendChild(otherForm);
    let otherSubmits = 0;
    otherForm.addEventListener("submit", (e) => {
      otherSubmits += 1;
      e.preventDefault();
    });
    const ev = syntheticClick(other);
    other.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(otherSubmits).toBe(1);
    const g = controller.getActivationGuardDiagnosticsForTest();
    expect(g.blockedUnauthorizedActivations).toBe(0);
    expect(g.blockedUnauthorizedSubmits).toBe(0);
    controller.stop();
  });

  it("unrelated click while VERIFIED is not prevented", async () => {
    const { controller, doc } = await reachVerified();
    const other = doc.createElement("button");
    other.type = "button";
    doc.body.appendChild(other);
    const ev = syntheticClick(other);
    other.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(controller.getPreviewMode()).toBe("verified");
    controller.stop();
  });
});

describe("FC-007 H1 — terminal / stale states", () => {
  async function expectPageClickBlocked(
    s: Awaited<ReturnType<typeof setup>>,
    releasesBefore: number,
  ): Promise<void> {
    const before = s.submits();
    s.finalButton.click();
    const ev = syntheticClick(s.finalButton);
    s.finalButton.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(s.submits()).toBe(before);
    expect(s.controller.getSprint3cDiagnosticsForTest().releaseCalls).toBe(releasesBefore);
  }

  it("after Cancel", async () => {
    const s = await reachVerified();
    s.controller.cancelPreviewForTest();
    await expectPageClickBlocked(s, 0);
    expectZeroRelease(s.controller);
    s.controller.stop();
  });

  it("after Escape", async () => {
    const s = await reachVerified();
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    humanEvents.add(esc);
    s.doc.dispatchEvent(esc);
    await vi.waitFor(() => expect(s.controller.getActiveDecisionForTest()).toBeNull());
    await expectPageClickBlocked(s, 0);
    expectZeroRelease(s.controller);
    s.controller.stop();
  });

  it("after consumed release (terminal): no second submit or release", async () => {
    const s = await reachVerified();
    armExecutor(s.controller);
    s.controller.invokeTrustedContinueForTest();
    expect(s.submits()).toBe(1);
    await expectPageClickBlocked(s, 1);
    expect(s.controller.getSprint3cDiagnosticsForTest().consumptions).toBe(1);
    s.controller.stop();
  });

  it("after modal closed by page", async () => {
    const s = await reachVerified();
    s.modal.open = false;
    s.modal.removeAttribute("open");
    await expectPageClickBlocked(s, 0);
    expectZeroRelease(s.controller);
    s.controller.stop();
  });

  it("after stale effects (validator fail)", async () => {
    const s = await reachVerified();
    s.controller.pauseFreshnessObserverForTest();
    const p = s.modal.querySelector(
      'div[role="region"][aria-label="Effects of making this repository public"] p',
    );
    if (p) p.textContent = "CHANGED REVIEWED EFFECTS MEANING";
    armExecutor(s.controller);
    s.controller.invokeTrustedContinueForTest();
    expect(s.controller.getSprint3cDiagnosticsForTest().releaseCalls).toBe(0);
    await expectPageClickBlocked(s, 0);
    s.controller.stop();
  });

  it("button detached then re-inserted: page click still blocked", async () => {
    const s = await reachVerified();
    const parent = s.finalButton.parentNode;
    const next = s.finalButton.nextSibling;
    s.finalButton.remove();
    await new Promise((r) => setTimeout(r, 0));
    parent?.insertBefore(s.finalButton, next);
    await expectPageClickBlocked(s, 0);
    s.controller.stop();
  });

  it("after stop(): FutureClick no longer intercepts (listener removed)", async () => {
    const s = await setup();
    s.controller.stop();
    const ev = syntheticClick(s.finalButton);
    s.finalButton.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
