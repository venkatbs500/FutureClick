/**
 * FC-007 Final Freeze M1 — native-collection-free bounded dialog traversal.
 *
 * Pointer primitives only: Node.firstChild / Node.nextSibling.
 * Two budgets: DIALOG_MAX_ELEMENTS (64) and DIALOG_MAX_NODE_VISITS (256).
 *
 * Work-bound derivation (aborting visit does not read further pointers):
 * - pageElementVisits ≤ DIALOG_MAX_ELEMENTS + 1
 * - nodeVisits ≤ DIALOG_MAX_NODE_VISITS + 1
 * - firstChildReads ≤ DIALOG_MAX_NODE_VISITS
 *   (one per successfully continued node; aborting visit stops before reads)
 * - nextSiblingReads ≤ DIALOG_MAX_NODE_VISITS
 *   (dialog.nextSibling never read; each continued non-root may read once)
 * - children.length / children.item: ZERO in production inventory
 */

import { describe, expect, it } from "vitest";
import { DIALOG_MAX_ELEMENTS, DIALOG_MAX_NODE_VISITS } from "../src/fc007/budget.js";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import { recognizeStageC, recognizeStageD } from "../src/fc007/v2/dialog-inventory-v2.js";
import {
  DIALOG_NODE_VISIT_ABORT_MAX,
  DIALOG_PAGE_ELEMENT_VISIT_ABORT_MAX,
  inventoryDialogPageElements,
} from "../src/fc007/v2/dialog-page-elements.js";
import { EFFECTS_ARIA_LABEL } from "../src/fc007/v2/effects-region.js";
import {
  FIXTURE_IDENTITY,
  createFc007V2SettingsWindow,
  testMatchesModal,
} from "./fc007-test-dom.js";

const MAX_PAGE = DIALOG_PAGE_ELEMENT_VISIT_ABORT_MAX; // 65
const MAX_NODE = DIALOG_NODE_VISIT_ABORT_MAX; // 257
const MAX_FIRST_CHILD = DIALOG_MAX_NODE_VISITS; // 256
const MAX_NEXT_SIBLING = DIALOG_MAX_NODE_VISITS; // 256

type Counters = {
  nodeVisits: number;
  pageVisits: number;
  firstChildReads: number;
  nextSiblingReads: number;
};

function emptyCounters(): Counters {
  return { nodeVisits: 0, pageVisits: 0, firstChildReads: 0, nextSiblingReads: 0 };
}

function inventoryHooks(c: Counters) {
  return {
    onNodeVisit: () => {
      c.nodeVisits += 1;
    },
    onPageElementVisit: () => {
      c.pageVisits += 1;
    },
    onFirstChildRead: () => {
      c.firstChildReads += 1;
    },
    onNextSiblingRead: () => {
      c.nextSiblingReads += 1;
    },
  };
}

function captureHooks(c: Counters) {
  return {
    onDialogNodeVisit: () => {
      c.nodeVisits += 1;
    },
    onDialogPageElementVisit: () => {
      c.pageVisits += 1;
    },
    onDialogFirstChildRead: () => {
      c.firstChildReads += 1;
    },
    onDialogNextSiblingRead: () => {
      c.nextSiblingReads += 1;
    },
  };
}

function assertWithinBounds(c: Counters): void {
  expect(c.pageVisits).toBeLessThanOrEqual(MAX_PAGE);
  expect(c.nodeVisits).toBeLessThanOrEqual(MAX_NODE);
  expect(c.firstChildReads).toBeLessThanOrEqual(MAX_FIRST_CHILD);
  expect(c.nextSiblingReads).toBeLessThanOrEqual(MAX_NEXT_SIBLING);
}

function expectCaptureBudgetAbstain(
  result: { status: string; reason?: string },
  c: Counters,
  kind: "element" | "node" | "either",
): void {
  expect(result.status).toBe("abstain");
  if (result.status !== "abstain") return;
  const r = result.reason;
  if (kind === "element") {
    expect(
      r === "DIALOG_ELEMENT_BUDGET_EXHAUSTED" || r === "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED",
    ).toBe(true);
  } else if (kind === "node") {
    expect(r === "DIALOG_NODE_BUDGET_EXHAUSTED" || r === "DOCUMENT_NODE_BUDGET_EXHAUSTED").toBe(
      true,
    );
  } else {
    expect(
      r === "DIALOG_ELEMENT_BUDGET_EXHAUSTED" ||
        r === "DIALOG_NODE_BUDGET_EXHAUSTED" ||
        r === "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED" ||
        r === "DOCUMENT_NODE_BUDGET_EXHAUSTED",
    ).toBe(true);
  }
  assertWithinBounds(c);
  // Document inventory may fail first (complete dialog interiors); dialog hooks stay 0.
  if (typeof r === "string" && r.startsWith("DOCUMENT_")) {
    expect(c.pageVisits).toBe(0);
    expect(c.nodeVisits).toBe(0);
  }
}

