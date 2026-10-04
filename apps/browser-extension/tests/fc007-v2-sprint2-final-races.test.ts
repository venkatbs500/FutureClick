/**
 * FC-007 Sprint 2 final High (pending form race) + Medium (own-text bounds).
 */

import { describe, expect, it, vi } from "vitest";
import { DIALOG_MAX_ELEMENTS } from "../src/fc007/budget.js";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import { normalizedOwnText } from "../src/fc007/own-text.js";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import { ownedPreviewHostInvariantFailure } from "../src/fc007/preview-host.js";
import { createFc007V2SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

function trustAll(event: Event): boolean {
  return event.type === "click" || event.type === "keydown";
}

describe("FC-007 Sprint 2 final — pending form race High", () => {
  it("pending form replacement cannot publish VERIFIED; button remains blocked", async () => {
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

    const oldForm = doc.getElementById("visibility-form");
    expect(oldForm).toBeTruthy();
    if (!(oldForm instanceof HTMLFormElement)) throw new Error("missing form");

    const newForm = doc.createElement("form");
    newForm.id = "visibility-form";
    newForm.method = oldForm.method;
    newForm.setAttribute("action", oldForm.getAttribute("action") || "");
    newForm.setAttribute("enctype", oldForm.getAttribute("enctype") || "");
    while (oldForm.firstChild) {
      newForm.appendChild(oldForm.firstChild);
    }
    oldForm.replaceWith(newForm);
    expect(doc.contains(oldForm)).toBe(false);
    expect(newForm.contains(btn)).toBe(true);

    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("pending"), {
      timeout: 3000,
    });
    expect(controller.getPreviewMode()).not.toBe("verified");

    release();
    await new Promise((r) => setTimeout(r, 80));
    expect(controller.getPreviewMode()).not.toBe("verified");
    expect(controller.getLastEvaluation()).toBeNull();

    // Fail-closed: exact button still blocked after form disconnect.
    let submit = 0;
    let ancestor = 0;
    newForm.addEventListener("submit", (e) => {
      submit += 1;
      e.preventDefault();
    });
    doc.addEventListener(
      "click",
      () => {
        ancestor += 1;
      },
      true,
    );
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(submit).toBe(0);
    expect(ancestor).toBe(0);

    controller.stop();
  });

  it("pending form action mutation cannot publish VERIFIED", async () => {
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
    const form = doc.getElementById("visibility-form");
    form?.setAttribute("action", "https://github.com/fixture-owner/fixture-repo/settings/other");
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    release();
    await new Promise((r) => setTimeout(r, 80));
    expect(controller.getPreviewMode()).not.toBe("verified");
    controller.stop();
  });

  it("pending second main cannot publish VERIFIED", async () => {
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
    doc.body.appendChild(doc.createElement("main"));
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    release();
    await new Promise((r) => setTimeout(r, 80));
    expect(controller.getPreviewMode()).not.toBe("verified");
    controller.stop();
  });

  it("pending button replacement cannot publish VERIFIED", async () => {
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
    const lookalike = doc.createElement("button");
    lookalike.type = "submit";
    lookalike.id = "final-make-public";
    lookalike.textContent = "Make this repository public";
    btn.replaceWith(lookalike);
    await vi.waitFor(() => expect(controller.getPreviewMode()).not.toBe("verified"), {
      timeout: 3000,
    });
    release();
    await new Promise((r) => setTimeout(r, 80));
    expect(controller.getPreviewMode()).not.toBe("verified");
    controller.stop();
  });
});

