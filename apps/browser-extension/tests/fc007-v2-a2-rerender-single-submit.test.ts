/**
 * FC-007 Session A2.
 *
 * H2: a Stage-D re-render while VERIFIED or while evaluation is pending must destroy the old
 * authority, ignore stale async results, re-run recognition, and move the guard to the current
 * button so a later human activation is intercepted and previewed.
 *
 * M1: one trusted Continue yields at most one guarded consequential submit (exactly one on the
 * normal path), even when page handlers nest activations inside the authorized dispatch.
 *
 * Trust is granted only to test-marked events (stand-in for a real human click). Form submit
 * listeners only count; a submit reaching the form is a real submission.
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

function nonCancelableClick(): MouseEvent {
  return new MouseEvent("click", { bubbles: true, cancelable: false, composed: true });
}

type Setup = {
  readonly controller: Fc007PassiveController;
  readonly doc: Document;
  readonly modal: HTMLDialogElement;
  /** Submits whose submitter is the #final-make-public button of any render. */
  readonly submits: () => number;
};

async function setup(): Promise<Setup> {
  const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
  const controller = new Fc007PassiveController({
    document: doc,
    location,
    requireTopFrame: false,
    recognitionVersion: "v2",
    matchesModal: testMatchesModal,
    evaluateOnRecognize: true,
    trustClickForTest: (event) =>
      humanEvents.has(event) ||
      (!(event instanceof Event) && (event as { isTrusted?: unknown }).isTrusted === true),
  });
  controller.start();
  await controller.attemptFullRecognition();
  const modal = doc.getElementById("visibility-dialog");
  if (!(modal instanceof HTMLDialogElement)) throw new Error("no modal");
  let submitCount = 0;
  doc.addEventListener("submit", (event) => {
    const submitter = (event as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.id === "final-make-public") {
      submitCount += 1;
    }
  });
  return { controller, doc, modal, submits: () => submitCount };
}

function currentFinal(doc: Document): HTMLButtonElement {
  const b = doc.getElementById("final-make-public");
  if (!(b instanceof HTMLButtonElement)) throw new Error("no final");
  return b;
}

/** Page-style Stage-D re-render: replace the form (and its final button) with a fresh copy. */
function rerenderStageD(doc: Document): HTMLButtonElement {
  const form = doc.getElementById("visibility-form");
  if (!(form instanceof HTMLFormElement)) throw new Error("no form");
  form.replaceWith(form.cloneNode(true));
  return currentFinal(doc);
}

async function reachVerified(s: Setup): Promise<void> {
  const btn = s.controller.getRetainedFinalButton();
  if (!btn) throw new Error("no guard");
  s.controller.handleCaptureClickForTest(humanClick(btn));
  await vi.waitFor(() => expect(s.controller.getPreviewMode()).toBe("verified"));
}

function armExecutor(controller: Fc007PassiveController): void {
  controller.getReleaseComponentForTest().setTestExecutorForTest((btn) => {
    btn.dispatchEvent(createClickEventWithTrustForTest(btn, false));
  });
}

async function expectGuardMovedTo(s: Setup, replacement: HTMLButtonElement): Promise<void> {
  await vi.waitFor(() => expect(s.controller.getRetainedFinalButton()).toBe(replacement));
}

function expectReplacementPageClickBlocked(s: Setup, replacement: HTMLButtonElement): void {
  const before = s.submits();
  replacement.click();
  const nc = nonCancelableClick();
  replacement.dispatchEvent(nc);
  expect(s.submits()).toBe(before);
}

