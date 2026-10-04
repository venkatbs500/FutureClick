/**
 * FC-007 Sprint 2 — trusted Stage-D interception + Cancel-only preview.
 */

import { describe, expect, it, vi } from "vitest";
import {
  blockSupportedActivationEvent,
  eventTargetsRetainedFinalButton,
  passesTrustedActivationGates,
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

async function reachStageDEvaluated(options?: {
  readonly trustClickForTest?: (event: Event) => boolean;
}): Promise<{
  readonly controller: Fc007PassiveController;
  readonly document: Document;
  readonly finalButton: HTMLButtonElement;
  readonly form: HTMLFormElement;
}> {
  const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
  const controller = new Fc007PassiveController({
    document: doc,
    location,
    requireTopFrame: false,
    recognitionVersion: "v2",
    matchesModal: testMatchesModal,
    evaluateOnRecognize: true,
    ...(options?.trustClickForTest ? { trustClickForTest: options.trustClickForTest } : {}),
  });
  controller.start();
  await controller.attemptFullRecognition();
  expect(controller.getState().kind).toBe("evaluated");
  const finalButton = controller.getRetainedFinalButton();
  expect(finalButton).toBeInstanceOf(HTMLButtonElement);
  if (!(finalButton instanceof HTMLButtonElement)) {
    throw new Error("missing retained final");
  }
  const form = doc.getElementById("visibility-form");
  if (!(form instanceof HTMLFormElement)) throw new Error("missing form");
  return { controller, document: doc, finalButton, form };
}

describe("FC-007 Sprint 2 interception helpers", () => {
  it("trusted gates require isTrusted unless seam provided", () => {
    const base = {
      type: "click",
      isTrusted: true,
      cancelable: true,
      defaultPrevented: false,
    };
    expect(passesTrustedActivationGates(base)).toBe(true);
    expect(passesTrustedActivationGates({ ...base, isTrusted: false })).toBe(false);
    expect(passesTrustedActivationGates({ ...base, isTrusted: false }, () => true)).toBe(true);
  });

  it("blockSupportedActivationEvent prevents default and stops propagation", () => {
    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    const stopPropagation = vi.fn();
    blockSupportedActivationEvent({
      preventDefault,
      stopImmediatePropagation,
      stopPropagation,
    } as unknown as Event);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopImmediatePropagation).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });
});

