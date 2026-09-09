/**
 * FC-006 Capture / Authorization / Target Boundary Tests (Sprint 1)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IsoTimestamp } from "@futureclick/shared";
import {
  ATTR_CURRENT_VISIBILITY,
  ATTR_ENTITY_KEY,
  ATTR_FIXTURE_CONTRACT,
  ATTR_OPERATION,
  ATTR_REQUESTED_VISIBILITY,
  MAX_ACTIVATION_ANCESTOR_HOPS,
  MAX_BUTTON_ANCESTOR_INSPECTION_HOPS,
  authorizeFc006FixtureLocation,
  captureFc006ButtonObservation,
  inspectResolvedButtonAncestors,
  isFc006LocationAuthorized,
  resolveFc006ActivationButton,
} from "../src/fc006/capture.js";
import {
  FC006_FIXTURE_CONTRACT,
  FC006_OPERATION,
  FC006_ORIGIN,
  FC006_ROUTE_ID,
} from "../src/fc006/synthetic-repository-interception-adapter.js";

describe("FC-006 Location Authorization", () => {
  it("approves exact FC-006 host, port, protocol, and path", () => {
    const mockLocation = {
      protocol: "http:",
      hostname: "127.0.0.1",
      port: "4173",
      pathname: "/fc006/repository-visibility-interception.html",
    } as Location;
    expect(isFc006LocationAuthorized(mockLocation)).toBe(true);

    const auth = authorizeFc006FixtureLocation({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: "4173",
      pathname: "/fc006/repository-visibility-interception.html",
    });
    expect(auth.authorized).toBe(true);
    expect(auth.origin).toBe(FC006_ORIGIN);
    expect(auth.routeId).toBe(FC006_ROUTE_ID);
    expect("search" in auth).toBe(false);
    expect("query" in auth).toBe(false);
    expect("hash" in auth).toBe(false);
    expect("fragment" in auth).toBe(false);
  });

  it("rejects wrong hostname, protocol, port, pathname, and FC-005 route", () => {
    expect(
      isFc006LocationAuthorized({
        protocol: "http:",
        hostname: "localhost",
        port: "4173",
        pathname: "/fc006/repository-visibility-interception.html",
      } as Location),
    ).toBe(false);

    expect(
      isFc006LocationAuthorized({
        protocol: "https:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc006/repository-visibility-interception.html",
      } as Location),
    ).toBe(false);

    expect(
      isFc006LocationAuthorized({
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "3000",
        pathname: "/fc006/repository-visibility-interception.html",
      } as Location),
    ).toBe(false);

    expect(
      isFc006LocationAuthorized({
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/",
      } as Location),
    ).toBe(false);

    expect(
      isFc006LocationAuthorized({
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc005/repository-visibility.html",
      } as Location),
    ).toBe(false);
  });
});

describe("FC-006 Capture Privacy & Observation", () => {
  class MockNode {
    isConnected = true;
    ownerDocument = undefined as unknown;
    childNodes: unknown[] = [];
    attributes: unknown[] = [];
  }
  class MockElement extends MockNode {
    tagName = "BUTTON";
    parentElement: MockElement | null = null;
    id = "";
    name = "";
    className = "";
    type = "button";
    disabled = false;
    textContent = "";
    innerHTML = "";
    private attrs = new Map<string, string>();

    getAttribute(name: string): string | null {
      return this.attrs.get(name) ?? null;
    }
    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
    }
    getAttributeNames(): string[] {
      return [...this.attrs.keys()];
    }
  }
  class MockHTMLButtonElement extends MockElement {
    override tagName = "BUTTON";
  }

  let origNode: unknown;
  let origElement: unknown;
  let origHTMLElement: unknown;
  let origHTMLButtonElement: unknown;
  let origDocument: unknown;

  beforeEach(() => {
    origNode = (globalThis as unknown as { Node: unknown }).Node;
    origElement = (globalThis as unknown as { Element: unknown }).Element;
    origHTMLElement = (globalThis as unknown as { HTMLElement: unknown }).HTMLElement;
    origHTMLButtonElement = (globalThis as unknown as { HTMLButtonElement: unknown })
      .HTMLButtonElement;
    origDocument = globalThis.document;

    (globalThis as unknown as { Node: unknown }).Node = MockNode;
    (globalThis as unknown as { Element: unknown }).Element = MockElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = MockElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      MockHTMLButtonElement;
    (globalThis as unknown as { document: unknown }).document = {};
  });

  afterEach(() => {
    (globalThis as unknown as { Node: unknown }).Node = origNode;
    (globalThis as unknown as { Element: unknown }).Element = origElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = origHTMLElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      origHTMLButtonElement;
    (globalThis as unknown as { document: unknown }).document = origDocument;
  });

  function createValidButton(): MockHTMLButtonElement {
    const btn = new MockHTMLButtonElement();
    btn.ownerDocument = globalThis.document;
    btn.isConnected = true;
    btn.type = "button";
    btn.setAttribute(ATTR_FIXTURE_CONTRACT, FC006_FIXTURE_CONTRACT);
    btn.setAttribute(ATTR_OPERATION, FC006_OPERATION);
    btn.setAttribute(ATTR_ENTITY_KEY, "fixture-repository");
    btn.setAttribute(ATTR_CURRENT_VISIBILITY, "private");
    btn.setAttribute(ATTR_REQUESTED_VISIBILITY, "public");
    btn.textContent = "PASSWORD=do-not-capture user@example.com";
    btn.innerHTML = "<span>PASSWORD=do-not-capture</span>";
    btn.setAttribute("data-secret", "SUPER_SECRET");
    return btn;
  }

  it("captures valid FC-006 observation with truthful routeId and no query/fragment/text leakage", () => {
    const btn = createValidButton();
    const location = {
      protocol: "http:",
      hostname: "127.0.0.1",
      port: "4173",
      pathname: "/fc006/repository-visibility-interception.html",
      search: "?token=SUPER_SECRET",
      hash: "#PRIVATE_FRAGMENT",
      href: "http://127.0.0.1:4173/fc006/repository-visibility-interception.html?token=SUPER_SECRET#PRIVATE_FRAGMENT",
    } as Location;

    const obs = captureFc006ButtonObservation(btn as unknown as HTMLButtonElement, location, {
      timestampProvider: () => "2026-09-08T23:00:00.000Z" as IsoTimestamp,
    });

    expect(obs).not.toBeNull();
    if (!obs) return;
    expect(obs.page.origin).toBe(FC006_ORIGIN);
    expect(obs.page.routeId).toBe(FC006_ROUTE_ID);
    expect(obs.metadata.fixtureContract).toBe(FC006_FIXTURE_CONTRACT);
    expect(obs.metadata.operation).toBe(FC006_OPERATION);
    expect(obs.metadata.entityKey).toBe("fixture-repository");
    expect(obs.metadata.currentVisibility).toBe("private");
    expect(obs.metadata.requestedVisibility).toBe("public");

    const serialized = JSON.stringify(obs);
    expect(serialized).not.toContain("SUPER_SECRET");
    expect(serialized).not.toContain("PRIVATE_FRAGMENT");
    expect(serialized).not.toContain("PASSWORD");
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("data-secret");
    expect(serialized).not.toContain("token=");
  });

  it("rejects unauthorized location and non-FC-006 contract", () => {
    const btn = createValidButton();
    expect(
      captureFc006ButtonObservation(
        btn as unknown as HTMLButtonElement,
        {
          protocol: "http:",
          hostname: "127.0.0.1",
          port: "4173",
          pathname: "/fc005/repository-visibility.html",
        } as Location,
      ),
    ).toBeNull();

    btn.setAttribute(ATTR_FIXTURE_CONTRACT, "fc005.repository-visibility.v1");
    expect(
      captureFc006ButtonObservation(
        btn as unknown as HTMLButtonElement,
        {
          protocol: "http:",
          hostname: "127.0.0.1",
          port: "4173",
          pathname: "/fc006/repository-visibility-interception.html",
        } as Location,
      ),
    ).toBeNull();
  });
});

describe("FC-006 Bounded Target Resolution", () => {
  class MockNode {
    isConnected = true;
    ownerDocument = undefined as unknown;
    childNodes: unknown[] = [];
    attributes: unknown[] = [];
  }
  class MockElement extends MockNode {
    tagName = "SPAN";
    parentElement: MockElement | null = null;
    contentEditable: string | null = null;
    isContentEditable = false;
    id = "";
    name = "";
    className = "";
    getAttribute(name: string): string | null {
      if (name === "contenteditable") return this.contentEditable;
      if (name === "role") return null;
      return null;
    }
  }
  class MockHTMLElement extends MockElement {}
  class MockHTMLButtonElement extends MockHTMLElement {
    override tagName = "BUTTON";
    type = "button";
    disabled = false;
  }
  class MockHTMLFieldSetElement extends MockHTMLElement {
    override tagName = "FIELDSET";
    disabled = false;
  }

  let origNode: unknown;
  let origElement: unknown;
  let origHTMLElement: unknown;
  let origHTMLButtonElement: unknown;
  let origHTMLFieldSetElement: unknown;
  let origDocument: unknown;

  beforeEach(() => {
    origNode = (globalThis as unknown as { Node: unknown }).Node;
    origElement = (globalThis as unknown as { Element: unknown }).Element;
    origHTMLElement = (globalThis as unknown as { HTMLElement: unknown }).HTMLElement;
    origHTMLButtonElement = (globalThis as unknown as { HTMLButtonElement: unknown })
      .HTMLButtonElement;
    origHTMLFieldSetElement = (globalThis as unknown as { HTMLFieldSetElement: unknown })
      .HTMLFieldSetElement;
    origDocument = globalThis.document;

    (globalThis as unknown as { Node: unknown }).Node = MockNode;
    (globalThis as unknown as { Element: unknown }).Element = MockElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = MockHTMLElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      MockHTMLButtonElement;
    (globalThis as unknown as { HTMLFieldSetElement: unknown }).HTMLFieldSetElement =
      MockHTMLFieldSetElement;
    (globalThis as unknown as { document: unknown }).document = {};
  });

  afterEach(() => {
    (globalThis as unknown as { Node: unknown }).Node = origNode;
    (globalThis as unknown as { Element: unknown }).Element = origElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = origHTMLElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      origHTMLButtonElement;
    (globalThis as unknown as { HTMLFieldSetElement: unknown }).HTMLFieldSetElement =
      origHTMLFieldSetElement;
    (globalThis as unknown as { document: unknown }).document = origDocument;
  });

  it("MAX_ACTIVATION_ANCESTOR_HOPS is exactly 4", () => {
    expect(MAX_ACTIVATION_ANCESTOR_HOPS).toBe(4);
  });

  it("accepts direct button and 1–4 hop descendants; rejects 5 and 100 hops", () => {
    const btn = new MockHTMLButtonElement();
    btn.ownerDocument = globalThis.document;
    expect(resolveFc006ActivationButton(btn as unknown as EventTarget)).toBe(
      btn as unknown as HTMLButtonElement,
    );

    const makeChain = (hops: number): MockElement => {
      let curr: MockElement = btn;
      for (let i = 0; i < hops; i++) {
        const child = new MockElement();
        child.ownerDocument = globalThis.document;
        child.parentElement = curr;
        curr = child;
      }
      return curr;
    };

    expect(resolveFc006ActivationButton(makeChain(1) as unknown as EventTarget)).toBe(
      btn as unknown as HTMLButtonElement,
    );
    expect(resolveFc006ActivationButton(makeChain(4) as unknown as EventTarget)).toBe(
      btn as unknown as HTMLButtonElement,
    );
    expect(resolveFc006ActivationButton(makeChain(5) as unknown as EventTarget)).toBeNull();
    expect(resolveFc006ActivationButton(makeChain(100) as unknown as EventTarget)).toBeNull();
  });

  it("rejects disabled, disabled fieldset child, contenteditable, editable ancestor, detached, foreign document", () => {
    const disabled = new MockHTMLButtonElement();
    disabled.ownerDocument = globalThis.document;
    disabled.disabled = true;
    expect(resolveFc006ActivationButton(disabled as unknown as EventTarget)).toBeNull();

    const fieldset = new MockHTMLFieldSetElement();
    fieldset.ownerDocument = globalThis.document;
    fieldset.disabled = true;
    const childBtn = new MockHTMLButtonElement();
    childBtn.ownerDocument = globalThis.document;
    childBtn.parentElement = fieldset;
    expect(resolveFc006ActivationButton(childBtn as unknown as EventTarget)).toBeNull();

    const editableBtn = new MockHTMLButtonElement();
    editableBtn.ownerDocument = globalThis.document;
    editableBtn.isContentEditable = true;
    editableBtn.contentEditable = "true";
    expect(resolveFc006ActivationButton(editableBtn as unknown as EventTarget)).toBeNull();

    const editableWrap = new MockHTMLElement();
    editableWrap.ownerDocument = globalThis.document;
    editableWrap.isContentEditable = true;
    editableWrap.contentEditable = "true";
    const btnUnderEditable = new MockHTMLButtonElement();
    btnUnderEditable.ownerDocument = globalThis.document;
    btnUnderEditable.parentElement = editableWrap;
    const span = new MockElement();
    span.ownerDocument = globalThis.document;
    span.parentElement = btnUnderEditable;
    expect(resolveFc006ActivationButton(span as unknown as EventTarget)).toBeNull();

    const detached = new MockHTMLButtonElement();
    detached.ownerDocument = globalThis.document;
    detached.isConnected = false;
    expect(resolveFc006ActivationButton(detached as unknown as EventTarget)).toBeNull();

    const foreign = new MockHTMLButtonElement();
    foreign.ownerDocument = {};
    foreign.isConnected = true;
    expect(resolveFc006ActivationButton(foreign as unknown as EventTarget)).toBeNull();
  });

  it("rejects non-Element targets that cannot traverse light-DOM ancestry (shadow-boundary fail-closed)", () => {
    const orphan = new MockNode();
    orphan.ownerDocument = globalThis.document;
    orphan.isConnected = true;
    expect(resolveFc006ActivationButton(orphan as unknown as EventTarget)).toBeNull();
  });
});

describe("FC-006 Sprint 1A: Bounded Post-Button Ancestor Inspection", () => {
  class MockNode {
    isConnected = true;
    ownerDocument = undefined as unknown;
    childNodes: unknown[] = [];
    attributes: unknown[] = [];
  }
  class MockElement extends MockNode {
    tagName = "DIV";
    parentElement: MockElement | null = null;
    contentEditable: string | null = null;
    isContentEditable = false;
    id = "";
    name = "";
    className = "";
    getAttribute(name: string): string | null {
      if (name === "contenteditable") return this.contentEditable;
      if (name === "role") return null;
      return null;
    }
  }
  class MockHTMLElement extends MockElement {}
  class MockHTMLButtonElement extends MockHTMLElement {
    override tagName = "BUTTON";
    type = "button";
    disabled = false;
  }
  class MockHTMLFieldSetElement extends MockHTMLElement {
    override tagName = "FIELDSET";
    disabled = false;
  }

  let origNode: unknown;
  let origElement: unknown;
  let origHTMLElement: unknown;
  let origHTMLButtonElement: unknown;
  let origHTMLFieldSetElement: unknown;
  let origDocument: unknown;

  beforeEach(() => {
    origNode = (globalThis as unknown as { Node: unknown }).Node;
    origElement = (globalThis as unknown as { Element: unknown }).Element;
    origHTMLElement = (globalThis as unknown as { HTMLElement: unknown }).HTMLElement;
    origHTMLButtonElement = (globalThis as unknown as { HTMLButtonElement: unknown })
      .HTMLButtonElement;
    origHTMLFieldSetElement = (globalThis as unknown as { HTMLFieldSetElement: unknown })
      .HTMLFieldSetElement;
    origDocument = globalThis.document;

    (globalThis as unknown as { Node: unknown }).Node = MockNode;
    (globalThis as unknown as { Element: unknown }).Element = MockElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = MockHTMLElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      MockHTMLButtonElement;
    (globalThis as unknown as { HTMLFieldSetElement: unknown }).HTMLFieldSetElement =
      MockHTMLFieldSetElement;
    (globalThis as unknown as { document: unknown }).document = {};
  });

  afterEach(() => {
    (globalThis as unknown as { Node: unknown }).Node = origNode;
    (globalThis as unknown as { Element: unknown }).Element = origElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = origHTMLElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      origHTMLButtonElement;
    (globalThis as unknown as { HTMLFieldSetElement: unknown }).HTMLFieldSetElement =
      origHTMLFieldSetElement;
    (globalThis as unknown as { document: unknown }).document = origDocument;
  });

  /**
   * Build a direct button beneath `wrapperCount` ordinary wrappers.
   * Outermost wrapper has parentElement = null (document/root boundary).
   * Definition: each wrapper is one inspected Element ancestor.
   */
  function buttonUnderWrappers(wrapperCount: number): MockHTMLButtonElement {
    const btn = new MockHTMLButtonElement();
    btn.ownerDocument = globalThis.document;
    btn.isConnected = true;
    btn.type = "button";

    let child: MockElement = btn;
    for (let i = 0; i < wrapperCount; i++) {
      const wrap = new MockElement();
      wrap.ownerDocument = globalThis.document;
      child.parentElement = wrap;
      child = wrap;
    }
    // outermost parentElement remains null → root boundary
    return btn;
  }

  it("MAX_BUTTON_ANCESTOR_INSPECTION_HOPS is exactly 8", () => {
    expect(MAX_BUTTON_ANCESTOR_INSPECTION_HOPS).toBe(8);
  });

  it("accepts 0/1/8 wrappers; rejects 9/40/100 with bounded parentElement reads", () => {
    const cases: Array<{
      wrappers: number;
      accepted: boolean;
      maxReads: number;
    }> = [
      { wrappers: 0, accepted: true, maxReads: 1 },
      { wrappers: 1, accepted: true, maxReads: 2 },
      { wrappers: 8, accepted: true, maxReads: 9 },
      { wrappers: 9, accepted: false, maxReads: 9 },
      { wrappers: 40, accepted: false, maxReads: 9 },
      { wrappers: 100, accepted: false, maxReads: 9 },
    ];

    for (const c of cases) {
      const btn = buttonUnderWrappers(c.wrappers);
      let reads = 0;
      const result = inspectResolvedButtonAncestors(btn as unknown as Element, {
        onParentRead: () => {
          reads += 1;
        },
      });
      expect(result.ok).toBe(c.accepted);
      expect(result.ancestorReads).toBe(reads);
      expect(result.ancestorReads).toBeLessThanOrEqual(c.maxReads);
      expect(result.ancestorReads).toBeLessThanOrEqual(MAX_BUTTON_ANCESTOR_INSPECTION_HOPS + 1);

      if (!c.accepted) {
        expect(result.rejectionReason).toBe("ANCESTRY_DEPTH_EXCEEDED");
      }

      const resolved = resolveFc006ActivationButton(btn as unknown as EventTarget);
      if (c.accepted) {
        expect(resolved).toBe(btn as unknown as HTMLButtonElement);
      } else {
        expect(resolved).toBeNull();
      }
    }
  });

  it("100-wrapper case stops at bound and does not traverse all wrappers", () => {
    const btn = buttonUnderWrappers(100);
    const seenParents: Array<Element | null> = [];
    const result = inspectResolvedButtonAncestors(btn as unknown as Element, {
      onParentRead: (parent) => {
        seenParents.push(parent);
      },
    });
    expect(result.ok).toBe(false);
    expect(result.rejectionReason).toBe("ANCESTRY_DEPTH_EXCEEDED");
    expect(result.ancestorReads).toBe(9);
    expect(seenParents).toHaveLength(9);
    // Never reached wrapper #10..#100
    expect(result.ancestorReads).toBeLessThan(100);
  });

  it("disabled fieldset: shallow and final inspected ancestor reject; beyond bound rejects by depth", () => {
    // Shallow: button -> disabled fieldset -> null
    const shallowFs = new MockHTMLFieldSetElement();
    shallowFs.ownerDocument = globalThis.document;
    shallowFs.disabled = true;
    const shallowBtn = new MockHTMLButtonElement();
    shallowBtn.ownerDocument = globalThis.document;
    shallowBtn.parentElement = shallowFs;
    const shallow = inspectResolvedButtonAncestors(shallowBtn as unknown as Element);
    expect(shallow.ok).toBe(false);
    expect(shallow.rejectionReason).toBe("DISABLED_FIELDSET_ANCESTOR");
    expect(resolveFc006ActivationButton(shallowBtn as unknown as EventTarget)).toBeNull();

    // Final inspected ancestor (= hop 8): button -> w1..w7 -> fieldset(disabled) -> null
    const finalBtn = new MockHTMLButtonElement();
    finalBtn.ownerDocument = globalThis.document;
    let curr: MockElement = finalBtn;
    for (let i = 0; i < 7; i++) {
      const wrap = new MockElement();
      wrap.ownerDocument = globalThis.document;
      curr.parentElement = wrap;
      curr = wrap;
    }
    const fsAt8 = new MockHTMLFieldSetElement();
    fsAt8.ownerDocument = globalThis.document;
    fsAt8.disabled = true;
    curr.parentElement = fsAt8;
    const finalRes = inspectResolvedButtonAncestors(finalBtn as unknown as Element);
    expect(finalRes.ok).toBe(false);
    expect(finalRes.rejectionReason).toBe("DISABLED_FIELDSET_ANCESTOR");
    expect(finalRes.ancestorReads).toBeLessThanOrEqual(MAX_BUTTON_ANCESTOR_INSPECTION_HOPS + 1);

    // Beyond bound: 8 ordinary wrappers then disabled fieldset as 9th
    const beyondBtn = new MockHTMLButtonElement();
    beyondBtn.ownerDocument = globalThis.document;
    let bcurr: MockElement = beyondBtn;
    for (let i = 0; i < 8; i++) {
      const wrap = new MockElement();
      wrap.ownerDocument = globalThis.document;
      bcurr.parentElement = wrap;
      bcurr = wrap;
    }
    const fsBeyond = new MockHTMLFieldSetElement();
    fsBeyond.ownerDocument = globalThis.document;
    fsBeyond.disabled = true;
    bcurr.parentElement = fsBeyond;
    let reads = 0;
    const beyondRes = inspectResolvedButtonAncestors(beyondBtn as unknown as Element, {
      onParentRead: () => {
        reads += 1;
      },
    });
    expect(beyondRes.ok).toBe(false);
    expect(beyondRes.rejectionReason).toBe("ANCESTRY_DEPTH_EXCEEDED");
    expect(beyondRes.ancestorReads).toBe(9);
    expect(reads).toBe(9);
  });

  it("editable ancestor: shallow and final inspected ancestor reject; beyond bound rejects by depth", () => {
    const editable = new MockHTMLElement();
    editable.ownerDocument = globalThis.document;
    editable.isContentEditable = true;
    editable.contentEditable = "true";
    const shallowBtn = new MockHTMLButtonElement();
    shallowBtn.ownerDocument = globalThis.document;
    shallowBtn.parentElement = editable;
    const shallow = inspectResolvedButtonAncestors(shallowBtn as unknown as Element);
    expect(shallow.ok).toBe(false);
    expect(shallow.rejectionReason).toBe("EDITABLE_ANCESTOR");

    // Final hop 8 editable
    const finalBtn = new MockHTMLButtonElement();
    finalBtn.ownerDocument = globalThis.document;
    let curr: MockElement = finalBtn;
    for (let i = 0; i < 7; i++) {
      const wrap = new MockElement();
      wrap.ownerDocument = globalThis.document;
      curr.parentElement = wrap;
      curr = wrap;
    }
    const editAt8 = new MockHTMLElement();
    editAt8.ownerDocument = globalThis.document;
    editAt8.isContentEditable = true;
    editAt8.contentEditable = "true";
    curr.parentElement = editAt8;
    const finalRes = inspectResolvedButtonAncestors(finalBtn as unknown as Element);
    expect(finalRes.ok).toBe(false);
    expect(finalRes.rejectionReason).toBe("EDITABLE_ANCESTOR");

    // Beyond: 8 wrappers + editable as 9th
    const beyondBtn = new MockHTMLButtonElement();
    beyondBtn.ownerDocument = globalThis.document;
    let bcurr: MockElement = beyondBtn;
    for (let i = 0; i < 8; i++) {
      const wrap = new MockElement();
      wrap.ownerDocument = globalThis.document;
      bcurr.parentElement = wrap;
      bcurr = wrap;
    }
    const editBeyond = new MockHTMLElement();
    editBeyond.ownerDocument = globalThis.document;
    editBeyond.isContentEditable = true;
    editBeyond.contentEditable = "true";
    bcurr.parentElement = editBeyond;
    const beyondRes = inspectResolvedButtonAncestors(beyondBtn as unknown as Element);
    expect(beyondRes.ok).toBe(false);
    expect(beyondRes.rejectionReason).toBe("ANCESTRY_DEPTH_EXCEEDED");
    expect(beyondRes.ancestorReads).toBe(9);
  });
});