describe("FC-007 A2 / H2 — VERIFIED re-render", () => {
  it("demotes, re-recognizes, guards the replacement; human click is intercepted and previewed", async () => {
    const s = await setup();
    await reachVerified(s);
    const oldDecision = s.controller.getActiveDecisionForTest();
    expect(oldDecision).not.toBeNull();

    const replacement = rerenderStageD(s.doc);
    await vi.waitFor(() => expect(s.controller.getPreviewMode()).not.toBe("verified"));
    expect(s.controller.getActiveDecisionForTest()).toBeNull();
    await expectGuardMovedTo(s, replacement);
    expect(s.controller.getActivationGuardDiagnosticsForTest().recoveryRecognitionRuns).toBe(1);

    expectReplacementPageClickBlocked(s, replacement);

    const human = humanClick(replacement);
    s.controller.handleCaptureClickForTest(human);
    expect(human.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(s.controller.getPreviewMode()).toBe("verified"));
    const fresh = s.controller.getActiveDecisionForTest();
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(oldDecision);
    expect(fresh?.finalButton).toBe(replacement);
    expect(s.submits()).toBe(0);
    expect(s.controller.getSprint3cDiagnosticsForTest().releaseCalls).toBe(0);

    armExecutor(s.controller);
    s.controller.invokeTrustedContinueForTest();
    expect(s.submits()).toBe(1);
    s.controller.stop();
  });

  it("old detached button stays blocked after recovery (no resurrection of authority)", async () => {
    const s = await setup();
    const original = currentFinal(s.doc);
    await reachVerified(s);
    const replacement = rerenderStageD(s.doc);
    await expectGuardMovedTo(s, replacement);
    original.click();
    expect(s.submits()).toBe(0);
    expect(s.controller.getSprint3cDiagnosticsForTest().releaseCalls).toBe(0);
    s.controller.stop();
  });
});

describe("FC-007 A2 / H2 — pending re-render", () => {
  it("stale in-flight evaluation is ignored; replacement guarded; human click previewed", async () => {
    const s = await setup();
    const original = s.controller.getRetainedFinalButton();
    if (!original) throw new Error("no guard");
    s.controller.armEvalDelayForTest();
    s.controller.handleCaptureClickForTest(humanClick(original));
    await vi.waitFor(() => expect(s.controller.getPreviewMode()).toBe("pending"));

    const replacement = rerenderStageD(s.doc);
    await expectGuardMovedTo(s, replacement);
    expect(s.controller.getPreviewMode()).not.toBe("pending");
    expect(s.controller.getActivationGuardDiagnosticsForTest().recoveryRecognitionRuns).toBe(1);

    // Let the stale (and recovery) evaluations finish: the stale result must not publish.
    s.controller.releaseEvalDelayForTest();
    await new Promise((r) => setTimeout(r, 30));
    expect(s.controller.getPreviewMode()).not.toBe("verified");
    expect(s.controller.getActiveDecisionForTest()).toBeNull();
    expect(s.controller.getRetainedFinalButton()).toBe(replacement);

    expectReplacementPageClickBlocked(s, replacement);

    s.controller.handleCaptureClickForTest(humanClick(replacement));
    await vi.waitFor(() => expect(s.controller.getPreviewMode()).toBe("verified"));
    expect(s.controller.getActiveDecisionForTest()?.finalButton).toBe(replacement);
    expect(s.submits()).toBe(0);
    s.controller.stop();
  });
});

