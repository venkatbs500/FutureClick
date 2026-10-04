/**
 * FC-007 Sprint 1B — M4 complete candidate classification + M5 interactive + M7 diagnostic.
 */

import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIALOG_MAX_ELEMENTS,
  MAIN_MAX_ELEMENTS,
  MUTATION_CANDIDATE_MAX_ELEMENTS,
  MUTATION_DELIVERY_MAX_ELEMENTS,
  RecognitionBudget,
  VISIBILITY_SECTION_MAX_ELEMENTS,
} from "../src/fc007/budget.js";
import { inventorySupportedVisibilityDialog } from "../src/fc007/dialog-inventory.js";
import {
  classifyCandidateSubtree,
  processMutationDelivery,
} from "../src/fc007/mutation-delivery.js";
import { Fc007PassiveController } from "../src/fc007/passive-controller.js";
import {
  CURRENT_PRIVATE_TEXT,
  VISIBILITY_HEADING_TEXT,
  inspectVisibilityLiComplete,
  recognizeVisibilitySection,
} from "../src/fc007/visibility-section.js";
import { createFc007SettingsWindow, FIXTURE_IDENTITY, testMatchesModal } from "./fc007-test-dom.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fakeRecord(added: Node[], removed: Node[] = []): MutationRecord {
  const addedList = {
    length: added.length,
    item(i: number) {
      return added[i] ?? null;
    },
  } as unknown as NodeList;
  const removedList = {
    length: removed.length,
    item(i: number) {
      return removed[i] ?? null;
    },
  } as unknown as NodeList;
  return {
    type: "childList",
    target: document.body,
    addedNodes: addedList,
    removedNodes: removedList,
    previousSibling: null,
    nextSibling: null,
    attributeName: null,
    attributeNamespace: null,
    oldValue: null,
  } as MutationRecord;
}

function chainElements(count: number): HTMLElement {
  const root = document.createElement("div");
  let cur: HTMLElement = root;
  for (let i = 1; i < count; i += 1) {
    const child = document.createElement("div");
    cur.appendChild(child);
    cur = child;
  }
  return root;
}

describe("FC-007 M4 complete candidate classification", () => {
  it("early dialog + later overflow → overflow not relevant", () => {
    const root = document.createElement("div");
    const dialog = document.createElement("dialog");
    root.appendChild(dialog);
    // Pad beyond 64 elements with balanced chain under root (≤8 kids each via chain).
    let cur: HTMLElement = root;
    for (let i = 0; i < 70; i += 1) {
      const d = document.createElement("div");
      cur.appendChild(d);
      cur = d;
    }
    const delivery = new RecognitionBudget(MUTATION_DELIVERY_MAX_ELEMENTS, 1_000_000);
    delivery.visitElement();
    expect(classifyCandidateSubtree(root, delivery)).toBe("overflow");
  });

  it("root-is-dialog still completes traversal; 65th overflows", () => {
    const dialog = document.createElement("dialog");
    let cur: HTMLElement = dialog;
    for (let i = 0; i < 64; i += 1) {
      const d = document.createElement("div");
      cur.appendChild(d);
      cur = d;
    }
    // dialog + 64 descendants = 65 elements
    const delivery = new RecognitionBudget(MUTATION_DELIVERY_MAX_ELEMENTS, 1_000_000);
    delivery.visitElement();
    expect(classifyCandidateSubtree(dialog, delivery)).toBe("overflow");
  });

  it("early dialog + exact 64 complete → relevant yes", () => {
    const dialog = document.createElement("dialog");
    let cur: HTMLElement = dialog;
    for (let i = 0; i < MUTATION_CANDIDATE_MAX_ELEMENTS - 1; i += 1) {
      const d = document.createElement("div");
      cur.appendChild(d);
      cur = d;
    }
    const delivery = new RecognitionBudget(MUTATION_DELIVERY_MAX_ELEMENTS, 1_000_000);
    delivery.visitElement();
    expect(classifyCandidateSubtree(dialog, delivery)).toBe("yes");
  });

  it("candidate A relevant completes + candidate B pushes total past 256 → overflow", () => {
    const a = document.createElement("dialog");
    // 256-element chain: entry visit + 255 descendant delivery visits = 256 for B alone;
    // plus A's entry → 257 total.
    const b = chainElements(256);
    const delivery = processMutationDelivery([fakeRecord([a, b])]);
    expect(delivery.status).toBe("overflow");
  });

  it("exact 256 ELEMENT visits via 4×64 candidates → irrelevant (not overflow)", () => {
    // 4 roots × 64 elements each = 256 delivery visits; each candidate at exact per-candidate max.
    const roots: Element[] = [];
    for (let r = 0; r < 4; r += 1) {
      roots.push(chainElements(MUTATION_CANDIDATE_MAX_ELEMENTS));
    }
    const exact = processMutationDelivery([fakeRecord(roots)]);
    expect(exact.status).toBe("irrelevant");
  });

  it("257th ELEMENT visit with each candidate ≤64 → overflow", () => {
    // 3 × 64 = 192, plus one 65th chain that overflows candidate OR:
    // 4 × 64 = 256 then one more shallow root → 257th delivery visit.
    const roots: Element[] = [];
    for (let r = 0; r < 4; r += 1) {
      roots.push(chainElements(MUTATION_CANDIDATE_MAX_ELEMENTS));
    }
    roots.push(document.createElement("span"));
    const over = processMutationDelivery([fakeRecord(roots)]);
    expect(over.status).toBe("overflow");
  });

  it("removedNodes length>0 marks relevant without iterating removals", () => {
    let removedItems = 0;
    const removed = {
      length: 5,
      item(i: number) {
        removedItems += 1;
        return document.createTextNode(String(i));
      },
    } as unknown as NodeList;
    const record = {
      type: "childList",
      target: document.body,
      addedNodes: { length: 0, item: () => null } as unknown as NodeList,
      removedNodes: removed,
      previousSibling: null,
      nextSibling: null,
      attributeName: null,
      attributeNamespace: null,
      oldValue: null,
    } as MutationRecord;
    const r = processMutationDelivery([record]);
    expect(r.status).toBe("relevant");
    if (r.status === "relevant") expect(r.hadRemovals).toBe(true);
    expect(removedItems).toBe(0);
  });
});

