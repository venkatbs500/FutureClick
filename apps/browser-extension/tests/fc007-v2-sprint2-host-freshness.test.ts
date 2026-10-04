/**
 * FC-007 Sprint 2 final medium fixes — host freshness + attribute observation.
 */

import { describe, expect, it, vi } from "vitest";
import { DIALOG_MAX_ELEMENTS } from "../src/fc007/budget.js";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import { ownedPreviewHostInvariantFailure } from "../src/fc007/preview-host.js";
import { createFc007V2SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

function trustAll(event: Event): boolean {
  return event.type === "click" || event.type === "keydown";
}

function countElements(root: Element): number {
  let n = 0;
  const walk = (el: Element): void => {
    n += 1;
    const children = el.children;
    for (let i = 0; i < children.length; i += 1) {
      const c = children.item(i);
      if (c) walk(c);
    }
  };
  walk(root);
  return n;
}

function padDialogToPageBudget(dialog: HTMLDialogElement, targetPageCount: number): void {
  const doc = dialog.ownerDocument;
  let count = countElements(dialog);
  if (count >= targetPageCount) return;

  // Nest padding so dialog direct-child own-text limits (32) are not hit before
  // the approved page element budget (64).
  const bucket = doc.createElement("div");
  const form = doc.getElementById("visibility-form");
  if (form && form.parentElement === dialog) {
    dialog.insertBefore(bucket, form);
  } else if (dialog.firstChild) {
    dialog.insertBefore(bucket, dialog.firstChild);
  } else {
    dialog.appendChild(bucket);
  }
  count += 1;
  let current: Element = bucket;
  while (count < targetPageCount) {
    if (current.childElementCount >= 16) {
      const next = doc.createElement("div");
      current.appendChild(next);
      current = next;
      count += 1;
      if (count >= targetPageCount) break;
    }
    current.appendChild(doc.createElement("span"));
    count += 1;
  }
}

async function openVerified(): Promise<{
  readonly controller: Fc007PassiveController;
  readonly document: Document;
  readonly finalButton: HTMLButtonElement;
  readonly form: HTMLFormElement;
  readonly dialog: HTMLDialogElement;
  readonly location: ReturnType<typeof createFc007V2SettingsWindow>["location"];
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
  const form = doc.getElementById("visibility-form");
  const dialog = doc.getElementById("visibility-dialog");
  if (!(finalButton instanceof HTMLButtonElement)) throw new Error("missing button");
  if (!(form instanceof HTMLFormElement)) throw new Error("missing form");
  if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
  finalButton.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }),
  );
  await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("verified"));
  return { controller, document: doc, finalButton, form, dialog, location };
}

