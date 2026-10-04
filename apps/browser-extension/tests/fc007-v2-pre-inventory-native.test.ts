/**
 * FC-007 final pre-inventory native property fix.
 *
 * Chromium's HTMLFormElement is [LegacyOverrideBuiltIns]: every ordinary
 * property lookup on a form consults the named interceptor, which builds the
 * listed/named-item cache. happy-dom has no such interceptor, so these tests
 * install OWN accessor traps on form instances: any ordinary lookup of a
 * trapped name hits the trap (exactly like a shadowing named control would),
 * while retained prototype getters invoked via Reflect.apply never do.
 */

import { describe, expect, it } from "vitest";
import { DOCUMENT_MAX_ELEMENTS_V2, RecognitionBudget } from "../src/fc007/budget.js";
import { captureFullContractV2 } from "../src/fc007/capture.js";
import { eventTargetsBlockButton } from "../src/fc007/interception.js";
import { classifyCandidateSubtree } from "../src/fc007/mutation-delivery.js";
import {
  getFormCollectionAccessCounters,
  nativeDocumentElement,
  nativeTagName,
  resetFormCollectionAccessCounters,
} from "../src/fc007/native-dom.js";
import { inventoryDocumentV2 } from "../src/fc007/v2/document-inventory-v2.js";
import { createFc007V2SettingsWindow, testMatchesModal } from "./fc007-test-dom.js";

const SHADOW_NAMES = [
  "tagName",
  "localName",
  "nodeName",
  "lang",
  "children",
  "childNodes",
  "parentElement",
  "parentNode",
  "firstChild",
  "nextSibling",
  "firstElementChild",
  "nextElementSibling",
  "nodeType",
  "getAttribute",
  "hasAttribute",
  "contains",
  "matches",
  "id",
  "name",
  "elements",
  "length",
  "action",
  "method",
  "target",
  "ownerDocument",
  "isConnected",
] as const;

function protoDescriptor(el: object, name: string): PropertyDescriptor | undefined {
  for (let p = Object.getPrototypeOf(el); p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, name);
    if (d) return d;
  }
  return undefined;
}

/** happy-dom wraps forms in a Proxy (named-property emulation); its handler frames are skipped. */
function directCallerIsFutureClick(): boolean {
  const frames = (new Error().stack ?? "").split("\n").slice(3);
  const caller = frames.find((f) => !/at Object\.(get|has) .*happy-dom/.test(f)) ?? "";
  return caller.includes("/src/fc007/");
}

/**
 * Trap every sensitive ordinary lookup on `el`; returns the hit log.
 * Only lookups whose DIRECT caller is FutureClick source are recorded — happy-dom
 * implements "native" getters in JS that read `this.*` internally (Chrome's are C++).
 * The true prototype value is always returned so the DOM keeps working.
 */
function trapOrdinaryLookups(el: Element): string[] {
  const hits: string[] = [];
  for (const name of SHADOW_NAMES) {
    const d = protoDescriptor(el, name);
    Object.defineProperty(el, name, {
      configurable: true,
      get() {
        if (directCallerIsFutureClick()) hits.push(name);
        if (!d) return undefined;
        return d.get ? d.get.call(el) : d.value;
      },
    });
  }
  return hits;
}

function stageD() {
  return createFc007V2SettingsWindow({ stage: "d", denseProse: false, leadingPadding: 0 });
}

function namedForm(doc: Document, count: number): HTMLFormElement {
  const f = doc.createElement("form");
  for (let i = 0; i < count; i += 1) {
    const inp = doc.createElement("input");
    inp.type = "hidden";
    inp.name = `c${i}`;
    f.appendChild(inp);
  }
  doc.body.insertBefore(f, doc.body.firstChild);
  return f;
}