describe("FC-007 Sprint 2 trusted Stage-D interception", () => {
  it("blocks trusted retained final activation and shows VERIFIED preview", async () => {
    const {
      controller,
      document: doc,
      finalButton,
      form,
    } = await reachStageDEvaluated({
      trustClickForTest: trustAll,
    });

    let pageClick = 0;
    let formSubmit = 0;
    let requestSubmit = 0;
    finalButton.addEventListener("click", () => {
      pageClick += 1;
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      formSubmit += 1;
    });
    const originalRequestSubmit = form.requestSubmit.bind(form);
    form.requestSubmit = ((...args: unknown[]) => {
      requestSubmit += 1;
      return originalRequestSubmit(...(args as []));
    }) as HTMLFormElement["requestSubmit"];

    const event = createCancelableClick(finalButton);
    controller.handleCaptureClickForTest(event);
    expect(event.defaultPrevented).toBe(true);

    // Allow async engine evaluation to complete past pending → VERIFIED.
    await vi.waitFor(() => {
      expect(controller.getPreviewMode()).toBe("verified");
    });
    expect(pageClick).toBe(0);
    expect(formSubmit).toBe(0);
    expect(requestSubmit).toBe(0);

    // Preview content is text-only from engine.
    const host = controller.getPreviewHostForTest();
    expect(host).toBeTruthy();
    const dialog = doc.getElementById("visibility-dialog");
    expect(dialog?.contains(host as Node)).toBe(true);
    expect(
      controller.getLastEvaluation()?.consequences[0]?.evidence.some((e) => e.mode === "verified"),
    ).toBe(true);
    expect(controller.isPreviewCancelFocusedForTest()).toBe(true);

    // No Continue control identity.
    expect(controller.cancelPreviewForTest).toBeTypeOf("function");
    controller.cancelPreviewForTest();
    expect(controller.isPreviewVisible()).toBe(false);
    expect(pageClick).toBe(0);
    expect(formSubmit).toBe(0);
    controller.stop();
  });

  it("untrusted dispatchEvent does not obtain preview authority and is blocked", async () => {
    const { controller, finalButton } = await reachStageDEvaluated();
    // Matching consequential activation is blocked unless it is the exact authorized
    // release event: an untrusted synthetic click gets no preview and no default action.
    const event = createCancelableClick(finalButton);
    expect(event.isTrusted === true).toBe(false);
    controller.handleCaptureClickForTest(event);
    await new Promise((r) => setTimeout(r, 50));
    expect(controller.isPreviewVisible()).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    controller.stop();
  });

  it("programmatic .click() does not obtain trusted preview authority", async () => {
    const { controller, finalButton } = await reachStageDEvaluated();
    finalButton.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(controller.isPreviewVisible()).toBe(false);
    controller.stop();
  });

  it("deep light-DOM descendant (5 levels) resolves via contains and is blocked", async () => {
    const { controller, finalButton } = await reachStageDEvaluated({
      trustClickForTest: trustAll,
    });
    // Preserve Stage-D own-text; nest empty spans as the click target.
    finalButton.textContent = "Make this repository public";
    let cur: HTMLElement = finalButton;
    let deepest: HTMLElement = finalButton;
    for (let i = 0; i < 5; i += 1) {
      const span = finalButton.ownerDocument.createElement("span");
      cur.appendChild(span);
      cur = span;
      deepest = span;
    }
    expect(eventTargetsRetainedFinalButton(createCancelableClick(deepest), finalButton)).toBe(true);
    const event = createCancelableClick(deepest);
    controller.handleCaptureClickForTest(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(controller.isPreviewVisible()).toBe(true));
    controller.stop();
  });

  it("wrong-target same-text button is not intercepted", async () => {
    const { controller, document: doc } = await reachStageDEvaluated({
      trustClickForTest: trustAll,
    });
    const decoy = doc.createElement("button");
    decoy.type = "submit";
    decoy.textContent = "Make this repository public";
    doc.body.appendChild(decoy);
    const event = createCancelableClick(decoy);
    controller.handleCaptureClickForTest(event);
    expect(event.defaultPrevented).toBe(false);
    expect(controller.isPreviewVisible()).toBe(false);
    controller.stop();
  });

  it("Stage B acknowledgement is not intercepted", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "b" });
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
      trustClickForTest: trustAll,
    });
    controller.start();
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("stage-recognized");
    expect(controller.getRetainedFinalButton()).toBeNull();
    const ack = doc.getElementById("stage-b-ack");
    expect(ack).toBeTruthy();
    if (!ack) return;
    const event = createCancelableClick(ack);
    controller.handleCaptureClickForTest(event);
    expect(event.defaultPrevented).toBe(false);
    expect(controller.isPreviewVisible()).toBe(false);
    controller.stop();
  });

  it("repeated trusted click while preview open stays blocked and singleton", async () => {
    const { controller, finalButton } = await reachStageDEvaluated({
      trustClickForTest: trustAll,
    });
    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
    expect(controller.isPreviewVisible()).toBe(true);
    controller.stop();
  });

  it("failed revalidation after block shows stopped preview, not VERIFIED", async () => {
    const {
      controller,
      document: doc,
      finalButton,
    } = await reachStageDEvaluated({
      trustClickForTest: trustAll,
    });
    // Ambiguous main before click handling completes revalidation.
    doc.body.appendChild(doc.createElement("main"));
    const event = createCancelableClick(finalButton);
    controller.handleCaptureClickForTest(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("stopped"));
    expect(controller.getPreviewMode()).not.toBe("verified");
    // Fail-closed block guard remains for the exact original button.
    expect(controller.getRetainedFinalButton()).toBe(finalButton);
    controller.stop();
  });

  it("LI escape after evaluated keeps block but not VERIFIED on intercept", async () => {
    const {
      controller,
      document: doc,
      finalButton,
    } = await reachStageDEvaluated({
      trustClickForTest: trustAll,
    });
    const main = doc.querySelector("main");
    const section = doc.getElementById("visibility-section");
    expect(main && section).toBeTruthy();
    if (!main || !(section instanceof HTMLLIElement)) return;
    const title = section.querySelector("strong");
    const priv = Array.from(section.querySelectorAll("div")).find(
      (d) =>
        d.childNodes.length === 1 &&
        d.textContent?.trim() === "This repository is currently private.",
    );
    expect(title && priv).toBeTruthy();
    if (!title || !priv) return;
    section.remove();
    while (main.firstChild) main.removeChild(main.firstChild);
    const titleWrap = doc.createElement("div");
    titleWrap.appendChild(title);
    main.appendChild(titleWrap);
    const outerLi = doc.createElement("li");
    const privateWrap = doc.createElement("div");
    privateWrap.appendChild(priv);
    outerLi.appendChild(main);
    outerLi.appendChild(privateWrap);
    doc.body.appendChild(outerLi);

    const event = createCancelableClick(finalButton);
    controller.handleCaptureClickForTest(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("stopped"));
    controller.stop();
  });

  it("stale preview dismisses on modal close mutation path", async () => {
    const {
      controller,
      document: doc,
      finalButton,
    } = await reachStageDEvaluated({
      trustClickForTest: trustAll,
    });
    controller.handleCaptureClickForTest(createCancelableClick(finalButton));
    await vi.waitFor(() => expect(controller.isPreviewVisible()).toBe(true));
    const dialog = doc.getElementById("visibility-dialog");
    expect(dialog).toBeTruthy();
    dialog?.remove();
    controller.handleMutationRecordsForTest([
      {
        type: "childList",
        target: doc.body,
        addedNodes: [] as unknown as NodeList,
        removedNodes: [dialog as Node] as unknown as NodeList,
        previousSibling: null,
        nextSibling: null,
        attributeName: null,
        attributeNamespace: null,
        oldValue: null,
      } as MutationRecord,
    ]);
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"));
    expect(controller.isPreviewVisible()).toBe(false);
    controller.stop();
  });

  it("duplicate start does not install duplicate interception listeners", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v2",
      matchesModal: testMatchesModal,
      trustClickForTest: trustAll,
    });
    controller.start();
    controller.start();
    await controller.attemptFullRecognition();
    const btn = controller.getRetainedFinalButton();
    expect(btn).toBeTruthy();
    if (!btn) return;
    let prevented = 0;
    const event = createCancelableClick(btn);
    const orig = event.preventDefault.bind(event);
    event.preventDefault = () => {
      prevented += 1;
      orig();
    };
    controller.handleCaptureClickForTest(event);
    expect(prevented).toBe(1);
    controller.stop();
  });
});
