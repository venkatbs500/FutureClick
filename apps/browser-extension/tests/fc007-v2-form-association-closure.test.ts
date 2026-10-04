/**
 * FC-007 final form association closure — M1 (image input / association union),
 * M2 (document-bounded form collection work), M3 (gate PASS/FAIL/BLOCKED).
 */

import { describe, expect, it } from "vitest";
import {
  ASSOCIATED_REJECT_KINDS,
  MISSING_GETTER_KINDS,
  evaluateAcquisitionGateReport,
} from "../scripts/fc007-acquisition-gate-eval.mjs";
import { DOCUMENT_MAX_ELEMENTS_V2, FORM_ELEMENTS_MAX } from "../src/fc007/budget.js";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import {
  getFormCollectionAccessCounters,
  isCompletedDocumentInventory,
  iterateNativeFormControls,
  resetFormCollectionAccessCounters,
} from "../src/fc007/native-dom.js";
import { inventoryDocumentV2 } from "../src/fc007/v2/document-inventory-v2.js";
import { recognizeFormContractV2 } from "../src/fc007/v2/form-contract-v2.js";
import {
  FIXTURE_IDENTITY,
  createFc007V2SettingsWindow,
  getStageDFormRefs,
  testMatchesModal,
} from "./fc007-test-dom.js";

function stageD() {
  const env = createFc007V2SettingsWindow({ stage: "d", denseProse: false, leadingPadding: 0 });
  const refs = getStageDFormRefs(env.document);
  return { ...env, ...refs };
}

function capture(
  doc: Document,
  location: Pick<Location, "protocol" | "hostname" | "port" | "pathname">,
) {
  return captureFullContractV2(doc, location, {
    requireTopFrame: false,
    matchesModal: testMatchesModal,
  });
}

function isFinal(r: ReturnType<typeof capture>): boolean {
  return r.status === "matched" && r.value.stage === "final-confirmation";
}

function formReason(env: ReturnType<typeof stageD>): string | null {
  const r = recognizeFormContractV2(env.final, env.form, FIXTURE_IDENTITY, env.document, env.close);
  return r.status === "abstain" ? r.reason : null;
}

function elementCount(doc: Document): number {
  const inv = inventoryDocumentV2(doc);
  if (inv.status !== "ok") throw new Error(`inventory ${inv.reason}`);
  return inv.elementVisitAttempts;
}