describe("FC-007 Sprint 2 medium A — attribute freshness", () => {
  it("effects aria-label change auto-invalidates VERIFIED", async () => {
    const { controller, dialog } = await openVerified();
    const effects = dialog.querySelector('[role="region"]');
    expect(effects).toBeTruthy();
    expect(effects?.getAttribute("aria-label")).toBe("Effects of making this repository public");
    effects?.setAttribute("aria-label", "Effects of something else");
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("final submitter nonempty name auto-invalidates VERIFIED", async () => {
    const { controller, finalButton } = await openVerified();
    finalButton.setAttribute("name", "commit");
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("aria-disabled auto-invalidates VERIFIED", async () => {
    const { controller, finalButton } = await openVerified();
    finalButton.setAttribute("aria-disabled", "true");
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("disabled auto-invalidates VERIFIED", async () => {
    const { controller, finalButton } = await openVerified();
    finalButton.disabled = true;
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("form action change auto-invalidates VERIFIED", async () => {
    const { controller, form } = await openVerified();
    form.setAttribute("action", "https://github.com/fixture-owner/fixture-repo/settings/other");
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });
});

describe("FC-007 Sprint 2 medium B — owned preview host", () => {
  it("host role mutation auto-invalidates VERIFIED", async () => {
    const { controller } = await openVerified();
    const host = controller.getPreviewHostForTest();
    expect(host).toBeTruthy();
    host?.setAttribute("role", "button");
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("host light-DOM child auto-invalidates VERIFIED", async () => {
    const { controller, document: doc } = await openVerified();
    const host = controller.getPreviewHostForTest();
    expect(host).toBeTruthy();
    host?.appendChild(doc.createElement("span"));
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("host replacement auto-invalidates VERIFIED", async () => {
    const { controller, dialog, document: doc } = await openVerified();
    const host = controller.getPreviewHostForTest();
    expect(host).toBeTruthy();
    const lookalike = doc.createElement("div");
    host?.replaceWith(lookalike);
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    expect(dialog.contains(lookalike)).toBe(true);
    controller.stop();
  });

  it("host move outside modal auto-invalidates VERIFIED", async () => {
    const { controller, document: doc } = await openVerified();
    const host = controller.getPreviewHostForTest();
    expect(host).toBeTruthy();
    doc.body.appendChild(host as Node);
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    controller.stop();
  });

  it("exact dialog page budget + owned host validates; lookalike does not", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = doc.getElementById("visibility-dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");

    const before = countElements(dialog);
    expect(before).toBeLessThanOrEqual(DIALOG_MAX_ELEMENTS);
    padDialogToPageBudget(dialog, DIALOG_MAX_ELEMENTS);
    expect(countElements(dialog)).toBe(DIALOG_MAX_ELEMENTS);

    const pre = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(
      pre.status === "matched"
        ? "matched"
        : `abstain:${pre.status === "abstain" ? pre.reason : "?"}`,
    ).toBe("matched");

    const owned = doc.createElement("div");
    const form = doc.getElementById("visibility-form");
    if (form && form.parentElement === dialog) dialog.insertBefore(owned, form);
    else dialog.insertBefore(owned, dialog.firstChild);
    expect(ownedPreviewHostInvariantFailure(owned, dialog, doc)).toBeNull();

    const withHost = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ownedPreviewHost: owned,
    });
    expect(withHost.status === "matched" ? "matched" : `abstain:${withHost.reason}`).toBe(
      "matched",
    );

    const lookalike = doc.createElement("div");
    if (form && form.parentElement === dialog) dialog.insertBefore(lookalike, form);
    else dialog.insertBefore(lookalike, dialog.firstChild);
    const over = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ownedPreviewHost: owned,
    });
    expect(over.status).toBe("abstain");
  });

  it("cap +1 page element fails even with owned host", async () => {
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    const dialog = doc.getElementById("visibility-dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
    padDialogToPageBudget(dialog, DIALOG_MAX_ELEMENTS + 1);
    const owned = doc.createElement("div");
    const form = doc.getElementById("visibility-form");
    if (form && form.parentElement === dialog) dialog.insertBefore(owned, form);
    else dialog.insertBefore(owned, dialog.firstChild);
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ownedPreviewHost: owned,
    });
    expect(result.status).toBe("abstain");
  });

  it("stale async result after host role mutation cannot VERIFIED", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { document: doc, location } = createFc007V2SettingsWindow({ stage: "d" });
    const { ConsequenceEngine, createDeterministicRuleEvaluator } = await import(
      "@futureclick/consequence-engine"
    );
    const engine = new ConsequenceEngine();
    engine.registerEvaluator(createDeterministicRuleEvaluator());
    const controller = new Fc007PassiveController({
      document: doc,
      location,
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
    await vi.waitFor(() => expect(controller.getPreviewMode()).toBe("pending"));
    const host = controller.getPreviewHostForTest();
    host?.setAttribute("role", "button");
    release();
    await new Promise((r) => setTimeout(r, 80));
    expect(controller.getPreviewMode()).not.toBe("verified");
    controller.stop();
  });
});