describe("FC-007 A2 / H2 — repeated re-renders", () => {
  it("each valid re-render leaves exactly one guard on the current button and one preview", async () => {
    const s = await setup();
    let current = currentFinal(s.doc);
    for (let i = 0; i < 3; i += 1) {
      await reachVerified(s);
      const before = s.controller.getActiveDecisionForTest();
      current = rerenderStageD(s.doc);
      await expectGuardMovedTo(s, current);
      expect(s.controller.getActiveDecisionForTest()).toBeNull();
      expect(before).not.toBeNull();
      expectReplacementPageClickBlocked(s, current);
      expect(s.doc.querySelectorAll("#final-make-public")).toHaveLength(1);
    }
    expect(s.controller.getActivationGuardDiagnosticsForTest().recoveryRecognitionRuns).toBe(3);

    // Back-to-back re-renders in one task coalesce into one recovery run.
    await reachVerified(s);
    rerenderStageD(s.doc);
    current = rerenderStageD(s.doc);
    await expectGuardMovedTo(s, current);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.controller.getActivationGuardDiagnosticsForTest().recoveryRecognitionRuns).toBe(4);

    s.controller.handleCaptureClickForTest(humanClick(current));
    await vi.waitFor(() => expect(s.controller.getPreviewMode()).toBe("verified"));
    expect(s.controller.getActiveDecisionForTest()?.finalButton).toBe(current);
    expect(s.controller.isPreviewVisible()).toBe(true);
    expect(s.controller.getPreviewHostForTest()?.isConnected).toBe(true);
    expect(s.submits()).toBe(0);
    s.controller.stop();
  });

  it("recovery does not loop while idle (no recognition runs without surface change)", async () => {
    const s = await setup();
    await reachVerified(s);
    rerenderStageD(s.doc);
    await vi.waitFor(() =>
      expect(s.controller.getActivationGuardDiagnosticsForTest().recoveryRecognitionRuns).toBe(1),
    );
    const seq = s.controller.getInvalidationCounters().requestSequence;
    await new Promise((r) => setTimeout(r, 450));
    expect(s.controller.getActivationGuardDiagnosticsForTest().recoveryRecognitionRuns).toBe(1);
    expect(s.controller.getInvalidationCounters().requestSequence).toBe(seq);
    s.controller.stop();
  });

  it("Continue validation failure does not schedule recovery", async () => {
    const s = await setup();
    await reachVerified(s);
    s.controller.pauseFreshnessObserverForTest();
    const p = s.modal.querySelector(
      'div[role="region"][aria-label="Effects of making this repository public"] p',
    );
    if (p) p.textContent = "CHANGED REVIEWED EFFECTS MEANING";
    armExecutor(s.controller);
    s.controller.invokeTrustedContinueForTest();
    await new Promise((r) => setTimeout(r, 10));
    expect(s.controller.getSprint3cDiagnosticsForTest().releaseCalls).toBe(0);
    expect(s.controller.getActivationGuardDiagnosticsForTest().recoveryRecognitionRuns).toBe(0);
    s.controller.stop();
  });
});