describe("FC-007 retained native element classification", () => {
  it("nativeTagName ignores instance shadowing; ordinary tagName does not", () => {
    const { document: doc } = stageD();
    const f = doc.createElement("form");
    let shadowReads = 0;
    Object.defineProperty(f, "tagName", {
      configurable: true,
      get() {
        shadowReads += 1;
        return "SHADOWED";
      },
    });
    expect((f as unknown as { tagName: unknown }).tagName).toBe("SHADOWED");
    expect(shadowReads).toBe(1);
    expect(nativeTagName(f)).toBe("FORM");
    expect(shadowReads).toBe(1);
  });

  it("nativeDocumentElement matches documentElement and is bounded", () => {
    const { document: doc } = stageD();
    const r = nativeDocumentElement(doc, 4096);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.root).toBe(doc.documentElement);
    for (let i = 0; i < 10; i += 1) doc.insertBefore(doc.createComment("x"), doc.documentElement);
    expect(nativeDocumentElement(doc, 5).status).toBe("overflow");
  });
});

describe("FC-007 document inventory performs no ordinary form lookups", () => {
  it("valid fixture: trapped forms are classified natively; inventory result unchanged", () => {
    const { document: doc } = stageD();
    const form = doc.getElementById("visibility-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("no form");
    const extra = namedForm(doc, 5);
    const before = inventoryDocumentV2(doc);
    expect(before.status).toBe("ok");
    const formHits = trapOrdinaryLookups(form);
    const extraHits = trapOrdinaryLookups(extra);
    const inv = inventoryDocumentV2(doc);
    expect(inv.status).toBe("ok");
    if (inv.status === "ok" && before.status === "ok") {
      expect(inv.elements).toEqual(before.elements);
      expect(inv.mains).toEqual(before.mains);
      expect(inv.dialogs).toEqual(before.dialogs);
    }
    expect(formHits).toEqual([]);
    expect(extraHits).toEqual([]);
  });

  for (const count of [10_000, 100_000]) {
    it(`early form with ${count} named controls: same document budget, no lookups, no collection access`, () => {
      const { document: doc, location } = stageD();
      const f = namedForm(doc, count);
      const hits = trapOrdinaryLookups(f);
      const inv = inventoryDocumentV2(doc);
      expect(inv.status).toBe("abstain");
      if (inv.status === "abstain") {
        expect(inv.reason).toBe("DOCUMENT_ELEMENT_BUDGET_EXHAUSTED");
        expect(inv.elementVisitAttempts).toBe(DOCUMENT_MAX_ELEMENTS_V2 + 1);
      }
      expect(hits).toEqual([]);

      resetFormCollectionAccessCounters();
      const cap = captureFullContractV2(doc, location, {
        requireTopFrame: false,
        matchesModal: testMatchesModal,
      });
      expect(cap.status).toBe("abstain");
      if (cap.status === "abstain") expect(cap.reason).toBe("DOCUMENT_ELEMENT_BUDGET_EXHAUSTED");
      expect(hits).toEqual([]);
      const c = getFormCollectionAccessCounters();
      expect(c.elementsGetterCalls).toBe(0);
      expect(c.itemCalls).toBe(0);
      expect(c.completedInventoryMarks).toBe(0);
    }, 120_000);
  }

  it("10k vs 100k early named-control forms stop at identical visit counts", () => {
    const counts = [10_000, 100_000].map((n) => {
      const { document: doc } = stageD();
      namedForm(doc, n);
      const inv = inventoryDocumentV2(doc);
      if (inv.status !== "abstain") throw new Error("expected abstain");
      return [inv.nodeVisitAttempts, inv.elementVisitAttempts];
    });
    expect(counts[0]).toEqual(counts[1]);
  }, 120_000);

  it("form as documentElement: locale pre-step + inventory never look up form properties", () => {
    const { document: doc, location } = stageD();
    const oldRoot = doc.documentElement;
    const formRoot = doc.createElement("form");
    const hits = trapOrdinaryLookups(formRoot);
    doc.removeChild(oldRoot);
    doc.appendChild(formRoot);
    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("abstain");
    if (cap.status === "abstain") expect(cap.reason).toBe("UNSUPPORTED_LOCALE");
    expect(hits).toEqual([]);
    const inv = inventoryDocumentV2(doc);
    expect(inv.status).toBe("ok");
    expect(hits).toEqual([]);
  });

  it("documentElement is never read via ordinary Document lookup during capture", () => {
    const { document: doc, location } = stageD();
    let reads = 0;
    const real = doc.documentElement;
    Object.defineProperty(doc, "documentElement", {
      configurable: true,
      get() {
        reads += 1;
        return real;
      },
    });
    const cap = captureFullContractV2(doc, location, {
      requireTopFrame: false,
      matchesModal: testMatchesModal,
    });
    expect(cap.status).toBe("matched");
    if (cap.status === "matched") expect(cap.value.stage).toBe("final-confirmation");
    expect(reads).toBe(0);
  });
});

describe("FC-007 mutation classification and interception use retained getters", () => {
  it("classifyCandidateSubtree: forms in mutated subtrees are not looked up ordinarily", () => {
    const { document: doc } = stageD();
    const root = doc.createElement("div");
    const f = doc.createElement("form");
    const dlg = doc.createElement("dialog");
    f.appendChild(dlg);
    root.appendChild(f);
    const hits = trapOrdinaryLookups(f);
    expect(
      classifyCandidateSubtree(root, new RecognitionBudget(256, Number.POSITIVE_INFINITY)),
    ).toBe("yes");
    expect(hits).toEqual([]);
    const rootHits = trapOrdinaryLookups(root);
    expect(
      classifyCandidateSubtree(root, new RecognitionBudget(256, Number.POSITIVE_INFINITY)),
    ).toBe("yes");
    expect(rootHits).toEqual([]);
  });

  it("classifyCandidateSubtree preserves element order, dialog detection and overflow", () => {
    const { document: doc } = stageD();
    const root = doc.createElement("div");
    root.appendChild(doc.createTextNode("t"));
    const a = doc.createElement("span");
    root.appendChild(a);
    root.appendChild(doc.createTextNode("t"));
    expect(
      classifyCandidateSubtree(root, new RecognitionBudget(256, Number.POSITIVE_INFINITY)),
    ).toBe("no");
    a.appendChild(doc.createElement("dialog"));
    expect(
      classifyCandidateSubtree(root, new RecognitionBudget(256, Number.POSITIVE_INFINITY)),
    ).toBe("yes");
    for (let i = 0; i < 300; i += 1) root.appendChild(doc.createElement("i"));
    expect(
      classifyCandidateSubtree(root, new RecognitionBudget(256, Number.POSITIVE_INFINITY)),
    ).toBe("overflow");
    expect(classifyCandidateSubtree(doc.createTextNode("x"), new RecognitionBudget(4, 4))).toBe(
      "no",
    );
  });

  it("eventTargetsBlockButton: form in the ancestor chain is walked natively", () => {
    const { document: doc } = stageD();
    const button = doc.createElement("button");
    const f = doc.createElement("form");
    const span = doc.createElement("span");
    f.appendChild(span);
    button.appendChild(f);
    doc.body.appendChild(button);
    const hits = trapOrdinaryLookups(f);
    expect(eventTargetsBlockButton({ target: span } as unknown as Event, button)).toBe(true);
    expect(hits).toEqual([]);
    const outside = doc.createElement("span");
    doc.body.appendChild(outside);
    expect(eventTargetsBlockButton({ target: outside } as unknown as Event, button)).toBe(false);
  });

  it("production sources: no ordinary tag/children/parentElement/documentElement reads", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const read = (p: string) => strip(fs.readFileSync(path.join(here, "../src/fc007", p), "utf8"));
    const inv = read("v2/document-inventory-v2.ts");
    const mut = read("mutation-delivery.ts");
    const icp = read("interception.ts");
    const ctr = read("v2/contract-v2.ts");
    for (const src of [inv, mut, icp]) {
      expect(src).not.toMatch(/\.tagName\b/);
      expect(src).not.toMatch(/\.localName\b/);
      expect(src).not.toMatch(/\.children\b/);
      expect(src).not.toMatch(/\.parentElement\b/);
      expect(src).not.toMatch(/\.documentElement\b/);
      expect(src).not.toMatch(/\.nodeType\b/);
    }
    expect(ctr).not.toMatch(/\.documentElement\b/);
    const nd = read("native-dom.ts");
    expect(nd).toMatch(/captureNativeGetter\(Element\.prototype, "tagName"\)/);
    expect(nd).toMatch(/captureNativeGetter\(HTMLElement\.prototype, "lang"\)/);
  });
});