describe("FC-007 Sprint 2 final — own-text boundedness Medium", () => {
  it("10_000 children: CHILD_NODES_EXCEEDED with bounded direct-child walk", () => {
    const div = document.createElement("div");
    for (let i = 0; i < 10_000; i += 1) {
      div.appendChild(document.createComment("c"));
    }
    const counter = { count: 0 };
    const r = normalizedOwnText(div, undefined, { inspectionCounter: counter });
    expect(r).toEqual({ status: "over_budget", reason: "CHILD_NODES_EXCEEDED" });
    expect(counter.count).toBe(33);
  });

  it("10_000 page children + owned host: still bounded direct-child walk", () => {
    const parent = document.createElement("div");
    const dialog = document.createElement("dialog");
    document.body.appendChild(dialog);
    const host = document.createElement("div");
    dialog.appendChild(host);
    // Inspect dialog-like parent with many comments + host as exclude child of parent.
    const wrap = document.createElement("div");
    for (let i = 0; i < 10_000; i += 1) {
      wrap.appendChild(document.createComment("c"));
    }
    wrap.appendChild(host);
    const counter = { count: 0 };
    const r = normalizedOwnText(wrap, undefined, {
      excludeChild: host,
      inspectionCounter: counter,
    });
    expect(r).toEqual({ status: "over_budget", reason: "CHILD_NODES_EXCEEDED" });
    // Overflow on 33rd page child (host not yet reached); never scans 10k.
    expect(counter.count).toBe(33);
    dialog.remove();
  });

  it("exact 32 page children pass child-count bound", () => {
    const div = document.createElement("div");
    for (let i = 0; i < 32; i += 1) {
      div.appendChild(document.createComment("c"));
    }
    const counter = { count: 0 };
    const r = normalizedOwnText(div, undefined, { inspectionCounter: counter });
    expect(r.status).toBe("empty");
    expect(counter.count).toBe(32);
  });

  it("exact 32 page children + direct owned host accepted for child count", () => {
    const div = document.createElement("div");
    for (let i = 0; i < 32; i += 1) {
      div.appendChild(document.createComment("c"));
    }
    const host = document.createElement("div");
    div.appendChild(host);
    expect(div.childNodes.length).toBe(33);
    const counter = { count: 0 };
    const r = normalizedOwnText(div, undefined, {
      excludeChild: host,
      inspectionCounter: counter,
    });
    expect(r.status).toBe("empty");
    expect(counter.count).toBeLessThanOrEqual(33);
  });

  it("33 page children + owned host fails with bounded walk", () => {
    const div = document.createElement("div");
    for (let i = 0; i < 33; i += 1) {
      div.appendChild(document.createComment("c"));
    }
    const host = document.createElement("div");
    div.appendChild(host);
    expect(div.childNodes.length).toBe(34);
    const counter = { count: 0 };
    const r = normalizedOwnText(div, undefined, {
      excludeChild: host,
      inspectionCounter: counter,
    });
    expect(r).toEqual({ status: "over_budget", reason: "CHILD_NODES_EXCEEDED" });
    expect(counter.count).toBe(33);
  });

  it("lookalike host receives no exemption", () => {
    const div = document.createElement("div");
    for (let i = 0; i < 32; i += 1) {
      div.appendChild(document.createComment("c"));
    }
    const lookalike = document.createElement("div");
    div.appendChild(lookalike);
    const counter = { count: 0 };
    const r = normalizedOwnText(div, undefined, {
      excludeChild: document.createElement("div"), // different object
      inspectionCounter: counter,
    });
    expect(r).toEqual({ status: "over_budget", reason: "CHILD_NODES_EXCEEDED" });
    expect(counter.count).toBe(33);
  });

  it("exact dialog cap has no fallback — 64 page + host valid; +1 fails", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = doc.getElementById("visibility-dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");

    const countElements = (root: Element): number => {
      let n = 0;
      const walk = (el: Element): void => {
        n += 1;
        for (let i = 0; i < el.children.length; i += 1) {
          const c = el.children.item(i);
          if (c) walk(c);
        }
      };
      walk(root);
      return n;
    };
    const pad = (target: number): void => {
      let count = countElements(dialog);
      if (count >= target) return;
      const bucket = doc.createElement("div");
      const formEl = doc.getElementById("visibility-form");
      if (formEl && formEl.parentElement === dialog) dialog.insertBefore(bucket, formEl);
      else if (dialog.firstChild) dialog.insertBefore(bucket, dialog.firstChild);
      else dialog.appendChild(bucket);
      count += 1;
      let current: Element = bucket;
      while (count < target) {
        if (current.childElementCount >= 16) {
          const next = doc.createElement("div");
          current.appendChild(next);
          current = next;
          count += 1;
          if (count >= target) break;
        }
        current.appendChild(doc.createElement("span"));
        count += 1;
      }
    };

    pad(DIALOG_MAX_ELEMENTS);
    expect(countElements(dialog)).toBe(DIALOG_MAX_ELEMENTS);
    const pre = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(pre.status).toBe("matched");

    const owned = doc.createElement("div");
    const formEl = doc.getElementById("visibility-form");
    if (formEl && formEl.parentElement === dialog) dialog.insertBefore(owned, formEl);
    else if (dialog.firstChild) dialog.insertBefore(owned, dialog.firstChild);
    else dialog.appendChild(owned);
    expect(ownedPreviewHostInvariantFailure(owned, dialog, doc)).toBeNull();
    const withHost = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ownedPreviewHost: owned,
    });
    expect(withHost.status).toBe("matched");

    const extra = doc.createElement("span");
    if (formEl && formEl.parentElement === dialog) dialog.insertBefore(extra, formEl);
    else if (dialog.firstChild) dialog.insertBefore(extra, dialog.firstChild);
    else dialog.appendChild(extra);
    const over = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ownedPreviewHost: owned,
    });
    expect(over.status).toBe("abstain");
  });
});