describe("FC-007 form association union (M1)", () => {
  it("baseline Stage D matches final-confirmation; hidden controls deduped across sources", () => {
    const env = stageD();
    expect(isFinal(capture(env.document, env.location))).toBe(true);
    const r = recognizeFormContractV2(
      env.final,
      env.form,
      FIXTURE_IDENTITY,
      env.document,
      env.close,
    );
    expect(r.status).toBe("matched");
    if (r.status === "matched") {
      const hiddenInForm = Array.from(env.form.querySelectorAll("input")).filter(
        (i) => i.type === "hidden",
      ).length;
      expect(r.value.hiddenInputCount).toBe(hiddenInForm);
    }
  });

  it("external <input type=image form=…> outside dialog → FORM_UNSUPPORTED_CONTROL, never final", () => {
    const env = stageD();
    const img = env.document.createElement("input");
    img.type = "image";
    img.setAttribute("form", "visibility-form");
    env.document.body.appendChild(img);
    expect(img.form).toBe(env.form);
    expect(formReason(env)).toBe("FORM_UNSUPPORTED_CONTROL");
    expect(isFinal(capture(env.document, env.location))).toBe(false);
  });

  it("external <input type=image form=…> inside inactive dialog → FORM_UNSUPPORTED_CONTROL", () => {
    const env = stageD();
    const idle = env.document.getElementById("empty-dialog-1");
    if (!(idle instanceof HTMLDialogElement)) throw new Error("missing empty dialog");
    const img = env.document.createElement("input");
    img.type = "image";
    img.setAttribute("form", "visibility-form");
    idle.appendChild(img);
    expect(img.form).toBe(env.form);
    expect(formReason(env)).toBe("FORM_UNSUPPORTED_CONTROL");
    expect(isFinal(capture(env.document, env.location))).toBe(false);
  });

  const inputTypes = [
    "image",
    "text",
    "checkbox",
    "radio",
    "submit",
    "reset",
    "file",
    "number",
    "email",
    "password",
    "search",
    "url",
    "tel",
    "range",
    "color",
    "date",
    "button",
  ];
  for (const type of inputTypes) {
    it(`external associated input[type=${type}] → FORM_UNSUPPORTED_CONTROL`, () => {
      const env = stageD();
      const el = env.document.createElement("input");
      el.type = type;
      el.setAttribute("form", "visibility-form");
      env.document.body.appendChild(el);
      expect(el.form).toBe(env.form);
      expect(formReason(env)).toBe("FORM_UNSUPPORTED_CONTROL");
      expect(isFinal(capture(env.document, env.location))).toBe(false);
    });
  }

  const builtIns: ReadonlyArray<readonly [string, () => Element]> = [
    [
      "button[type=button]",
      () => {
        const b = document.createElement("button");
        b.type = "button";
        return b;
      },
    ],
    [
      "button[type=submit]",
      () => {
        const b = document.createElement("button");
        b.type = "submit";
        return b;
      },
    ],
    ["select", () => document.createElement("select")],
    ["textarea", () => document.createElement("textarea")],
    ["fieldset", () => document.createElement("fieldset")],
    ["object", () => document.createElement("object")],
    ["output", () => document.createElement("output")],
  ];
  for (const [label, make] of builtIns) {
    it(`external associated ${label} → FORM_UNSUPPORTED_CONTROL`, () => {
      const env = stageD();
      const el = env.document.importNode(make(), true);
      el.setAttribute("form", "visibility-form");
      env.document.body.appendChild(el);
      expect((el as HTMLElement & { form: HTMLFormElement | null }).form).toBe(env.form);
      expect(formReason(env)).toBe("FORM_UNSUPPORTED_CONTROL");
      expect(isFinal(capture(env.document, env.location))).toBe(false);
    });
  }

  it("semantic cap: 24 unique associated controls accepted by union; 25th → FORM_ELEMENTS_TOO_MANY", () => {
    for (const total of [FORM_ELEMENTS_MAX, FORM_ELEMENTS_MAX + 1]) {
      const env = stageD();
      const inForm = env.form.querySelectorAll(
        "input,button,select,textarea,fieldset,object,output",
      ).length;
      for (let i = inForm; i < total; i += 1) {
        const h = env.document.createElement("input");
        h.type = "hidden";
        h.setAttribute("form", "visibility-form");
        env.document.body.appendChild(h);
      }
      // In-form controls are found by BOTH the inventory pass and form.elements; dedupe keeps
      // the union at exactly `total`, so 24 passes the union (then fails the hidden rule).
      expect(formReason(env)).toBe(
        total === FORM_ELEMENTS_MAX ? "FORM_HIDDEN_TOO_MANY" : "FORM_ELEMENTS_TOO_MANY",
      );
    }
  });
});