function countElements(root: Element): number {
  let n = 0;
  const walk = (el: Element): void => {
    n += 1;
    const children = el.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children.item(i);
      if (child) walk(child);
    }
  };
  walk(root);
  return n;
}

function getDialog(doc: Document): HTMLDialogElement {
  const dialog = doc.getElementById("visibility-dialog");
  if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");
  return dialog;
}

/**
 * happy-dom bug: dialog.appendChild after a <form> child fails to update
 * form.nextSibling, so pointer walks miss the new node. insertBefore(form)
 * keeps firstChild/nextSibling coherent (matches Chromium).
 */
function attachUnderDialog(dialog: HTMLDialogElement, node: Node): void {
  const form = dialog.ownerDocument.getElementById("visibility-form");
  if (form && form.parentElement === dialog) {
    dialog.insertBefore(node, form);
    return;
  }
  dialog.appendChild(node);
}

/** Append N direct element children (spans) under parent. */
function appendDirectSpans(parent: Element, n: number): void {
  const doc = parent.ownerDocument;
  for (let i = 0; i < n; i += 1) {
    parent.appendChild(doc.createElement("span"));
  }
}

/** Append N direct text nodes under parent. */
function appendDirectTexts(parent: Element, n: number): void {
  const doc = parent.ownerDocument;
  for (let i = 0; i < n; i += 1) {
    parent.appendChild(doc.createTextNode(`t${i}`));
  }
}

/** Append N direct comment nodes under parent. */
function appendDirectComments(parent: Element, n: number): void {
  const doc = parent.ownerDocument;
  for (let i = 0; i < n; i += 1) {
    parent.appendChild(doc.createComment(`c${i}`));
  }
}

function floodEffectsDirectSpans(dialog: HTMLDialogElement, n: number): void {
  const region = dialog.querySelector(`[aria-label="${EFFECTS_ARIA_LABEL}"]`);
  if (!region) throw new Error("missing effects region");
  appendDirectSpans(region, n);
}

function padPageElements(dialog: HTMLDialogElement, target: number): void {
  let count = countElements(dialog);
  const doc = dialog.ownerDocument;
  const bucket = doc.createElement("div");
  attachUnderDialog(dialog, bucket);
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
}

