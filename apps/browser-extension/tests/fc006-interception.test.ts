/**
 * FC-006 Sprint 2 / 2B interception eligibility + bounded pending match tests.
 */

import { describe, expect, it } from "vitest";
import {
  ATTR_CURRENT_VISIBILITY,
  ATTR_ENTITY_KEY,
  ATTR_FIXTURE_CONTRACT,
  ATTR_OPERATION,
  ATTR_REQUESTED_VISIBILITY,
  captureFc006ButtonObservation,
  MAX_ACTIVATION_ANCESTOR_HOPS,
} from "../src/fc006/capture.js";
import {
  eventTargetsPendingElement,
  passesNewPreviewEventGates,
  resolveExactFc006SupportedCandidate,
} from "../src/fc006/interception.js";
import {
  assessFc006RepositoryVisibilityObservation,
  FC006_FIXTURE_CONTRACT,
  FC006_OPERATION,
} from "../src/fc006/synthetic-repository-interception-adapter.js";

describe("FC-006 Sprint 2: Event gates", () => {
  it("requires observing + trusted cancelable non-prevented click", () => {
    const base = {
      type: "click",
      isTrusted: true,
      cancelable: true,
      defaultPrevented: false,
    };
    expect(passesNewPreviewEventGates(base, "observing")).toBe(true);
    expect(passesNewPreviewEventGates(base, "off")).toBe(false);
    expect(passesNewPreviewEventGates(base, "evaluating")).toBe(false);
    expect(passesNewPreviewEventGates({ ...base, isTrusted: false }, "observing")).toBe(false);
    expect(passesNewPreviewEventGates({ ...base, cancelable: false }, "observing")).toBe(false);
    expect(passesNewPreviewEventGates({ ...base, defaultPrevented: true }, "observing")).toBe(
      false,
    );
    expect(passesNewPreviewEventGates({ ...base, type: "mousedown" }, "observing")).toBe(false);
  });
});

describe("FC-006 Sprint 2B: Bounded pending match (no composedPath)", () => {
  class MockElement {
    parentElement: MockElement | null = null;
  }

  function withMockElement<T>(fn: () => T): T {
    const orig = (globalThis as unknown as { Element: unknown }).Element;
    (globalThis as unknown as { Element: unknown }).Element = MockElement;
    try {
      return fn();
    } finally {
      (globalThis as unknown as { Element: unknown }).Element = orig;
    }
  }

  function chain(depth: number): { pending: MockElement; leaf: MockElement } {
    const pending = new MockElement();
    let leaf: MockElement = pending;
    for (let i = 0; i < depth; i++) {
      const child = new MockElement();
      child.parentElement = leaf;
      leaf = child;
    }
    return { pending, leaf };
  }

  it("matches direct target with zero parent reads", () => {
    withMockElement(() => {
      const pending = new MockElement();
      let reads = 0;
      const hit = eventTargetsPendingElement(
        { target: pending } as unknown as Event,
        pending as unknown as HTMLButtonElement,
        {
          onParentRead: () => {
            reads += 1;
          },
        },
      );
      expect(hit).toBe(true);
      expect(reads).toBe(0);
    });
  });

  it("matches 1–4 hop descendants with ≤4 parent reads; rejects 5+ at window path", () => {
    withMockElement(() => {
      expect(MAX_ACTIVATION_ANCESTOR_HOPS).toBe(4);
      for (const depth of [1, 4]) {
        const { pending, leaf } = chain(depth);
        let reads = 0;
        const hit = eventTargetsPendingElement(
          { target: leaf } as unknown as Event,
          pending as unknown as HTMLButtonElement,
          {
            onParentRead: () => {
              reads += 1;
            },
          },
        );
        expect(hit).toBe(true);
        expect(reads).toBe(depth);
        expect(reads).toBeLessThanOrEqual(MAX_ACTIVATION_ANCESTOR_HOPS);
      }

      for (const depth of [5, 100, 1000]) {
        const { pending, leaf } = chain(depth);
        let reads = 0;
        const hit = eventTargetsPendingElement(
          { target: leaf } as unknown as Event,
          pending as unknown as HTMLButtonElement,
          {
            onParentRead: () => {
              reads += 1;
            },
          },
        );
        expect(hit).toBe(false);
        expect(reads).toBe(MAX_ACTIVATION_ANCESTOR_HOPS);
      }
    });
  });

  it("does not call composedPath even when provided (throws if called)", () => {
    withMockElement(() => {
      const pending = new MockElement();
      const child = new MockElement();
      child.parentElement = pending;
      const event = {
        target: child,
        composedPath: () => {
          throw new Error("COMPOSED_PATH_MUST_NOT_BE_USED");
        },
      } as unknown as Event;
      expect(eventTargetsPendingElement(event, pending as unknown as HTMLButtonElement)).toBe(true);
    });
  });

  it("eventTargetsPendingElement uses identity only", () => {
    withMockElement(() => {
      const pending = new MockElement();
      const other = new MockElement();
      expect(
        eventTargetsPendingElement(
          { target: pending } as unknown as Event,
          pending as unknown as HTMLButtonElement,
        ),
      ).toBe(true);
      expect(
        eventTargetsPendingElement(
          { target: other } as unknown as Event,
          pending as unknown as HTMLButtonElement,
        ),
      ).toBe(false);
    });
  });
});