describe("FC-007 document-bounded form collection work (M2)", () => {
  it("successful inventory returns a frozen, marked element array", () => {
    const env = stageD();
    const inv = inventoryDocumentV2(env.document);
    expect(inv.status).toBe("ok");
    if (inv.status !== "ok") return;
    expect(Object.isFrozen(inv.elements)).toBe(true);
    expect(isCompletedDocumentInventory(inv.elements)).toBe(true);
    expect(isCompletedDocumentInventory(inv.elements.slice())).toBe(false);
  });

  it("form.elements is unreachable without a completed inventory token (getter 0)", () => {
    const env = stageD();
    const inv = inventoryDocumentV2(env.document);
    if (inv.status !== "ok") throw new Error("inventory");
    resetFormCollectionAccessCounters();
    const it1 = iterateNativeFormControls(env.form, FORM_ELEMENTS_MAX, inv.elements.slice());
    expect(it1.status).toBe("unavailable");
    const r = recognizeFormContractV2(
      env.final,
      env.form,
      FIXTURE_IDENTITY,
      env.document,
      env.close,
      {
        documentElements: inv.elements.slice(),
      },
    );
    expect(r.status).toBe("abstain");
    if (r.status === "abstain") expect(r.reason).toBe("DOCUMENT_INVENTORY_UNPROVEN");
    const c = getFormCollectionAccessCounters();
    expect(c.elementsGetterCalls).toBe(0);
    expect(c.itemCalls).toBe(0);
    expect(c.rejectedWithoutCompletedInventory).toBe(1);
  });

  it("valid capture: collection access occurs only after a completed inventory", () => {
    const env = stageD();
    resetFormCollectionAccessCounters();
    expect(isFinal(capture(env.document, env.location))).toBe(true);
    const c = getFormCollectionAccessCounters();
    expect(c.elementsGetterCalls).toBeGreaterThanOrEqual(1);
    expect(c.completedInventoryMarksAtFirstGetter).toBeGreaterThanOrEqual(1);
    expect(c.itemCalls).toBeLessThanOrEqual((FORM_ELEMENTS_MAX + 1) * c.elementsGetterCalls);
  });

  it("10k associated controls: document budget aborts BEFORE any form collection access", () => {
    const env = stageD();
    const idle = env.document.getElementById("empty-dialog-2");
    if (!(idle instanceof HTMLDialogElement)) throw new Error("missing empty dialog");
    for (let i = 0; i < 10_000; i += 1) {
      const input = env.document.createElement("input");
      input.type = "hidden";
      input.setAttribute("form", "visibility-form");
      idle.appendChild(input);
    }
    resetFormCollectionAccessCounters();
    const cap = capture(env.document, env.location);
    expect(cap.status).toBe("abstain");
    if (cap.status === "abstain") {
      expect(["DOCUMENT_ELEMENT_BUDGET_EXHAUSTED", "DOCUMENT_NODE_BUDGET_EXHAUSTED"]).toContain(
        cap.reason,
      );
    }
    const c = getFormCollectionAccessCounters();
    expect(c.elementsGetterCalls).toBe(0);
    expect(c.itemCalls).toBe(0);
    expect(c.completedInventoryMarks).toBe(0);
  });

  it("Document-level comment flood counts against node budget; no collection access", () => {
    const env = stageD();
    const ext = env.document.createElement("input");
    ext.type = "hidden";
    ext.setAttribute("form", "visibility-form");
    env.document.body.appendChild(ext);
    for (let i = 0; i < 5000; i += 1) {
      env.document.appendChild(env.document.createComment("x"));
    }
    resetFormCollectionAccessCounters();
    const cap = capture(env.document, env.location);
    expect(cap.status).toBe("abstain");
    if (cap.status === "abstain") expect(cap.reason).toBe("DOCUMENT_NODE_BUDGET_EXHAUSTED");
    expect(getFormCollectionAccessCounters().elementsGetterCalls).toBe(0);
    expect(getFormCollectionAccessCounters().itemCalls).toBe(0);
  });

  it("near-cap padded document (3000 elements, document-scope association) stays final", () => {
    const env = stageD();
    const ext = env.document.createElement("input");
    ext.type = "hidden";
    ext.setAttribute("form", "visibility-form");
    env.document.body.appendChild(ext);
    let n = elementCount(env.document);
    while (n < 3000) {
      env.document.body.appendChild(env.document.createElement("span"));
      n += 1;
    }
    expect(elementCount(env.document)).toBe(3000);
    expect(3000).toBeLessThanOrEqual(DOCUMENT_MAX_ELEMENTS_V2);
    resetFormCollectionAccessCounters();
    expect(isFinal(capture(env.document, env.location))).toBe(true);
    const c = getFormCollectionAccessCounters();
    expect(c.elementsGetterCalls).toBe(1);
    expect(c.completedInventoryMarksAtFirstGetter).toBeGreaterThanOrEqual(1);
    expect(c.itemCalls).toBeLessThanOrEqual(FORM_ELEMENTS_MAX + 1);
  });

  it("near-cap many associated built-ins: semantic overflow from inventory pass, never final", () => {
    const env = stageD();
    let n = elementCount(env.document);
    while (n < 3000) {
      const h = env.document.createElement("input");
      h.type = "hidden";
      h.setAttribute("form", "visibility-form");
      env.document.body.appendChild(h);
      n += 1;
    }
    resetFormCollectionAccessCounters();
    expect(isFinal(capture(env.document, env.location))).toBe(false);
    expect(formReason(env)).toBe("FORM_ELEMENTS_TOO_MANY");
    const c = getFormCollectionAccessCounters();
    expect(c.completedInventoryMarks).toBeGreaterThanOrEqual(1);
    expect(c.itemCalls).toBeLessThanOrEqual(
      (FORM_ELEMENTS_MAX + 1) * Math.max(1, c.elementsGetterCalls),
    );
  });

  it("production source: no collection .length, iterate requires inventory token", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const nd = strip(fs.readFileSync(path.join(here, "../src/fc007/native-dom.ts"), "utf8"));
    const fc = strip(
      fs.readFileSync(path.join(here, "../src/fc007/v2/form-contract-v2.ts"), "utf8"),
    );
    expect(nd).not.toMatch(/collection\.length|\.elements\.length/);
    expect(fc).not.toMatch(/collection\.length|\.elements\.length/);
    expect(nd).toMatch(/completedDocumentInventories\.has\(completedInventory\)/);
    expect(fc).toMatch(/iterateNativeFormControls\(form, FORM_ELEMENTS_MAX, documentElements\)/);
    expect(nd).not.toMatch(/export function nativeFormElementsCollection/);
  });
});

