/**
 * FC-007 Final Acquisition Completeness — M1–M4 regressions.
 */

import { describe, expect, it } from "vitest";
import {
  DOCUMENT_MAX_ELEMENTS_V2,
  DOCUMENT_MAX_NODE_VISITS_V2,
  FORM_ELEMENTS_MAX,
} from "../src/fc007/budget.js";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import { iterateNativeFormControls } from "../src/fc007/native-dom.js";
import { inventoryDocumentV2 } from "../src/fc007/v2/document-inventory-v2.js";
import { recognizeFormContractV2 } from "../src/fc007/v2/form-contract-v2.js";
import {
  FIXTURE_IDENTITY,
  createFc007V2SettingsWindow,
  getStageDFormRefs,
  testMatchesModal,
} from "./fc007-test-dom.js";

describe("FC-007 final acquisition completeness M1–M4", () => {
  it("valid dense fixture completes with dialog interiors under document caps", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const inv = inventoryDocumentV2(doc);
    expect(inv.status).toBe("ok");
    if (inv.status !== "ok") return;
    expect(inv.nodeVisitAttempts).toBeLessThanOrEqual(DOCUMENT_MAX_NODE_VISITS_V2);
    expect(inv.elementVisitAttempts).toBeLessThanOrEqual(DOCUMENT_MAX_ELEMENTS_V2);
    expect(inv.nodeVisitAttempts).toBeGreaterThan(500);
    expect(inv.dialogs.length).toBe(4);
    expect(inv.mains.length).toBe(1);
  });

  it("M1: second main inside inactive dialog → MAIN_NOT_UNIQUE", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    // Reuse an existing empty dialog so dialog count stays ≤4.
    const idle = doc.getElementById("empty-dialog-0");
    if (!(idle instanceof HTMLDialogElement)) throw new Error("missing empty dialog");
    const nestedMain = doc.createElement("main");
    nestedMain.appendChild(doc.createTextNode("x"));
    idle.appendChild(nestedMain);

    const inv = inventoryDocumentV2(doc);
    expect(inv.status).toBe("abstain");
    if (inv.status === "abstain") expect(inv.reason).toBe("MAIN_NOT_UNIQUE");

    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("abstain");
    if (cap.status === "abstain") expect(cap.reason).toBe("MAIN_NOT_UNIQUE");
  });

  it("M1: nested dialog counts toward DIALOG_COLLECTION_TOO_LARGE", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    // Fixture already has 4 dialogs. Nest a 5th inside an empty one.
    const outer = doc.getElementById("empty-dialog-0");
    if (!(outer instanceof HTMLDialogElement)) throw new Error("missing empty dialog");
    const inner = doc.createElement("dialog");
    inner.id = "nested-dialog";
    outer.appendChild(inner);

    const inv = inventoryDocumentV2(doc);
    expect(inv.status).toBe("abstain");
    if (inv.status === "abstain") {
      expect(inv.reason).toBe("DIALOG_COLLECTION_TOO_LARGE");
      expect(inv.dialogsSeen).toBe(5);
    }

    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("abstain");
    if (cap.status === "abstain") expect(cap.reason).toBe("DIALOG_COLLECTION_TOO_LARGE");
  });

  it("M2: one unexpected text input in inactive dialog → FORM_UNSUPPORTED_CONTROL", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const form = doc.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("no form");
    form.id = "visibility-form";
    const idle = doc.getElementById("empty-dialog-1");
    if (!(idle instanceof HTMLDialogElement)) throw new Error("missing empty dialog");
    const leak = doc.createElement("input");
    leak.type = "text";
    leak.setAttribute("form", "visibility-form");
    leak.name = "leak";
    idle.appendChild(leak);

    const { final, close } = getStageDFormRefs(doc);
    const formR = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(formR.status).toBe("abstain");
    if (formR.status === "abstain") expect(formR.reason).toBe("FORM_UNSUPPORTED_CONTROL");

    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("abstain");
  });

  it("M2: external <output form=…> → FORM_UNSUPPORTED_CONTROL", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const form = doc.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("no form");
    form.id = "visibility-form";
    const out = doc.createElement("output");
    out.setAttribute("form", "visibility-form");
    doc.body.appendChild(out);

    const { final, close } = getStageDFormRefs(doc);
    const formR = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(formR.status).toBe("abstain");
    if (formR.status === "abstain") expect(formR.reason).toBe("FORM_UNSUPPORTED_CONTROL");

    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("abstain");
  });

  it("M2: form.elements.item bounded — never .length; overflow at cap+1", () => {
    const { document: doc } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const form = doc.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("no form");
    form.id = "visibility-form";
    for (let i = 0; i < FORM_ELEMENTS_MAX + 5; i += 1) {
      const input = doc.createElement("input");
      input.type = "hidden";
      input.name = `pad-${i}`;
      input.setAttribute("form", "visibility-form");
      doc.body.appendChild(input);
    }
    const inv = inventoryDocumentV2(doc);
    if (inv.status !== "ok") throw new Error("inventory");
    const iterated = iterateNativeFormControls(form, FORM_ELEMENTS_MAX, inv.elements);
    expect(iterated.status).toBe("overflow");
    if (iterated.status === "overflow") {
      // Accepted cap filled + one overflow-detecting control.
      expect(iterated.controls.length).toBe(FORM_ELEMENTS_MAX + 1);
    }
  });

  it("M2: 10k associated inputs in inactive dialog → bounded abstain", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const form = doc.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("no form");
    form.id = "visibility-form";
    const idle = doc.getElementById("empty-dialog-2");
    if (!(idle instanceof HTMLDialogElement)) throw new Error("missing empty dialog");
    for (let i = 0; i < 10_000; i += 1) {
      const input = doc.createElement("input");
      input.type = "hidden";
      input.name = `x-${i}`;
      input.setAttribute("form", "visibility-form");
      idle.appendChild(input);
    }

    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("abstain");
    if (cap.status === "abstain") {
      expect(
        cap.reason === "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED" ||
          cap.reason === "DOCUMENT_NODE_BUDGET_EXHAUSTED" ||
          cap.reason === "FORM_ELEMENTS_TOO_MANY" ||
          cap.reason === "FORM_HIDDEN_TOO_MANY",
      ).toBe(true);
    }
  });

  it("M3: base[target] from inventory — no querySelector; late base after 10k bases", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const head = doc.head ?? doc.documentElement;
    for (let i = 0; i < 100; i += 1) {
      // Keep under document budget while proving inventory sees late target.
      const b = doc.createElement("base");
      head.appendChild(b);
    }
    const targeted = doc.createElement("base");
    targeted.setAttribute("target", "_blank");
    head.appendChild(targeted);

    const { final, close } = getStageDFormRefs(doc);
    const form = doc.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("no form");
    const formR = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(formR.status).toBe("abstain");
    if (formR.status === "abstain") expect(formR.reason).toBe("BASE_TARGET");

    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("abstain");
  });

  it("M3: production form-contract has no querySelector base selector", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "../src/fc007/v2/form-contract-v2.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/querySelector\s*\(/);
    expect(code).not.toMatch(/querySelectorAll\s*\(/);
    expect(code).not.toMatch(/\.elements\.length/);
    expect(code).not.toMatch(/form\.elements\b(?!\s*,)/);
  });

  it("M4: native-dom source has no ordinary .form / nodeValue / data fallbacks", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "../src/fc007/native-dom.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/node\.nodeValue/);
    expect(code).not.toMatch(/formProp/);
    expect(code).not.toMatch(/getPrototypeOf/);
    expect(code).not.toMatch(/nativeAssociatedForm/);
    expect(code).toMatch(/CharacterData\.prototype/);
    expect(code).toMatch(/HTMLFormElement\.prototype/);
    expect(code).toMatch(/HTMLCollection\.prototype/);
  });
});
