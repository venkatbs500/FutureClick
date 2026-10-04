/**
 * FC-007 M1–M3 — trusted-native + document/main/form/own-text/host bounds.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_MAX_ELEMENTS_V2,
  DOCUMENT_MAX_NODE_VISITS_V2,
  MAIN_MAX_ELEMENTS_V2,
  MAIN_MAX_NODE_VISITS_V2,
} from "../src/fc007/budget.js";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import { nativeFirstChild } from "../src/fc007/native-dom.js";
import { normalizedOwnText } from "../src/fc007/own-text.js";
import { ownedPreviewHostInvariantFailure } from "../src/fc007/preview-host.js";
import { recognizeStageD } from "../src/fc007/v2/dialog-inventory-v2.js";
import { inventoryDialogPageElements } from "../src/fc007/v2/dialog-page-elements.js";
import { inventoryDocumentV2 } from "../src/fc007/v2/document-inventory-v2.js";
import { recognizeFormContractV2 } from "../src/fc007/v2/form-contract-v2.js";
import { recognizeVisibilitySectionV2 } from "../src/fc007/v2/visibility-section-v2.js";
import {
  FIXTURE_IDENTITY,
  createFc007V2SettingsWindow,
  getStageDFormRefs,
  testMatchesModal,
} from "./fc007-test-dom.js";

function getDialog(doc: Document): HTMLDialogElement {
  const d = doc.getElementById("visibility-dialog");
  if (!(d instanceof HTMLDialogElement)) throw new Error("missing dialog");
  return d;
}

describe("FC-007 trusted-native + document acquisition bounds", () => {
  it("valid dense fixture document inventory completes with headroom", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const inv = inventoryDocumentV2(doc);
    expect(inv.status).toBe("ok");
    if (inv.status !== "ok") return;
    expect(inv.mains.length).toBe(1);
    expect(inv.dialogs.length).toBe(4);
    expect(inv.nodeVisitAttempts).toBeLessThan(DOCUMENT_MAX_NODE_VISITS_V2);
    expect(inv.elementVisitAttempts).toBeLessThan(DOCUMENT_MAX_ELEMENTS_V2);
    // Dense fixture walks full document including dialog interiors; ≈1.2k nodes, ≪ 4096.
    expect(inv.nodeVisitAttempts).toBeGreaterThan(500);
    expect(inv.nodeVisitAttempts).toBeLessThan(2_000);
  });

  it("Stage A/B/C/D still classify via captureFullContractV2", () => {
    for (const stage of ["a", "b", "c", "d"] as const) {
      const { document: doc, location } = createFc007V2SettingsWindow({ stage });
      const r = captureFullContractV2(doc, location, {
        requireTopFrame: false,
        matchesModal: testMatchesModal,
      });
      expect(r.status).toBe("matched");
      if (r.status !== "matched") continue;
      const expected =
        stage === "a"
          ? "settings-private"
          : stage === "b"
            ? "intent-confirmation"
            : stage === "c"
              ? "effects-acknowledgement"
              : "final-confirmation";
      expect(r.value.stage).toBe(expected);
    }
  });

  it("10k dialogs: early DIALOG_COLLECTION_TOO_LARGE without materializing 10k collection", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "a",
      denseProse: false,
      leadingPadding: 0,
    });
    let nodeVisits = 0;
    let firstChildReads = 0;
    let nextSiblingReads = 0;
    // Add 10k dialogs as body children (document walk sees them as siblings).
    for (let i = 0; i < 10_000; i += 1) {
      doc.body.appendChild(doc.createElement("dialog"));
    }
    const inv = inventoryDocumentV2(doc, {
      onNodeVisit: () => {
        nodeVisits += 1;
      },
      onFirstChildRead: () => {
        firstChildReads += 1;
      },
      onNextSiblingRead: () => {
        nextSiblingReads += 1;
      },
    });
    expect(inv.status).toBe("abstain");
    if (inv.status === "abstain") {
      expect(inv.reason).toBe("DIALOG_COLLECTION_TOO_LARGE");
      expect(inv.dialogsSeen).toBe(5); // 4 fixture + 1 overflow proof
    }
    expect(nodeVisits).toBeLessThan(100);
    expect(firstChildReads + nextSiblingReads).toBeLessThan(200);

    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("abstain");
    if (cap.status === "abstain") {
      expect(cap.reason).toBe("DIALOG_COLLECTION_TOO_LARGE");
    }
  });

  it("10k mains: MAIN_NOT_UNIQUE early without materializing 10k NodeList", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "a",
      denseProse: false,
      leadingPadding: 0,
    });
    let nodeVisits = 0;
    for (let i = 0; i < 10_000; i += 1) {
      doc.body.appendChild(doc.createElement("main"));
    }
    const inv = inventoryDocumentV2(doc, {
      onNodeVisit: () => {
        nodeVisits += 1;
      },
    });
    expect(inv.status).toBe("abstain");
    if (inv.status === "abstain") {
      expect(inv.reason).toBe("MAIN_NOT_UNIQUE");
      expect(inv.mainsSeen).toBe(2);
    }
    expect(nodeVisits).toBeLessThan(100);

    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("abstain");
    if (cap.status === "abstain") {
      expect(cap.reason).toBe("MAIN_NOT_UNIQUE");
    }
  });

  it("10k document text/comment nodes exhaust DOCUMENT_NODE_BUDGET", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "a",
      denseProse: false,
      leadingPadding: 0,
    });
    for (let i = 0; i < 10_000; i += 1) {
      doc.body.appendChild(doc.createTextNode("t"));
      doc.body.appendChild(doc.createComment("c"));
    }
    let nodeVisits = 0;
    const inv = inventoryDocumentV2(doc, {
      onNodeVisit: () => {
        nodeVisits += 1;
      },
    });
    expect(inv.status).toBe("abstain");
    if (inv.status === "abstain") {
      expect(inv.reason).toBe("DOCUMENT_NODE_BUDGET_EXHAUSTED");
    }
    expect(nodeVisits).toBe(DOCUMENT_MAX_NODE_VISITS_V2 + 1);

    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("abstain");
    if (cap.status === "abstain") {
      expect(cap.reason).toBe("DOCUMENT_NODE_BUDGET_EXHAUSTED");
    }
  });

  it("main with 10k text nodes: MAIN_NODE_BUDGET_EXHAUSTED", () => {
    const { document: doc } = createFc007V2SettingsWindow({
      stage: "a",
      denseProse: false,
      leadingPadding: 0,
    });
    const inv = inventoryDocumentV2(doc);
    expect(inv.status).toBe("ok");
    if (inv.status !== "ok") return;
    const main = doc.querySelector("main");
    if (!(main instanceof HTMLElement)) throw new Error("no main");
    for (let i = 0; i < 10_000; i += 1) {
      main.appendChild(doc.createTextNode("x"));
    }
    const r = recognizeVisibilitySectionV2(doc, {
      documentInventory: inv,
    });
    expect(r.status).toBe("abstain");
    if (r.status === "abstain") {
      expect(r.reason).toBe("MAIN_NODE_BUDGET_EXHAUSTED");
    }
  });

  it("one unexpected external associated control fails closed", () => {
    const {
      document: doc,
      form,
      final,
      close,
    } = (() => {
      const { document: d } = createFc007V2SettingsWindow({ stage: "d" });
      const refs = getStageDFormRefs(d);
      return { document: d, ...refs };
    })();
    form.id = "visibility-form";
    const external = doc.createElement("input");
    external.type = "text";
    external.setAttribute("form", "visibility-form");
    external.name = "leak";
    doc.body.appendChild(external);

    const r = recognizeFormContractV2(final, form, FIXTURE_IDENTITY, doc, close);
    expect(r.status).toBe("abstain");
    if (r.status === "abstain") {
      expect(r.reason).toBe("FORM_UNSUPPORTED_CONTROL");
    }
  });

  it("10k external associated controls: document or form budget abstain (never form.elements length)", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const form = doc.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("no form");
    form.id = "visibility-form";
    for (let i = 0; i < 10_000; i += 1) {
      const input = doc.createElement("input");
      input.type = "hidden";
      input.setAttribute("form", "visibility-form");
      input.name = `ext-${i}`;
      doc.body.appendChild(input);
    }
    // Never call form.elements.length in the assertion path.
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
          cap.reason === "FORM_HIDDEN_TOO_MANY" ||
          cap.reason === "FORM_UNSUPPORTED_CONTROL",
      ).toBe(true);
    }
  });

  it("owned host with 10k light children: O(1) OWNED_HOST_LIGHT_CHILDREN", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const dialog = getDialog(doc);
    const host = doc.createElement("div");
    dialog.appendChild(host);
    for (let i = 0; i < 10_000; i += 1) {
      host.appendChild(doc.createElement("span"));
    }
    expect(nativeFirstChild(host)).not.toBeNull();
    expect(ownedPreviewHostInvariantFailure(host, dialog, doc)).toBe("OWNED_HOST_LIGHT_CHILDREN");
  });

  it("own-text 10k direct children stops at local cap", () => {
    const div = document.createElement("div");
    for (let i = 0; i < 10_000; i += 1) {
      div.appendChild(document.createComment("c"));
    }
    const counter = { count: 0 };
    const r = normalizedOwnText(div, undefined, { inspectionCounter: counter });
    expect(r).toEqual({ status: "over_budget", reason: "CHILD_NODES_EXCEEDED" });
    expect(counter.count).toBe(33);
  });

  it("named nextSibling control does not redirect native dialog inventory", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = getDialog(doc);
    const form = doc.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("no form");
    const shadow = doc.createElement("input");
    shadow.type = "hidden";
    shadow.name = "nextSibling";
    form.appendChild(shadow);

    // Unsupported button as dialog sibling of form. Use insertBefore(form) so
    // happy-dom sibling links stay coherent; Chrome gate covers after-form shadowing.
    const bad = doc.createElement("button");
    bad.type = "button";
    bad.textContent = "Evil";
    dialog.insertBefore(bad, form);

    const inv = inventoryDialogPageElements(dialog);
    expect(inv.status).toBe("ok");
    if (inv.status === "ok") {
      const ids = new Set(inv.elements);
      expect(ids.size).toBe(inv.elements.length);
      expect(inv.elements.includes(bad)).toBe(true);
    }

    const stageD = recognizeStageD(dialog, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
      retainedDocument: doc,
    });
    expect(stageD.status).toBe("abstain");
    if (stageD.status === "abstain") {
      expect(stageD.reason).toBe("DIALOG_UNSUPPORTED_INTERACTIVE");
    }

    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("abstain");
  });

  it("external form-associated nextSibling is not visited via dialog pointer walk", () => {
    const { document: doc } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = getDialog(doc);
    const form = doc.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("no form");
    form.id = "visibility-form";
    const external = doc.createElement("input");
    external.type = "hidden";
    external.name = "nextSibling";
    external.setAttribute("form", "visibility-form");
    doc.body.appendChild(external);

    const inv = inventoryDialogPageElements(dialog);
    expect(inv.status).toBe("ok");
    if (inv.status === "ok") {
      expect(inv.elements.includes(external)).toBe(false);
      for (const el of inv.elements) {
        expect(dialog.contains(el) || el === dialog).toBe(true);
      }
    }
  });

  it("production V2 acquisition sources ban Class-A collection APIs", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      "document-inventory-v2.ts",
      "dialog-page-elements.ts",
      "visibility-section-v2.ts",
      "form-contract-v2.ts",
      "dialog-inventory-v2.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(here, `../src/fc007/v2/${f}`), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/\bgetElementsByTagName\b/);
      expect(code).not.toMatch(/\bgetElementsByClassName\b/);
      expect(code).not.toMatch(/\bquerySelectorAll\b/);
      expect(code).not.toMatch(/\bcreateTreeWalker\b/);
      expect(code).not.toMatch(/\bNodeIterator\b/);
      expect(code).not.toMatch(/form\.elements\b/);
      expect(code).not.toMatch(/\.childNodes\b/);
      expect(code).not.toMatch(/\.childElementCount\b/);
    }
    const own = readFileSync(join(here, "../src/fc007/own-text.ts"), "utf8");
    const ownCode = own.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(ownCode).not.toMatch(/\.childNodes\b/);
    const host = readFileSync(join(here, "../src/fc007/preview-host.ts"), "utf8");
    const hostCode = host.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(hostCode).not.toMatch(/\.childNodes\b/);
    const preview = readFileSync(join(here, "../src/fc007/preview.ts"), "utf8");
    expect(preview).not.toMatch(/happy-dom/);
    expect(preview).toMatch(/appendChild\(host\)/);

    void MAIN_MAX_ELEMENTS_V2;
    void MAIN_MAX_NODE_VISITS_V2;
  });
});