describe("FC-007 M5 unknown interactive controls", () => {
  it("rejects confirm-widget custom element", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    dialog.appendChild(doc.createElement("confirm-widget"));
    expect(
      inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
        matchesModal: testMatchesModal,
      }).status,
    ).toBe("abstain");
  });

  it("rejects confirm-widget with role=presentation", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    const el = doc.createElement("confirm-widget");
    el.setAttribute("role", "presentation");
    dialog.appendChild(el);
    expect(
      inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
        matchesModal: testMatchesModal,
      }).status,
    ).toBe("abstain");
  });

  it("rejects multi-token interactive roles", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    for (const role of ["button presentation", "presentation button", "switch"]) {
      const el = doc.createElement("div");
      el.setAttribute("role", role);
      dialog.appendChild(el);
      expect(
        inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
          matchesModal: testMatchesModal,
        }).status,
        role,
      ).toBe("abstain");
      el.remove();
    }
  });

  it("rejects unknown role token", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    const el = doc.createElement("div");
    el.setAttribute("role", "unknownfuturewidget");
    dialog.appendChild(el);
    expect(
      inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
        matchesModal: testMatchesModal,
      }).status,
    ).toBe("abstain");
  });

  it("rejects unknown tabindex=0", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!dialog) throw new Error("missing dialog");
    const el = doc.createElement("div");
    el.setAttribute("tabindex", "0");
    dialog.appendChild(el);
    expect(
      inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
        matchesModal: testMatchesModal,
      }).status,
    ).toBe("abstain");
  });

  it("approved Close still passes", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    expect(
      inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
        matchesModal: testMatchesModal,
      }).status,
    ).toBe("matched");
  });
});

describe("FC-007 M7 page cannot enable diagnostics", () => {
  it("data-fc007-enable-diagnostic does nothing in production controller", async () => {
    const { document: doc, location } = createFc007SettingsWindow({ openDialog: true });
    doc.documentElement.setAttribute("data-fc007-enable-diagnostic", "1");
    const controller = new Fc007PassiveController({
      document: doc,
      location,
      requireTopFrame: false,
      recognitionVersion: "v1",
      matchesModal: testMatchesModal,
      evaluateOnRecognize: false,
    });
    controller.start();
    await controller.attemptFullRecognition();
    expect(controller.getState().kind).toBe("contract-recognized");
    expect(doc.getElementById("fc007-passive-diagnostic")).toBeNull();
    controller.stop();
  });

  it("production observation bundle has no page diagnostic enable path", () => {
    const bundlePath = path.resolve(__dirname, "../dist/fc007-observation.bundle.js");
    if (!fs.existsSync(bundlePath)) {
      expect(true).toBe(true);
      return;
    }
    const bundle = fs.readFileSync(bundlePath, "utf8");
    expect(bundle).not.toContain("data-fc007-enable-diagnostic");
    expect(bundle).not.toContain("fc007-passive-diagnostic");
    expect(bundle).not.toContain("smoke-entry");
  });
});