describe("FC-007 A2 / M1 — single guarded submit per Continue", () => {
  async function releaseWithPageHandler(
    attack: (btn: HTMLButtonElement, s: Setup) => void,
  ): Promise<{ s: Setup; submits: number }> {
    const s = await setup();
    await reachVerified(s);
    const btn = currentFinal(s.doc);
    let armed = true;
    btn.addEventListener("click", () => {
      if (!armed) return;
      armed = false;
      attack(btn, s);
    });
    armExecutor(s.controller);
    s.controller.invokeTrustedContinueForTest();
    return { s, submits: s.submits() };
  }

  function expectSingleRelease(s: Setup): void {
    const d = s.controller.getSprint3cDiagnosticsForTest();
    expect(d.releaseCalls).toBe(1);
    expect(d.armCount).toBe(1);
    expect(d.executorCount).toBe(1);
    expect(d.authorizedReleaseCount).toBe(1);
    expect(d.consumptions).toBe(1);
    expect(d.retries).toBe(0);
    expect(s.controller.getActivationGuardDiagnosticsForTest().releaseSubmitAllowance).toBe("none");
  }

  it("normal path: exactly one guarded submit", async () => {
    const s = await setup();
    await reachVerified(s);
    armExecutor(s.controller);
    s.controller.invokeTrustedContinueForTest();
    expect(s.submits()).toBe(1);
    expectSingleRelease(s);
    const g = s.controller.getActivationGuardDiagnosticsForTest();
    expect(g.allowedReleaseSubmits).toBe(1);
    expect(g.blockedUnauthorizedSubmits).toBe(0);
  });

  it("one nested non-cancelable click → exactly one submit", async () => {
    const { s, submits } = await releaseWithPageHandler((btn) => {
      btn.dispatchEvent(nonCancelableClick());
    });
    expect(submits).toBe(1);
    expectSingleRelease(s);
    const g = s.controller.getActivationGuardDiagnosticsForTest();
    expect(g.allowedReleaseSubmits).toBe(1);
    expect(g.blockedUnauthorizedSubmits).toBe(1);
  });

  it("three nested non-cancelable clicks → exactly one submit", async () => {
    const { s, submits } = await releaseWithPageHandler((btn) => {
      for (let i = 0; i < 3; i += 1) btn.dispatchEvent(nonCancelableClick());
    });
    expect(submits).toBe(1);
    expectSingleRelease(s);
    expect(s.controller.getActivationGuardDiagnosticsForTest().blockedUnauthorizedSubmits).toBe(3);
  });

  it("nested requestSubmit(finalButton) → exactly one submit", async () => {
    const { s, submits } = await releaseWithPageHandler((btn) => {
      btn.form?.requestSubmit(btn);
    });
    expect(submits).toBe(1);
    expectSingleRelease(s);
    expect(s.controller.getActivationGuardDiagnosticsForTest().blockedUnauthorizedSubmits).toBe(1);
  });

  it("nested descendant non-cancelable click → exactly one submit", async () => {
    const { s, submits } = await releaseWithPageHandler((btn) => {
      const span = btn.ownerDocument.createElement("span");
      btn.appendChild(span);
      span.dispatchEvent(nonCancelableClick());
    });
    expect(submits).toBe(1);
    expectSingleRelease(s);
  });

  it("unrelated form submitted during release is unaffected", async () => {
    let otherSubmits = 0;
    const { s, submits } = await releaseWithPageHandler((_btn, setupRef) => {
      const otherForm = setupRef.doc.createElement("form");
      const other = setupRef.doc.createElement("button");
      other.type = "submit";
      otherForm.appendChild(other);
      setupRef.doc.body.appendChild(otherForm);
      otherForm.addEventListener("submit", (e) => {
        otherSubmits += 1;
        e.preventDefault();
      });
      otherForm.requestSubmit(other);
    });
    expect(otherSubmits).toBe(1);
    expect(submits).toBe(1);
    expectSingleRelease(s);
  });

  it("stop() inside the authorized dispatch: nested activation still cannot add a submit", async () => {
    const { s, submits } = await releaseWithPageHandler((btn, setupRef) => {
      setupRef.controller.stop();
      btn.dispatchEvent(nonCancelableClick());
      btn.form?.requestSubmit(btn);
    });
    expect(submits).toBeLessThanOrEqual(1);
    expect(s.controller.getSprint3cDiagnosticsForTest().consumptions).toBe(1);
    // Release window closed: the kept submit listener is gone and nothing intercepts any more.
    const after = currentFinal(s.doc);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    after.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("no authorized click (executor submits directly) → allowance never opens; zero submits", async () => {
    const s = await setup();
    await reachVerified(s);
    s.controller.getReleaseComponentForTest().setTestExecutorForTest((btn) => {
      btn.form?.requestSubmit(btn);
    });
    s.controller.invokeTrustedContinueForTest();
    expect(s.submits()).toBe(0);
    expect(s.controller.getActivationGuardDiagnosticsForTest().allowedReleaseSubmits).toBe(0);
    s.controller.stop();
  });

  it("after the release window, page activation of the released button is blocked", async () => {
    const s = await setup();
    await reachVerified(s);
    armExecutor(s.controller);
    s.controller.invokeTrustedContinueForTest();
    expect(s.submits()).toBe(1);
    const btn = currentFinal(s.doc);
    btn.click();
    btn.dispatchEvent(nonCancelableClick());
    btn.form?.requestSubmit(btn);
    expect(s.submits()).toBe(1);
    s.controller.stop();
  });
});