function namedFormCase(count: number): Record<string, unknown> {
  return {
    setup: { controlCount: count, formIsFirstBodyChild: true, ordinaryTagNameShadowed: true },
    nativeTagName: "FORM",
    inventory: {
      status: "abstain",
      reason: "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED",
      nodeVisitAttempts: 3076,
      elementVisitAttempts: 3073,
    },
    captureThrew: false,
    snap: {
      capStatus: "abstain",
      capStage: null,
      capReason: "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED",
      formStatus: "abstain",
      formReason: null,
    },
    counters: {
      elementsGetterCalls: 0,
      itemCalls: 0,
      completedInventoryMarks: 0,
      completedInventoryMarksAtFirstGetter: -1,
      rejectedWithoutCompletedInventory: 0,
    },
    diag: { coldItemAfterCaptureMs: 5, warmItemMs: 0.01, coldItemAfterOrdinaryTagNameMs: 0.02 },
  };
}

/** Minimal fully-passing gate report used to prove each failure mode is detected. */
function validReport(): Record<string, unknown> {
  const finalSnap = {
    capStatus: "matched",
    capStage: "final-confirmation",
    capReason: null,
    formStatus: "matched",
    formReason: null,
  };
  const rejectSnap = (formReasonValue: string, capReason = "MODAL_STAGE_UNMATCHED") => ({
    capStatus: "abstain",
    capStage: null,
    capReason,
    formStatus: "abstain",
    formReason: formReasonValue,
  });
  const ctr = (getter: number, items: number, marks = 1, atFirst = getter > 0 ? 1 : -1) => ({
    elementsGetterCalls: getter,
    itemCalls: items,
    completedInventoryMarks: marks,
    completedInventoryMarksAtFirstGetter: atFirst,
    rejectedWithoutCompletedInventory: 0,
  });
  const associated: Record<string, unknown> = {};
  for (const k of ASSOCIATED_REJECT_KINDS) {
    associated[k] = {
      baselineFinal: true,
      associated: true,
      nativeGetterAgrees: true,
      inFormElements: !k.startsWith("input-image"),
      snap: rejectSnap("FORM_UNSUPPORTED_CONTROL"),
    };
  }
  const faceSetup = (count: number) => ({
    customElementsAvailable: true,
    registered: true,
    formAssociatedStatic: true,
    attachInternalsOk: true,
    internalsFormIsRetainedForm: true,
    definedPseudo: true,
    intendedElement: true,
    faceCount: count,
  });
  return {
    version: "Chrome/test",
    main: {
      baseline: { snap: finalSnap, counters: ctr(1, 6), hiddenInputCount: 3 },
      namedPropertyNextSibling: {
        baselineFinal: true,
        ordinaryNextSiblingIsInput: true,
        nativeNextSiblingNotInput: true,
        nativeSeesBadAfterForm: true,
        invHasBad: true,
        snap: rejectSnap("FORM_UNSUPPORTED_CONTROL"),
      },
      dupEffects: { baselineFinal: true, snap: rejectSnap("X") },
      oversize: { baselineFinal: true, snap: rejectSnap("X") },
      externalNotInDialogInv: true,
      dialogs10k: { reason: "DIALOG_COLLECTION_TOO_LARGE", nodeVisits: 735, dialogsSeen: 5 },
      mains10k: { reason: "MAIN_NOT_UNIQUE", nodeVisits: 735, mainsSeen: 2 },
      nestedMain: { baselineFinal: true, snap: rejectSnap("MAIN_NOT_UNIQUE", "MAIN_NOT_UNIQUE") },
      nestedDialog: {
        baselineFinal: true,
        snap: rejectSnap("DIALOG_COLLECTION_TOO_LARGE", "DIALOG_COLLECTION_TOO_LARGE"),
      },
      associated,
      shadowNotAssociated: {
        baselineFinal: true,
        associated: false,
        inFormElements: false,
        snap: finalSnap,
      },
      documentLevelFlood: {
        baselineFinal: true,
        documentLevelNodes: 5000,
        snap: rejectSnap("DOCUMENT_NODE_BUDGET_EXHAUSTED", "DOCUMENT_NODE_BUDGET_EXHAUSTED"),
        counters: ctr(0, 0, 0),
      },
      controls10k: {
        baselineFinal: true,
        associatedCount: 10000,
        snap: rejectSnap("DOCUMENT_ELEMENT_BUDGET_EXHAUSTED", "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED"),
        counters: ctr(0, 0, 0),
      },
      nearCapPadded: {
        baselineFinal: true,
        externalAssociated: true,
        inventoryStatus: "ok",
        documentElements: 3000,
        snap: finalSnap,
        counters: ctr(1, 7),
      },
      nearCapManyBuiltIn: {
        baselineFinal: true,
        associatedCount: 2368,
        inventoryStatus: "ok",
        documentElements: 3000,
        snap: rejectSnap("FORM_ELEMENTS_TOO_MANY"),
        counters: ctr(0, 0),
      },
      iterateBounded: { status: "overflow", controlCount: 25, counters: ctr(1, 25, 0, 0) },
      unprovenInventoryRejected: {
        iterateStatus: "unavailable",
        formReason: "DOCUMENT_INVENTORY_UNPROVEN",
        counters: { ...ctr(0, 0, 0), rejectedWithoutCompletedInventory: 1 },
      },
      lateBaseTarget: { baselineFinal: true, snap: rejectSnap("BASE_TARGET") },
      multiModal: {
        outcome: "PASS",
        baselineFinal: true,
        aModal: true,
        bModal: true,
        snap: rejectSnap("X", "MULTIPLE_ACTUAL_MODALS"),
      },
    },
    face: {
      setup: faceSetup(1),
      probe: {
        baselineFinal: true,
        found: true,
        builtIn: false,
        inFormElements: true,
        inventoryStatus: "ok",
        documentElements: 633,
        snap: rejectSnap("FORM_UNSUPPORTED_CONTROL"),
        counters: ctr(3, 21),
      },
    },
    faceNearCap: {
      setup: faceSetup(2368),
      probe: {
        baselineFinal: true,
        found: true,
        builtIn: false,
        inFormElements: true,
        inventoryStatus: "ok",
        documentElements: 3000,
        snap: rejectSnap("FORM_ELEMENTS_TOO_MANY"),
        counters: ctr(3, 75),
      },
    },
    namedForm10k: namedFormCase(10000),
    namedForm100k: namedFormCase(100000),
    missingGetters: MISSING_GETTER_KINDS.map((kind) => ({
      kind,
      bootSeen: false,
      harnessPresent: false,
    })),
  };
}