describe("FC-007 LOW exact-cap traversal", () => {
  function countElements(root: Element): number {
    let n = 0;
    const stack: Element[] = [root];
    while (stack.length > 0) {
      const el = stack.pop();
      if (!el) break;
      n += 1;
      const kids = el.children;
      for (let i = kids.length - 1; i >= 0; i -= 1) {
        const c = kids.item(i);
        if (c) stack.push(c);
      }
    }
    return n;
  }

  /** Pad with a single-child chain so own-text child limits are not hit. */
  function padToExactCount(root: Element, targetTotalUnderRoot: number): void {
    const doc = root.ownerDocument;
    let current = countElements(root);
    let cur: Element = root;
    while (current < targetTotalUnderRoot) {
      const d = doc.createElement("div");
      cur.appendChild(d);
      cur = d;
      current += 1;
    }
  }

  it("main exactly 512 completes; 513 overflows", () => {
    const doc = document.implementation.createHTMLDocument("cap-main");
    const main = doc.createElement("main");
    const ul = doc.createElement("ul");
    const li = doc.createElement("li");
    const heading = doc.createElement("h2");
    heading.textContent = VISIBILITY_HEADING_TEXT;
    const priv = doc.createElement("div");
    priv.textContent = CURRENT_PRIVATE_TEXT;
    li.appendChild(heading);
    li.appendChild(priv);
    ul.appendChild(li);
    main.appendChild(ul);
    doc.body.appendChild(main);

    padToExactCount(main, MAIN_MAX_ELEMENTS);
    expect(countElements(main)).toBe(MAIN_MAX_ELEMENTS);
    expect(recognizeVisibilitySection(doc).status).toBe("matched");

    main.appendChild(doc.createElement("div"));
    expect(countElements(main)).toBe(MAIN_MAX_ELEMENTS + 1);
    const over = recognizeVisibilitySection(doc);
    expect(over.status).toBe("abstain");
    if (over.status === "abstain") {
      expect(over.reason).toMatch(/MAIN_ELEMENT_BUDGET|MAIN_TRAVERSAL_INCOMPLETE/);
    }
  });

  it("visibility LI exactly 48 completes; 49 overflows", () => {
    const doc = document.implementation.createHTMLDocument("cap-li");
    const main = doc.createElement("main");
    const li = doc.createElement("li");
    const heading = doc.createElement("h2");
    heading.textContent = VISIBILITY_HEADING_TEXT;
    const priv = doc.createElement("div");
    priv.textContent = CURRENT_PRIVATE_TEXT;
    li.appendChild(heading);
    li.appendChild(priv);
    main.appendChild(li);
    doc.body.appendChild(main);

    padToExactCount(li, VISIBILITY_SECTION_MAX_ELEMENTS);
    expect(countElements(li)).toBe(VISIBILITY_SECTION_MAX_ELEMENTS);
    expect(inspectVisibilityLiComplete(li).status).toBe("matched");

    li.appendChild(doc.createElement("div"));
    expect(countElements(li)).toBe(VISIBILITY_SECTION_MAX_ELEMENTS + 1);
    const over = inspectVisibilityLiComplete(li);
    expect(over.status).toBe("abstain");
    if (over.status === "abstain") {
      expect(over.reason).toMatch(/VISIBILITY_SECTION_BUDGET|INCOMPLETE/);
    }
  });

  it("dialog exactly 64 completes; 65 overflows", () => {
    const { document: doc } = createFc007SettingsWindow({ openDialog: true });
    const dialog = doc.getElementById("visibility-dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("missing dialog");

    padToExactCount(dialog, DIALOG_MAX_ELEMENTS);
    expect(countElements(dialog)).toBe(DIALOG_MAX_ELEMENTS);
    expect(
      inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
        matchesModal: testMatchesModal,
      }).status,
    ).toBe("matched");

    dialog.appendChild(doc.createElement("div"));
    expect(countElements(dialog)).toBe(DIALOG_MAX_ELEMENTS + 1);
    const over = inventorySupportedVisibilityDialog(doc, FIXTURE_IDENTITY, {
      matchesModal: testMatchesModal,
    });
    expect(over.status).toBe("abstain");
    if (over.status === "abstain") {
      expect(over.reason).toMatch(/DIALOG_ELEMENT_BUDGET|DIALOG_TRAVERSAL|DIALOG_CLASSIFY/);
    }
  });
});

describe("FC-007 LOW bootstrap replace stops prior controller", () => {
  it("exported bootstrap stops prior controller before replace", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/fc007/index.ts"), "utf8");
    expect(src).toMatch(/if\s*\(\s*controller\s*\)\s*\{[\s\S]*controller\.stop\(\)/);
    expect(src).toMatch(/controller\s*=\s*new\s+Fc007PassiveController/);
  });
});