describe("FC-006 Bootstrap (Sprint 2)", () => {
  it("bootstraps off state with early listener path and rejects unauthorized", async () => {
    const { bootstrapFc006, getFc006RuntimeState, getFc006Controller } = await import(
      "../src/fc006/index.js"
    );

    const originalWindow = globalThis.window;
    try {
      const addEventListener = vi.fn();
      (globalThis as unknown as { window: unknown }).window = {
        addEventListener,
        location: {
          protocol: "http:",
          hostname: "127.0.0.1",
          port: "4173",
          pathname: "/fc006/repository-visibility-interception.html",
        },
      };
      expect(bootstrapFc006()).toBe(true);
      const state = getFc006RuntimeState();
      expect(state).not.toBeNull();
      expect(state?.mode).toBe("off");
      expect(state?.activeInterception).toBe(false);
      expect(state?.sprint).toBe(3);
      expect(addEventListener).toHaveBeenCalled();
      expect(getFc006Controller()).not.toBeNull();

      (globalThis as unknown as { window: unknown }).window = {
        addEventListener: vi.fn(),
        location: {
          protocol: "http:",
          hostname: "127.0.0.1",
          port: "4173",
          pathname: "/fc005/repository-visibility.html",
        },
      };
      expect(bootstrapFc006()).toBe(false);
    } finally {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  });
});