describe("FC-006 Sprint 2: Exact candidate + shared applicability", () => {
  class MockNode {
    isConnected = true;
    ownerDocument: unknown = null;
    parentElement: MockElement | null = null;
  }
  class MockElement extends MockNode {
    tagName = "DIV";
    id = "";
    name = "";
    className = "";
    private attrs = new Map<string, string>();
    getAttribute(name: string): string | null {
      return this.attrs.get(name) ?? null;
    }
    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
    }
    removeAttribute(name: string): void {
      this.attrs.delete(name);
    }
  }
  class MockHTMLElement extends MockElement {
    isContentEditable = false;
  }
  class MockHTMLButtonElement extends MockHTMLElement {
    override tagName = "BUTTON";
    type = "button";
    disabled = false;
  }

  const location = {
    protocol: "http:",
    hostname: "127.0.0.1",
    port: "4173",
    pathname: "/fc006/repository-visibility-interception.html",
  } as Location;

  function installMocks(): () => void {
    const orig = {
      Node: (globalThis as unknown as { Node: unknown }).Node,
      Element: (globalThis as unknown as { Element: unknown }).Element,
      HTMLElement: (globalThis as unknown as { HTMLElement: unknown }).HTMLElement,
      HTMLButtonElement: (globalThis as unknown as { HTMLButtonElement: unknown })
        .HTMLButtonElement,
      document: globalThis.document,
    };
    (globalThis as unknown as { Node: unknown }).Node = MockNode;
    (globalThis as unknown as { Element: unknown }).Element = MockElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = MockHTMLElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      MockHTMLButtonElement;
    (globalThis as unknown as { document: unknown }).document = {};
    return () => {
      (globalThis as unknown as { Node: unknown }).Node = orig.Node;
      (globalThis as unknown as { Element: unknown }).Element = orig.Element;
      (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = orig.HTMLElement;
      (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
        orig.HTMLButtonElement;
      (globalThis as unknown as { document: unknown }).document = orig.document;
    };
  }

  function makeButton(overrides?: Record<string, string | null>): MockHTMLButtonElement {
    const btn = new MockHTMLButtonElement();
    btn.ownerDocument = globalThis.document;
    btn.setAttribute(ATTR_FIXTURE_CONTRACT, FC006_FIXTURE_CONTRACT);
    btn.setAttribute(ATTR_OPERATION, FC006_OPERATION);
    btn.setAttribute(ATTR_ENTITY_KEY, "fixture-repository");
    btn.setAttribute(ATTR_CURRENT_VISIBILITY, "private");
    btn.setAttribute(ATTR_REQUESTED_VISIBILITY, "public");
    if (overrides) {
      for (const [k, v] of Object.entries(overrides)) {
        if (v === null) btn.removeAttribute(k);
        else btn.setAttribute(k, v);
      }
    }
    return btn;
  }

  it("requires matched applicability; capture alone is not enough", () => {
    const restore = installMocks();
    try {
      const btn = makeButton({
        [ATTR_CURRENT_VISIBILITY]: "public",
        [ATTR_REQUESTED_VISIBILITY]: "private",
      });
      const observation = captureFc006ButtonObservation(
        btn as unknown as HTMLButtonElement,
        location,
      );
      expect(observation).not.toBeNull();
      if (!observation) return;
      const applicability = assessFc006RepositoryVisibilityObservation(observation);
      expect(applicability.status).toBe("unsupported");
      expect(
        resolveExactFc006SupportedCandidate(btn as unknown as EventTarget, location),
      ).toBeNull();
    } finally {
      restore();
    }
  });

  it("matches exact private→public candidate including spoofed UI marker", () => {
    const restore = installMocks();
    try {
      const btn = makeButton();
      btn.setAttribute("data-futureclick-ui", "true");
      const candidate = resolveExactFc006SupportedCandidate(
        btn as unknown as EventTarget,
        location,
      );
      expect(candidate).not.toBeNull();
      expect(candidate?.applicability.status).toBe("matched");
    } finally {
      restore();
    }
  });
});