describe("FC-007 M1 native-collection-free bounded traversal", () => {
  it("modal is outside bounded <main>", () => {
    const { document: doc } = createFc007V2SettingsWindow({ stage: "d" });
    const main = doc.querySelector("main");
    const dialog = getDialog(doc);
    expect(main?.contains(dialog)).toBe(false);
  });

  it("records valid Stage B/C/D fixture headroom under both caps", () => {
    const reports: Record<string, Counters & { elements: number }> = {};
    for (const stage of ["b", "c", "d"] as const) {
      const { document: doc } = createFc007V2SettingsWindow({
        stage,
        denseProse: false,
        leadingPadding: 0,
      });
      const dialog = getDialog(doc);
      const c = emptyCounters();
      const inv = inventoryDialogPageElements(dialog, inventoryHooks(c));
      expect(inv.status).toBe("ok");
      if (inv.status === "ok") {
        expect(inv.nodeVisitAttempts).toBeLessThan(DIALOG_MAX_NODE_VISITS);
        expect(inv.pageControlledCount).toBeLessThanOrEqual(DIALOG_MAX_ELEMENTS);
        expect(inv.nodeVisitAttempts).toBe(c.nodeVisits);
        reports[stage] = {
          ...c,
          elements: inv.pageControlledCount,
        };
      }
    }
    // Documented derivation baseline (pointer walk): B≈11, C≈15, D≈26 nodes.
    expect(reports.b?.nodeVisits).toBeLessThanOrEqual(32);
    expect(reports.c?.nodeVisits).toBeLessThanOrEqual(32);
    expect(reports.d?.nodeVisits).toBeLessThanOrEqual(64);
    expect(reports.d?.nodeVisits).toBeLessThan(DIALOG_MAX_NODE_VISITS / 2);
  });

  it("A/B: 1,000 and 10,000 direct element siblings — element overflow, size-independent", () => {
    const envelopes: Counters[] = [];
    for (const n of [1_000, 10_000] as const) {
      const { document: doc, location } = createFc007V2SettingsWindow({
        stage: "d",
        denseProse: false,
        leadingPadding: 0,
      });
      const dialog = getDialog(doc);
      while (dialog.firstChild) dialog.removeChild(dialog.firstChild);
      appendDirectSpans(dialog, n);

      const invC = emptyCounters();
      const inv = inventoryDialogPageElements(dialog, inventoryHooks(invC));
      expect(inv.status).toBe("element_overflow");
      assertWithinBounds(invC);
      expect(invC.pageVisits).toBe(MAX_PAGE);
      envelopes.push({ ...invC });

      const c = emptyCounters();
      const result = captureFullContractV2(doc, location, {
        requireTopFrame: false,
        matchesModal: testMatchesModal,
        ...captureHooks(c),
      });
      expectCaptureBudgetAbstain(result, c, "element");
    }
    expect(envelopes[0]?.nodeVisits).toBe(envelopes[1]?.nodeVisits);
    expect(envelopes[0]?.pageVisits).toBe(envelopes[1]?.pageVisits);
    expect(envelopes[0]?.firstChildReads).toBe(envelopes[1]?.firstChildReads);
    expect(envelopes[0]?.nextSiblingReads).toBe(envelopes[1]?.nextSiblingReads);
  });

  it("C: 10,000 direct text nodes — node-budget abstention", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = getDialog(doc);
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild);
    appendDirectTexts(dialog, 10_000);

    const c = emptyCounters();
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ...captureHooks(c),
    });
    expectCaptureBudgetAbstain(result, c, "node");
  });

  it("D: 10,000 direct comment nodes — node-budget abstention", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = getDialog(doc);
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild);
    appendDirectComments(dialog, 10_000);

    const c = emptyCounters();
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ...captureHooks(c),
    });
    expectCaptureBudgetAbstain(result, c, "node");
  });

  it("E: mixed text/comment/element thousands — bounded by first limit hit", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = getDialog(doc);
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild);
    const ownerDoc = dialog.ownerDocument;
    for (let i = 0; i < 3_000; i += 1) {
      dialog.appendChild(ownerDoc.createTextNode("t"));
      dialog.appendChild(ownerDoc.createComment("c"));
      dialog.appendChild(ownerDoc.createElement("span"));
    }
    const c = emptyCounters();
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ...captureHooks(c),
    });
    expectCaptureBudgetAbstain(result, c, "either");
  });

  it("F: 10,000-element deep chain — element overflow, no stack blow-up", () => {
    const { document: doc } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = getDialog(doc);
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild);
    let cur: Element = dialog;
    for (let i = 0; i < 10_000; i += 1) {
      const next = doc.createElement("div");
      cur.appendChild(next);
      cur = next;
    }
    const c = emptyCounters();
    // Inventory only — full capture may exercise unrelated deep querySelector paths in happy-dom.
    const inv = inventoryDialogPageElements(dialog, inventoryHooks(c));
    expect(inv.status).toBe("element_overflow");
    assertWithinBounds(c);
    expect(c.pageVisits).toBe(MAX_PAGE);
    expect(c.nodeVisits).toBe(MAX_PAGE);
  });

  it("G: branching early ancestors — bounded pointer ops", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = getDialog(doc);
    const branch = doc.createElement("div");
    attachUnderDialog(dialog, branch);
    appendDirectSpans(branch, 5_000);
    const c = emptyCounters();
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ...captureHooks(c),
    });
    expectCaptureBudgetAbstain(result, c, "element");
  });

  it("H: effects-heavy 1k/10k direct spans Stage-C and Stage-D — same envelope", () => {
    const seen: { stage: string; n: number; c: Counters }[] = [];
    for (const stage of ["c", "d"] as const) {
      for (const n of [1_000, 10_000] as const) {
        const { document: doc, location } = createFc007V2SettingsWindow({
          stage,
          denseProse: false,
          leadingPadding: 0,
        });
        const dialog = getDialog(doc);
        floodEffectsDirectSpans(dialog, n);
        const invC = emptyCounters();
        const inv = inventoryDialogPageElements(dialog, inventoryHooks(invC));
        expect(inv.status).toBe("element_overflow");
        assertWithinBounds(invC);
        seen.push({ stage, n, c: { ...invC } });

        const c = emptyCounters();
        const result = captureFullContractV2(doc, location, {
          requireTopFrame: false,
          matchesModal: testMatchesModal,
          ...captureHooks(c),
        });
        expectCaptureBudgetAbstain(result, c, "element");
      }
    }
    const d1 = seen.find((s) => s.stage === "d" && s.n === 1_000)?.c;
    const d10 = seen.find((s) => s.stage === "d" && s.n === 10_000)?.c;
    const c1 = seen.find((s) => s.stage === "c" && s.n === 1_000)?.c;
    const c10 = seen.find((s) => s.stage === "c" && s.n === 10_000)?.c;
    expect(d1?.pageVisits).toBe(d10?.pageVisits);
    expect(c1?.pageVisits).toBe(c10?.pageVisits);
    expect(d1?.nodeVisits).toBe(d10?.nodeVisits);
    expect(c1?.nodeVisits).toBe(c10?.nodeVisits);
  });

  it("element boundary matrix 63/64/65 and owned host / lookalike", () => {
    for (const target of [63, 64, 65] as const) {
      const { document: doc, location } = createFc007V2SettingsWindow({
        stage: "d",
        denseProse: false,
        leadingPadding: 0,
      });
      const dialog = getDialog(doc);
      padPageElements(dialog, target);
      expect(countElements(dialog)).toBe(target);
      const c = emptyCounters();
      const result = captureFullContractV2(doc, location, {
        requireTopFrame: false,
        matchesModal: testMatchesModal,
        ...captureHooks(c),
      });
      if (target <= DIALOG_MAX_ELEMENTS) {
        expect(result.status).toBe("matched");
        expect(c.pageVisits).toBe(target);
      } else {
        expect(result.status).toBe("abstain");
        if (result.status === "abstain") {
          expect(
            result.reason === "DIALOG_ELEMENT_BUDGET_EXHAUSTED" ||
              result.reason === "DOCUMENT_ELEMENT_BUDGET_EXHAUSTED",
          ).toBe(true);
        }
        expect(c.pageVisits).toBe(MAX_PAGE);
      }
      assertWithinBounds(c);
    }

    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = getDialog(doc);
    padPageElements(dialog, DIALOG_MAX_ELEMENTS);
    const owned = doc.createElement("div");
    attachUnderDialog(dialog, owned);
    const withHost = emptyCounters();
    const ok = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ownedPreviewHost: owned,
      ...captureHooks(withHost),
    });
    expect(ok.status).toBe("matched");
    expect(withHost.pageVisits).toBe(DIALOG_MAX_ELEMENTS);

    const lookalike = doc.createElement("div");
    attachUnderDialog(dialog, lookalike);
    const over = emptyCounters();
    const bad = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ownedPreviewHost: owned,
      ...captureHooks(over),
    });
    expect(bad.status).toBe("abstain");
    if (bad.status === "abstain") {
      expect(bad.reason).toBe("DIALOG_ELEMENT_BUDGET_EXHAUSTED");
    }
    expect(over.pageVisits).toBe(MAX_PAGE);
  });

  it("node boundary matrix: cap-1 ok inventory, cap ok, cap+1 node abstain", () => {
    // Build dialog with only the dialog element + (N-1) text children → N node visits.
    const mk = (nodeTarget: number) => {
      const { document: doc } = createFc007V2SettingsWindow({
        stage: "d",
        denseProse: false,
        leadingPadding: 0,
      });
      const dialog = getDialog(doc);
      while (dialog.firstChild) dialog.removeChild(dialog.firstChild);
      appendDirectTexts(dialog, nodeTarget - 1);
      return dialog;
    };

    const under = mk(DIALOG_MAX_NODE_VISITS - 1);
    const cUnder = emptyCounters();
    const invUnder = inventoryDialogPageElements(under, inventoryHooks(cUnder));
    expect(invUnder.status).toBe("ok");
    expect(cUnder.nodeVisits).toBe(DIALOG_MAX_NODE_VISITS - 1);

    const at = mk(DIALOG_MAX_NODE_VISITS);
    const cAt = emptyCounters();
    const invAt = inventoryDialogPageElements(at, inventoryHooks(cAt));
    expect(invAt.status).toBe("ok");
    expect(cAt.nodeVisits).toBe(DIALOG_MAX_NODE_VISITS);

    const over = mk(DIALOG_MAX_NODE_VISITS + 1);
    const cOver = emptyCounters();
    const invOver = inventoryDialogPageElements(over, inventoryHooks(cOver));
    expect(invOver.status).toBe("node_overflow");
    expect(cOver.nodeVisits).toBe(MAX_NODE);

    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = getDialog(doc);
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild);
    appendDirectTexts(dialog, DIALOG_MAX_NODE_VISITS);
    const cap = emptyCounters();
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ...captureHooks(cap),
    });
    expectCaptureBudgetAbstain(result, cap, "node");
  });

  it("owned host: no descent into 10,000 malicious descendants; integrated invalid-host abstain", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = getDialog(doc);
    const owned = doc.createElement("div");
    attachUnderDialog(dialog, owned);
    appendDirectSpans(owned, 10_000);

    const c = emptyCounters();
    const inv = inventoryDialogPageElements(dialog, {
      ownedPreviewHost: owned,
      ...inventoryHooks(c),
    });
    // Inventory must not walk host descendants — node visits stay near fixture size + host.
    expect(c.nodeVisits).toBeLessThan(200);
    expect(c.pageVisits).toBeLessThanOrEqual(DIALOG_MAX_ELEMENTS);
    expect(inv.status === "ok" || inv.status === "owned_host_missing").toBe(true);

    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ownedPreviewHost: owned,
    });
    expect(result.status).toBe("abstain");
    if (result.status === "abstain") {
      expect(result.reason).toBe("OWNED_HOST_LIGHT_CHILDREN");
    }
  });

  it("lookalike with large descendants receives no exemption and stays bounded", () => {
    const { document: doc, location } = createFc007V2SettingsWindow({
      stage: "d",
      denseProse: false,
      leadingPadding: 0,
    });
    const dialog = getDialog(doc);
    const lookalike = doc.createElement("div");
    attachUnderDialog(dialog, lookalike);
    appendDirectSpans(lookalike, 10_000);
    const c = emptyCounters();
    const result = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
      ...captureHooks(c),
    });
    expectCaptureBudgetAbstain(result, c, "element");
  });

  it("Stage-C/D recognizers propagate element overflow without uncapped work", () => {
    for (const stage of ["c", "d"] as const) {
      const { document: doc } = createFc007V2SettingsWindow({ stage });
      const dialog = getDialog(doc);
      floodEffectsDirectSpans(dialog, 5_000);
      const c = emptyCounters();
      const opts = {
        matchesModal: testMatchesModal,
        retainedDocument: doc,
        ...inventoryHooks(c),
      };
      const out =
        stage === "c"
          ? recognizeStageC(dialog, FIXTURE_IDENTITY, opts)
          : recognizeStageD(dialog, FIXTURE_IDENTITY, opts);
      expect(out.status).toBe("abstain");
      if (out.status === "abstain") {
        expect(out.reason).toBe("DIALOG_ELEMENT_BUDGET_EXHAUSTED");
      }
      assertWithinBounds(c);
    }
  });

  it("production inventory source has no HTMLCollection / tree-walker APIs", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "../src/fc007/v2/dialog-page-elements.ts"), "utf8");
    // Strip block comments before API bans so documentation may name forbidden APIs.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bchildElementCount\b/);
    expect(code).not.toMatch(/\bcreateTreeWalker\b/);
    expect(code).not.toMatch(/\bTreeWalker\b/);
    expect(code).not.toMatch(/\bNodeIterator\b/);
    expect(code).not.toMatch(/\bgetElementsByTagName\b/);
    expect(code).not.toMatch(/\bgetElementsByClassName\b/);
    expect(code).not.toMatch(/\bquerySelectorAll\b/);
    expect(code).not.toMatch(/\.children\b/);
    expect(code).not.toMatch(/\.item\s*\(/);
    expect(code).toMatch(/\bnativeFirstChild\b/);
    expect(code).toMatch(/\bnativeNextSibling\b/);
    expect(code).not.toMatch(/\bnode\.firstChild\b/);
    expect(code).not.toMatch(/\bnode\.nextSibling\b/);
  });
});