type Json = Record<string, unknown>;
function at(r: Json, ...keys: string[]): Json {
  let cur: unknown = r;
  for (const k of keys) cur = (cur as Json)[k];
  return cur as Json;
}
function outcomeOf(r: Json, name: string): string | undefined {
  return evaluateAcquisitionGateReport(r).results.find((x) => x.name === name)?.outcome;
}

describe("FC-007 acquisition Chrome gate evaluator (M3)", () => {
  it("fully proven report → PASS, exit 0", () => {
    const e = evaluateAcquisitionGateReport(validReport());
    expect(e.results.filter((r) => r.outcome !== "PASS")).toEqual([]);
    expect(e.exitCode).toBe(0);
  });

  it("FACE setup threw (e.g. customElements null) → BLOCKED, exit nonzero", () => {
    const r = validReport();
    at(r, "face").setup = { error: "customElements unavailable", customElementsAvailable: false };
    const e = evaluateAcquisitionGateReport(r);
    expect(outcomeOf(r, "face")).toBe("BLOCKED");
    expect(e.blocked).toBe(1);
    expect(e.exitCode).not.toBe(0);
  });

  for (const proof of [
    "customElementsAvailable",
    "registered",
    "formAssociatedStatic",
    "attachInternalsOk",
    "internalsFormIsRetainedForm",
    "definedPseudo",
    "intendedElement",
  ]) {
    it(`FACE setup proof ${proof}=false → BLOCKED (never PASS)`, () => {
      const r = validReport();
      at(r, "face", "setup")[proof] = false;
      expect(outcomeOf(r, "face")).toBe("BLOCKED");
      expect(evaluateAcquisitionGateReport(r).exitCode).not.toBe(0);
    });
  }

  it("FACE proven but capture reached final-confirmation → FAIL", () => {
    const r = validReport();
    at(r, "face", "probe").snap = at(r, "main", "baseline").snap;
    expect(outcomeOf(r, "face")).toBe("FAIL");
  });

  it("multi-modal BLOCKED outcome → BLOCKED, exit nonzero", () => {
    const r = validReport();
    at(r, "main").multiModal = { outcome: "BLOCKED", reason: "two_modals_unproven" };
    expect(outcomeOf(r, "multiModal")).toBe("BLOCKED");
    expect(evaluateAcquisitionGateReport(r).exitCode).not.toBe(0);
  });

  it("multi-modal claims PASS without :modal proof → BLOCKED", () => {
    const r = validReport();
    at(r, "main", "multiModal").bModal = false;
    expect(outcomeOf(r, "multiModal")).toBe("BLOCKED");
  });

  it("multi-modal missing → FAIL (no default)", () => {
    const r = validReport();
    Reflect.deleteProperty(at(r, "main"), "multiModal");
    expect(outcomeOf(r, "multiModal")).toBe("FAIL");
  });

  it("image input association not established → BLOCKED", () => {
    const r = validReport();
    at(r, "main", "associated", "input-image").associated = false;
    expect(outcomeOf(r, "associated:input-image")).toBe("BLOCKED");
  });

  it("image input reaching final-confirmation → FAIL", () => {
    const r = validReport();
    at(r, "main", "associated", "input-image").snap = at(r, "main", "baseline").snap;
    expect(outcomeOf(r, "associated:input-image")).toBe("FAIL");
  });

  it("stale baseline (not final before injection) → BLOCKED", () => {
    const r = validReport();
    at(r, "main", "associated", "output").baselineFinal = false;
    expect(outcomeOf(r, "associated:output")).toBe("BLOCKED");
  });

  it("10k controls with any collection access → FAIL", () => {
    const r = validReport();
    at(r, "main", "controls10k", "counters").elementsGetterCalls = 1;
    expect(outcomeOf(r, "controls10k")).toBe("FAIL");
  });

  it("missing / wrong-type / NaN / Infinity counters → FAIL (no zero default)", () => {
    for (const bad of [undefined, "0", Number.NaN, Number.POSITIVE_INFINITY, null]) {
      const r = validReport();
      const c = at(r, "main", "controls10k", "counters");
      if (bad === undefined) Reflect.deleteProperty(c, "itemCalls");
      else c.itemCalls = bad;
      expect(outcomeOf(r, "controls10k")).toBe("FAIL");
    }
  });

  it("missing boolean evidence → FAIL", () => {
    const r = validReport();
    Reflect.deleteProperty(at(r, "main", "namedPropertyNextSibling"), "invHasBad");
    expect(outcomeOf(r, "namedPropertyNextSibling")).toBe("FAIL");
  });

  it("missing associated kind → FAIL", () => {
    const r = validReport();
    Reflect.deleteProperty(at(r, "main", "associated"), "select");
    expect(outcomeOf(r, "associated:select")).toBe("FAIL");
  });

  it("missing-getter kind not executed → FAIL; harness booted → FAIL", () => {
    const r = validReport();
    (r.missingGetters as Json[]).pop();
    expect(outcomeOf(r, "missingGetters")).toBe("FAIL");
    const r2 = validReport();
    const first = (r2.missingGetters as Json[])[0];
    if (first) first.harnessPresent = true;
    expect(outcomeOf(r2, "missingGetters")).toBe("FAIL");
  });

  it("near-cap FACE with >25 item probes per access → FAIL", () => {
    const r = validReport();
    at(r, "faceNearCap", "probe", "counters").itemCalls = 76;
    expect(outcomeOf(r, "faceNearCap")).toBe("FAIL");
  });

  it("named-form shadowing not established → BLOCKED, exit nonzero", () => {
    const r = validReport();
    at(r, "namedForm100k", "setup").ordinaryTagNameShadowed = false;
    expect(outcomeOf(r, "namedForm100k")).toBe("BLOCKED");
    expect(evaluateAcquisitionGateReport(r).exitCode).not.toBe(0);
  });

  it("named-form wrong control count → BLOCKED", () => {
    const r = validReport();
    at(r, "namedForm10k", "setup").controlCount = 9999;
    expect(outcomeOf(r, "namedForm10k")).toBe("BLOCKED");
  });

  it("named-form capture threw / collection touched / native tag wrong → FAIL", () => {
    const mutate: Array<(r: Json) => void> = [
      (r) => {
        at(r, "namedForm10k").captureThrew = true;
      },
      (r) => {
        at(r, "namedForm10k", "counters").itemCalls = 1;
      },
      (r) => {
        at(r, "namedForm10k").nativeTagName = "INPUT";
      },
    ];
    for (const m of mutate) {
      const r = validReport();
      m(r);
      expect(outcomeOf(r, "namedForm10k")).toBe("FAIL");
    }
  });

  it("named-form diag missing → FAIL; budget mismatch 10k vs 100k → FAIL", () => {
    const r = validReport();
    Reflect.deleteProperty(at(r, "namedForm10k", "diag"), "warmItemMs");
    expect(outcomeOf(r, "namedForm10k")).toBe("FAIL");
    const r2 = validReport();
    at(r2, "namedForm100k", "inventory").nodeVisitAttempts = 3077;
    expect(outcomeOf(r2, "namedFormSameBudget")).toBe("FAIL");
  });

  it("missing native tagName getter kind is mandatory", () => {
    expect(MISSING_GETTER_KINDS).toContain("Element.tagName");
    const r = validReport();
    r.missingGetters = (r.missingGetters as Json[]).filter((x) => x.kind !== "Element.tagName");
    expect(outcomeOf(r, "missingGetters")).toBe("FAIL");
  });

  it("empty / malformed report → nonzero", () => {
    expect(evaluateAcquisitionGateReport(null).exitCode).not.toBe(0);
    expect(evaluateAcquisitionGateReport({}).exitCode).not.toBe(0);
  });
});
