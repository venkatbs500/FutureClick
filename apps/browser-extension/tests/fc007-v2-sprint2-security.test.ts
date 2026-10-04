/**
 * FC-007 Sprint 2 security-fix regressions (four Codex findings).
 *
 * Ordering-sensitive High findings use real DOM dispatch through the installed
 * document/window capture listener — not direct private-handler invocation alone.
 */

import { describe, expect, it, vi } from "vitest";
import {
  eventTargetsBlockButton,
  eventTargetsRetainedFinalButton,
} from "../src/fc007/interception.js";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
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

function nestDeepDescendant(button: HTMLButtonElement, depth: number): HTMLElement {
  const doc = button.ownerDocument;
  // Keep Stage-D own-text on the button; nest empty light-DOM spans for click target.
  button.textContent = "Make this repository public";
  let cur: HTMLElement = button;
  let deepest: HTMLElement = button;
  for (let i = 0; i < depth; i += 1) {
    const span = doc.createElement("span");
    span.setAttribute("data-depth", String(i + 1));
    cur.appendChild(span);
    cur = span;
    deepest = span;
  }
  return deepest;
}

async function reachStageDEvaluated(): Promise<{
  readonly controller: Fc007PassiveController;
  readonly document: Document;
  readonly finalButton: HTMLButtonElement;
  readonly form: HTMLFormElement;
  readonly dialog: HTMLDialogElement;
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
  });
  controller.start();
  await controller.attemptFullRecognition();
  expect(controller.getState().kind).toBe("evaluated");
  const finalButton = controller.getRetainedFinalButton();
  expect(finalButton).toBeInstanceOf(HTMLButtonElement);
  if (!(finalButton instanceof HTMLButtonElement)) throw new Error("missing final");
  const form = doc.getElementById("visibility-form");
  const dialog = doc.getElementById("visibility-dialog");
  if (!(form instanceof HTMLFormElement)) throw new Error("missing form");
  if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
  return { controller, document: doc, finalButton, form, dialog };
}

describe("FC-007 Sprint 2 security — High 1 deep descendant", () => {
  it("eventTargetsBlockButton accepts any light-DOM depth via contains", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const button = doc.createElement("button");
    const deepest = nestDeepDescendant(button, 5);
    doc.body.appendChild(button);
    expect(eventTargetsBlockButton(createCancelableClick(deepest), button)).toBe(true);
    expect(eventTargetsRetainedFinalButton(createCancelableClick(deepest), button)).toBe(true);
  });

  it("five-level descendant: real dispatch blocks before page ancestor capture", async () => {
    const { controller, document: doc, finalButton, form, dialog } = await reachStageDEvaluated();
    const deepest = nestDeepDescendant(finalButton, 5);
    // Allow MutationObserver delivery from nesting to settle before activation.
    await new Promise((r) => setTimeout(r, 30));

    let pageTarget = 0;
    let pageButton = 0;
    let pageAncestorCapture = 0;
    let formSubmit = 0;

    deepest.addEventListener("click", () => {
      pageTarget += 1;
    });
    finalButton.addEventListener("click", () => {
      pageButton += 1;
    });
    dialog.addEventListener(
      "click",
      () => {
        pageAncestorCapture += 1;
      },
      true,
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      formSubmit += 1;
    });

    // Real dispatch through installed document-capture listener (not private handler).
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
    deepest.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(pageTarget).toBe(0);
    expect(pageButton).toBe(0);
    expect(pageAncestorCapture).toBe(0);
    expect(formSubmit).toBe(0);

    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    const host = controller.getPreviewHostForTest();
    expect(host).toBeTruthy();
    expect(dialog.contains(host as Node)).toBe(true);
    controller.stop();
  });
});

describe("FC-007 Sprint 2 security — High 2 stale-repeat block guard", () => {
  it("second trusted click after failed revalidation remains blocked", async () => {
    const { controller, document: doc, finalButton, form, dialog } = await reachStageDEvaluated();

    let target1 = 0;
    let ancestor1 = 0;
    let submit = 0;
    finalButton.addEventListener("click", () => {
      target1 += 1;
    });
    dialog.addEventListener(
      "click",
      () => {
        ancestor1 += 1;
      },
      true,
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit += 1;
    });

    // Invalidate Stage-D uniqueness (second main) while original surface remains.
    doc.body.appendChild(doc.createElement("main"));

    const first = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
    finalButton.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("stopped"));
    expect(controller.getPreviewMode()).not.toBe("verified");
    // Block guard retained.
    expect(controller.getRetainedFinalButton()).toBe(finalButton);

    const beforeTarget = target1;
    const beforeAncestor = ancestor1;
    const beforeSubmit = submit;

    const second = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
    finalButton.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    expect(target1).toBe(beforeTarget);
    expect(ancestor1).toBe(beforeAncestor);
    expect(submit).toBe(beforeSubmit);
    expect(target1).toBe(0);
    expect(ancestor1).toBe(0);
    expect(submit).toBe(0);
    controller.stop();
  });
});

describe("FC-007 Sprint 2 security — Medium 1 modal preview placement", () => {
  it("preview host mounts inside active dialog; Cancel focused in closed shadow", async () => {
    const { controller, finalButton, dialog } = await reachStageDEvaluated();
    finalButton.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }),
    );
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    const host = controller.getPreviewHostForTest();
    expect(host).toBeTruthy();
    expect(dialog.contains(host as Node)).toBe(true);
    expect(controller.isPreviewCancelFocusedForTest()).toBe(true);
    controller.cancelPreviewForTest();
    expect(controller.getPreviewMode()).toBe("hidden");
    controller.stop();
  });
});

describe("FC-007 Sprint 2 security — Medium 2 automatic VERIFIED freshness", () => {
  async function openVerified() {
    const ctx = await reachStageDEvaluated();
    ctx.finalButton.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }),
    );
    await vi.waitFor(() => expect(ctx.controller.getPreviewMode()).toBe("verified"));
    return ctx;
  }

  it("second main automatically demotes VERIFIED without getter", async () => {
    const { controller, document: doc } = await openVerified();
    doc.body.appendChild(doc.createElement("main"));
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("disabled final button automatically demotes VERIFIED", async () => {
    const { controller, finalButton } = await openVerified();
    finalButton.disabled = true;
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("form action change automatically demotes VERIFIED", async () => {
    const { controller, form } = await openVerified();
    form.setAttribute("action", "https://github.com/fixture-owner/fixture-repo/settings/other");
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("form replacement automatically demotes VERIFIED", async () => {
    const { controller, document: doc, form, dialog } = await openVerified();
    const replacement = form.cloneNode(true);
    form.remove();
    dialog.appendChild(replacement);
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    expect(doc.contains(form)).toBe(false);
    controller.stop();
  });

  it("final button replacement automatically demotes VERIFIED", async () => {
    const { controller, finalButton, form, dialog } = await openVerified();
    const clone = dialog.ownerDocument.createElement("button");
    clone.type = "submit";
    clone.id = "final-make-public-clone";
    clone.textContent = "Make this repository public";
    finalButton.remove();
    form.appendChild(clone);
    expect(clone.parentNode).toBe(form);
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("modal close automatically demotes VERIFIED", async () => {
    const { controller, dialog } = await openVerified();
    dialog.open = false;
    dialog.removeAttribute("open");
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("effects text change automatically demotes VERIFIED", async () => {
    const { controller, dialog } = await openVerified();
    const effects = dialog.querySelector(
      '[role="region"][aria-label="Effects of making this repository public"]',
    );
    expect(effects).toBeTruthy();
    if (effects) {
      effects.textContent = "Changed effects contract text that should invalidate.";
    }
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("route identity change via locationProvider demotes VERIFIED", async () => {
    let pathname = "/fixture-owner/fixture-repo/settings";
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      locationProvider: () => ({
        protocol: "https:",
        hostname: "github.com",
        port: "",
        pathname,
      }),
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: true,
      trustClickForTest: trustAll,
    });
    controller.start();
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("evaluated");
    const btn = controller.getRetainedFinalButton();
    expect(btn).toBeTruthy();
    if (!btn) return;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    pathname = "/fixture-owner/fixture-repo/settings/branches";
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("stale async evaluation cannot restore VERIFIED after invalidation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { document: doc2, location: loc2 } = createFc007V2SettingsWindow({ stage: "d" });
    const { ConsequenceEngine, createDeterministicRuleEvaluator } = await import(
      "@futureclick/consequence-engine"
    );
    const engine = new ConsequenceEngine();
    engine.registerEvaluator(createDeterministicRuleEvaluator());
    const controller = new Fc007PassiveController({
      document: doc2,
      location: loc2,
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: false,
      trustClickForTest: trustAll,
      evaluateFn: async (ctx) => {
        await gate;
        return engine.evaluate(ctx);
      },
    });
    controller.start();
    await controller.attemptFullRecognition();
    const btn = controller.getRetainedFinalButton();
    expect(btn).toBeTruthy();
    if (!btn) return;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    doc2.body.appendChild(doc2.createElement("main"));
    release();
    await new Promise((r) => setTimeout(r, 80));
    expect(controller.getPreviewMode()).not.toBe("verified");
    controller.stop();
  });
});
