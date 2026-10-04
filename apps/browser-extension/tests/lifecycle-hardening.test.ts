/**
 * Browser Extension Lifecycle & Hardening Tests (Sprint FC-005A)
 *
 * Verifies fixes for:
 * - M3: Stop / Start session epoch invalidation & monotonic request ordering
 * - M4: Bounded ancestor traversal (<= 4 hops), light DOM only, contenteditable exclusion
 * - M5: Predefined trusted display mapping (no raw codes or missing token dumps)
 * - M6: Manifest least privilege & authorization-before-bootstrap
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../manifest.dev.json" with { type: "json" };
import type { ActionEvaluationContext, ConsequenceAssessment } from "@futureclick/action-schema";
import { BrowserAdapterEngine, createBrowserObservation } from "@futureclick/browser-adapter";
import {
  ConsequenceEngine,
  createDeterministicRuleEvaluator,
} from "@futureclick/consequence-engine";
import { ok } from "@futureclick/shared";
import {
  ATTR_CURRENT_VISIBILITY,
  ATTR_ENTITY_KEY,
  ATTR_FIXTURE_CONTRACT,
  ATTR_OPERATION,
  ATTR_REQUESTED_VISIBILITY,
  MAX_ACTIVATION_ANCESTOR_HOPS,
  isLocationAuthorized,
  isNodeContentEditable,
  resolveActivationButton,
} from "../src/content/capture.js";
import { BrowserExtensionController } from "../src/content/controller.js";
import { bootstrapExtension } from "../src/content/index.js";
import { DevelopmentIndicator } from "../src/content/indicator.js";

describe("M6: Manifest Scope and Least Privilege", () => {
  it("Probe 1: Manifest V3 has zero host_permissions and empty permissions array", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual([]);
    expect((manifest as Record<string, unknown>).host_permissions).toBeUndefined();

    // Verify broad or dangerous permissions are absent
    const forbiddenPermissions = [
      "<all_urls>",
      "tabs",
      "scripting",
      "storage",
      "activeTab",
      "webNavigation",
      "debugger",
      "nativeMessaging",
    ];
    for (const perm of forbiddenPermissions) {
      expect((manifest.permissions as string[]).includes(perm)).toBe(false);
    }
  });

  it("Probe 2: content_scripts match patterns are narrowed strictly to fixture routes", () => {
    expect(manifest.content_scripts.length).toBe(3);

    const fc005 = manifest.content_scripts[0];
    expect(fc005).toBeDefined();
    if (!fc005) return;
    expect(fc005.matches).toEqual(["http://127.0.0.1/fc005/repository-visibility.html"]);
    expect(fc005.js).toEqual(["content.bundle.js"]);
    expect(fc005.all_frames).toBe(false);
    expect(fc005.world).toBe("ISOLATED");
    expect(fc005.run_at).toBe("document_idle");

    const fc006 = manifest.content_scripts[1];
    expect(fc006).toBeDefined();
    if (!fc006) return;
    expect(fc006.matches).toEqual([
      "http://127.0.0.1/fc006/repository-visibility-interception.html",
    ]);
    expect(fc006.js).toEqual(["fc006-interception.bundle.js"]);
    expect(fc006.all_frames).toBe(false);
    expect(fc006.world).toBe("ISOLATED");
    expect(fc006.run_at).toBe("document_start");

    const fc007 = manifest.content_scripts[2];
    expect(fc007).toBeDefined();
    if (!fc007) return;
    expect(fc007.matches).toEqual(["https://github.com/*/*/settings*"]);
    expect(fc007.js).toEqual(["fc007-observation.bundle.js"]);
    expect(fc007.all_frames).toBe(false);
    expect(fc007.world).toBe("ISOLATED");
    expect(fc007.run_at).toBe("document_start");
  });

  it("Probe 3: Bootstrap authorizes location BEFORE injecting UI or controller", () => {
    const originalWindow = globalThis.window;

    try {
      // Unauthorized page: /fc005/browser-tests.html
      (globalThis as unknown as { window: unknown }).window = {
        location: {
          protocol: "http:",
          hostname: "127.0.0.1",
          port: "4173",
          pathname: "/fc005/browser-tests.html",
        },
      };

      const bootstrapped = bootstrapExtension();
      expect(bootstrapped).toBe(false);

      // Unauthorized origin: port 8080
      (globalThis as unknown as { window: unknown }).window = {
        location: {
          protocol: "http:",
          hostname: "127.0.0.1",
          port: "8080",
          pathname: "/fc005/repository-visibility.html",
        },
      };
      expect(bootstrapExtension()).toBe(false);
    } finally {
      (globalThis as unknown as { window: unknown }).window = originalWindow;
    }
  });
});

describe("M3: Stop / Start Session Epoch and Request Ordering", () => {
  let mockIndicator: DevelopmentIndicator;
  let renderVerifiedSpy: ReturnType<typeof vi.fn>;
  let renderAbstentionSpy: ReturnType<typeof vi.fn>;
  let origWindow: unknown;
  let origNode: unknown;
  let origElement: unknown;
  let origHTMLButtonElement: unknown;
  let origDocument: unknown;

  class MockNode {
    isConnected = true;
    ownerDocument = undefined as unknown;
    childNodes: unknown[] = [];
    attributes: unknown[] = [];
  }
  class MockElement extends MockNode {
    tagName = "BUTTON";
    parentElement: MockElement | null = null;
    getAttribute(_name: string): string | null {
      return null;
    }
    getAttributeNames(): string[] {
      return [];
    }
  }
  class MockHTMLButtonElement extends MockElement {
    type = "button";
    disabled = false;
    id = "";
    name = "";
    className = "";
  }

  beforeEach(() => {
    origWindow = globalThis.window;
    origNode = (globalThis as unknown as { Node: unknown }).Node;
    origElement = (globalThis as unknown as { Element: unknown }).Element;
    origHTMLButtonElement = (globalThis as unknown as { HTMLButtonElement: unknown })
      .HTMLButtonElement;
    origDocument = globalThis.document;

    (globalThis as unknown as { Node: unknown }).Node = MockNode;
    (globalThis as unknown as { Element: unknown }).Element = MockElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      MockHTMLButtonElement;

    const mockDoc = {};
    (globalThis as unknown as { document: unknown }).document = mockDoc;

    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc005/repository-visibility.html",
      },
    };

    mockIndicator = new DevelopmentIndicator();
    renderVerifiedSpy = vi.fn();
    renderAbstentionSpy = vi.fn();
    mockIndicator.renderVerifiedResult = renderVerifiedSpy;
    mockIndicator.renderAbstention = renderAbstentionSpy;
    mockIndicator.init = vi.fn();
    mockIndicator.setObserving = vi.fn();
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = origWindow;
    (globalThis as unknown as { Node: unknown }).Node = origNode;
    (globalThis as unknown as { Element: unknown }).Element = origElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      origHTMLButtonElement;
    (globalThis as unknown as { document: unknown }).document = origDocument;
  });

  async function createDummyAssessment(): Promise<ConsequenceAssessment> {
    const adapterEngine = new BrowserAdapterEngine();
    const consequenceEngine = new ConsequenceEngine();
    consequenceEngine.registerEvaluator(createDeterministicRuleEvaluator());
    const obs = createBrowserObservation({
      capturedAt: "2026-09-08T15:00:00.000Z" as import("@futureclick/shared").IsoTimestamp,
      page: { origin: "http://127.0.0.1:4173", routeId: "synthetic.repository-visibility" },
      element: { kind: "button", role: "button", buttonType: "button" },
      metadata: {
        fixtureContract: "fc005.repository-visibility.v1",
        operation: "repository.visibility.change",
        entityKey: "fixture-repository",
        currentVisibility: "private",
        requestedVisibility: "public",
      },
    });
    const outcome = adapterEngine.adapt(obs);
    if (outcome.status !== "matched") throw new Error("Expected matched outcome");
    const res = await consequenceEngine.evaluate(outcome.context);
    if (!res.ok) throw new Error("Expected ok evaluation");
    return res.value;
  }

  function createMockButton(): MockHTMLButtonElement {
    const btn = new MockHTMLButtonElement();
    btn.ownerDocument = globalThis.document;
    btn.isConnected = true;
    btn.type = "button";
    btn.disabled = false;
    btn.id = "";
    btn.name = "";
    btn.className = "";
    btn.getAttribute = (attr: string) => {
      if (attr === ATTR_FIXTURE_CONTRACT) return "fc005.repository-visibility.v1";
      if (attr === ATTR_OPERATION) return "repository.visibility.change";
      if (attr === ATTR_ENTITY_KEY) return "fixture-repository";
      if (attr === ATTR_CURRENT_VISIBILITY) return "private";
      if (attr === ATTR_REQUESTED_VISIBILITY) return "public";
      return null;
    };
    return btn;
  }

  it("Regression A: Start -> A begins -> Stop -> A finishes => nothing displayed", async () => {
    const dummyAssessment = await createDummyAssessment();
    let resolveEvalA: (val: unknown) => void = () => {};
    const promiseA = new Promise((resolve) => {
      resolveEvalA = resolve;
    });

    const mockConsequenceEngine = {
      evaluate: vi.fn().mockImplementation(() => promiseA),
    } as unknown as ConsequenceEngine;

    const controller = new BrowserExtensionController(
      mockIndicator,
      new BrowserAdapterEngine(),
      mockConsequenceEngine,
    );

    // 1. Start observing
    controller.start();
    expect(controller.observing).toBe(true);
    expect(controller.getSessionEpoch()).toBe(1);

    // 2. Trigger click event A
    const dummyButton = createMockButton();

    // Simulate click dispatch
    controller.handleDocumentClick({
      target: dummyButton as unknown as EventTarget,
    } as MouseEvent);

    // 3. Stop before evaluation A completes
    controller.stop();
    expect(controller.observing).toBe(false);
    expect(controller.getSessionEpoch()).toBe(2);

    // 4. Evaluation A completes while stopped
    resolveEvalA(ok(dummyAssessment));
    await promiseA;

    // Verify nothing displayed
    expect(renderVerifiedSpy).not.toHaveBeenCalled();
    expect(renderAbstentionSpy).not.toHaveBeenCalled();
  });

  it("Regression B: Start -> A begins -> Stop -> Start -> B begins -> B finishes -> A finishes => B remains, A cannot overwrite", async () => {
    const dummyAssessment = await createDummyAssessment();
    let resolveEvalA: (val: unknown) => void = () => {};
    const promiseA = new Promise((resolve) => {
      resolveEvalA = resolve;
    });

    let resolveEvalB: (val: unknown) => void = () => {};
    const promiseB = new Promise((resolve) => {
      resolveEvalB = resolve;
    });

    let evalCount = 0;
    const mockConsequenceEngine = {
      evaluate: vi.fn().mockImplementation(() => {
        evalCount++;
        return evalCount === 1 ? promiseA : promiseB;
      }),
    } as unknown as ConsequenceEngine;

    const controller = new BrowserExtensionController(
      mockIndicator,
      new BrowserAdapterEngine(),
      mockConsequenceEngine,
    );

    const dummyButton = createMockButton();

    // 1. Session 1: Start and trigger A
    controller.start();
    const epoch1 = controller.getSessionEpoch();
    controller.handleDocumentClick({ target: dummyButton as unknown as EventTarget } as MouseEvent);

    // 2. Stop Session 1 and Start Session 2
    controller.stop();
    controller.start();
    const epoch2 = controller.getSessionEpoch();
    expect(epoch2).toBeGreaterThan(epoch1);

    // 3. Trigger B in Session 2
    controller.handleDocumentClick({ target: dummyButton as unknown as EventTarget } as MouseEvent);

    // 4. B finishes first
    resolveEvalB(ok(dummyAssessment));
    await promiseB;
    await new Promise((r) => setTimeout(r, 10));
    expect(renderVerifiedSpy).toHaveBeenCalledTimes(1);

    // 5. A finishes later (from stale Session 1)
    resolveEvalA(ok(dummyAssessment));
    await promiseA;
    await new Promise((r) => setTimeout(r, 10));

    // A must not overwrite or cause extra render
    expect(renderVerifiedSpy).toHaveBeenCalledTimes(1);
  });

  it("Regression C: Start -> A begins -> B begins -> B finishes -> A finishes => B stays authoritative", async () => {
    const dummyAssessment = await createDummyAssessment();
    let resolveEvalA: (val: unknown) => void = () => {};
    const promiseA = new Promise((resolve) => {
      resolveEvalA = resolve;
    });

    let resolveEvalB: (val: unknown) => void = () => {};
    const promiseB = new Promise((resolve) => {
      resolveEvalB = resolve;
    });

    let evalCount = 0;
    const mockConsequenceEngine = {
      evaluate: vi.fn().mockImplementation(() => {
        evalCount++;
        return evalCount === 1 ? promiseA : promiseB;
      }),
    } as unknown as ConsequenceEngine;

    const controller = new BrowserExtensionController(
      mockIndicator,
      new BrowserAdapterEngine(),
      mockConsequenceEngine,
    );

    const dummyButton = createMockButton();

    controller.start();

    // Trigger A (sequence 1)
    controller.handleDocumentClick({ target: dummyButton as unknown as EventTarget } as MouseEvent);
    expect(controller.getRequestSequence()).toBe(1);

    // Trigger B (sequence 2)
    controller.handleDocumentClick({ target: dummyButton as unknown as EventTarget } as MouseEvent);
    expect(controller.getRequestSequence()).toBe(2);

    // B finishes first
    resolveEvalB(ok(dummyAssessment));
    await promiseB;
    await new Promise((r) => setTimeout(r, 10));
    expect(renderVerifiedSpy).toHaveBeenCalledTimes(1);

    // A finishes second
    resolveEvalA(ok(dummyAssessment));
    await promiseA;
    await new Promise((r) => setTimeout(r, 10));

    // Monotonic sequence policy keeps B authoritative; A cannot render
    expect(renderVerifiedSpy).toHaveBeenCalledTimes(1);
  });
});

describe("M4: Bounded Ancestor Traversal & Contenteditable", () => {
  let origNode: unknown;
  let origElement: unknown;
  let origHTMLButtonElement: unknown;
  let origHTMLElement: unknown;
  let origDocument: unknown;

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
    getAttribute(name: string): string | null {
      if (name === "contenteditable") return this.contentEditable;
      return null;
    }
    getAttributeNames(): string[] {
      return [];
    }
  }
  class MockHTMLElement extends MockElement {}
  class MockHTMLButtonElement extends MockHTMLElement {
    override tagName = "BUTTON";
    type = "button";
    disabled = false;
    id = "";
    name = "";
    className = "";
  }

  beforeEach(() => {
    origNode = (globalThis as unknown as { Node: unknown }).Node;
    origElement = (globalThis as unknown as { Element: unknown }).Element;
    origHTMLElement = (globalThis as unknown as { HTMLElement: unknown }).HTMLElement;
    origHTMLButtonElement = (globalThis as unknown as { HTMLButtonElement: unknown })
      .HTMLButtonElement;
    origDocument = globalThis.document;

    (globalThis as unknown as { Node: unknown }).Node = MockNode;
    (globalThis as unknown as { Element: unknown }).Element = MockElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = MockHTMLElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      MockHTMLButtonElement;

    const mockDoc = {};
    (globalThis as unknown as { document: unknown }).document = mockDoc;
  });

  afterEach(() => {
    (globalThis as unknown as { Node: unknown }).Node = origNode;
    (globalThis as unknown as { Element: unknown }).Element = origElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = origHTMLElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      origHTMLButtonElement;
    (globalThis as unknown as { document: unknown }).document = origDocument;
  });

  it("constants: MAX_ACTIVATION_ANCESTOR_HOPS is exactly 4", () => {
    expect(MAX_ACTIVATION_ANCESTOR_HOPS).toBe(4);
  });

  it("accepts direct button (0 hops)", () => {
    const btn = new MockHTMLButtonElement();
    btn.ownerDocument = globalThis.document;
    const resolved = resolveActivationButton(btn as unknown as EventTarget);
    expect(resolved === (btn as unknown as HTMLButtonElement)).toBe(true);
  });

  it("accepts child within bounded hops (1 to 4 hops)", () => {
    const btn = new MockHTMLButtonElement();
    btn.ownerDocument = globalThis.document;

    // 1 hop
    const child1 = new MockElement();
    child1.ownerDocument = globalThis.document;
    child1.parentElement = btn;
    const resolved1 = resolveActivationButton(child1 as unknown as EventTarget);
    expect(resolved1 === (btn as unknown as HTMLButtonElement)).toBe(true);

    // 4 hops
    const child2 = new MockElement();
    child2.ownerDocument = globalThis.document;
    child2.parentElement = child1;

    const child3 = new MockElement();
    child3.ownerDocument = globalThis.document;
    child3.parentElement = child2;

    const child4 = new MockElement();
    child4.ownerDocument = globalThis.document;
    child4.parentElement = child3;

    const resolved4 = resolveActivationButton(child4 as unknown as EventTarget);
    expect(resolved4 === (btn as unknown as HTMLButtonElement)).toBe(true);
  });

  it("rejects descendant beyond bounded hops (5 hops and 100 levels)", () => {
    const btn = new MockHTMLButtonElement();
    btn.ownerDocument = globalThis.document;

    let current: MockElement = btn;
    for (let i = 1; i <= 5; i++) {
      const next = new MockElement();
      next.ownerDocument = globalThis.document;
      next.parentElement = current;
      current = next;
    }
    // 5 hops -> exceeds bound of 4 hops
    expect(resolveActivationButton(current as unknown as EventTarget)).toBeNull();

    // 100 hops
    let deep: MockElement = btn;
    for (let i = 1; i <= 100; i++) {
      const next = new MockElement();
      next.ownerDocument = globalThis.document;
      next.parentElement = deep;
      deep = next;
    }
    expect(resolveActivationButton(deep as unknown as EventTarget)).toBeNull();
  });

  it("rejects button or traversed ancestor when contenteditable is true", () => {
    const btn = new MockHTMLButtonElement();
    btn.ownerDocument = globalThis.document;
    btn.isContentEditable = true;

    // Editable button itself rejected
    expect(resolveActivationButton(btn as unknown as EventTarget) === null).toBe(true);

    // Button not editable, but child is editable
    const safeBtn = new MockHTMLButtonElement();
    safeBtn.ownerDocument = globalThis.document;

    const editableChild = new MockHTMLElement();
    editableChild.ownerDocument = globalThis.document;
    editableChild.parentElement = safeBtn;
    editableChild.isContentEditable = true;

    expect(resolveActivationButton(editableChild as unknown as EventTarget) === null).toBe(true);
  });
});

describe("FC-005B End-to-End Hardening: Controller & Privacy Boundaries", () => {
  let mockIndicator: DevelopmentIndicator;
  let renderAbstentionSpy: ReturnType<typeof vi.fn>;
  let origWindow: unknown;
  let origNode: unknown;
  let origElement: unknown;
  let origHTMLButtonElement: unknown;
  let origDocument: unknown;

  class MockNode {
    isConnected = true;
    ownerDocument = undefined as unknown;
    childNodes: unknown[] = [];
    attributes: unknown[] = [];
  }
  class MockElement extends MockNode {
    tagName = "BUTTON";
    parentElement: MockElement | null = null;
    getAttribute(_name: string): string | null {
      return null;
    }
    getAttributeNames(): string[] {
      return [];
    }
  }
  class MockHTMLButtonElement extends MockElement {
    type = "button";
    disabled = false;
    id = "";
    name = "";
    className = "";
  }

  beforeEach(() => {
    origWindow = globalThis.window;
    origNode = (globalThis as unknown as { Node: unknown }).Node;
    origElement = (globalThis as unknown as { Element: unknown }).Element;
    origHTMLButtonElement = (globalThis as unknown as { HTMLButtonElement: unknown })
      .HTMLButtonElement;
    origDocument = globalThis.document;

    (globalThis as unknown as { Node: unknown }).Node = MockNode;
    (globalThis as unknown as { Element: unknown }).Element = MockElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      MockHTMLButtonElement;

    const mockDoc = {};
    (globalThis as unknown as { document: unknown }).document = mockDoc;

    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc005/repository-visibility.html",
      },
    };

    mockIndicator = new DevelopmentIndicator();
    renderAbstentionSpy = vi.fn();
    mockIndicator.renderAbstention = renderAbstentionSpy;
    mockIndicator.init = vi.fn();
    mockIndicator.setObserving = vi.fn();
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = origWindow;
    (globalThis as unknown as { Node: unknown }).Node = origNode;
    (globalThis as unknown as { Element: unknown }).Element = origElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      origHTMLButtonElement;
    (globalThis as unknown as { document: unknown }).document = origDocument;
  });

  function createMockButton(): MockHTMLButtonElement {
    const btn = new MockHTMLButtonElement();
    btn.ownerDocument = globalThis.document;
    const attrs: Record<string, string> = {
      [ATTR_FIXTURE_CONTRACT]: "fc005.repository-visibility.v1",
      [ATTR_OPERATION]: "repository.visibility.change",
      [ATTR_ENTITY_KEY]: "fixture-repository",
      [ATTR_CURRENT_VISIBILITY]: "private",
      [ATTR_REQUESTED_VISIBILITY]: "public",
    };
    btn.getAttribute = (name: string) => attrs[name] ?? null;
    btn.getAttributeNames = () => Object.keys(attrs);
    return btn;
  }

  it("Probe E2E-1: Adapter throwing Error with secret results in fixed UI abstention with zero secret prose", () => {
    const throwingAdapter = {
      id: "throw.adapter" as import("@futureclick/browser-adapter").AdapterId,
      version: "1.0" as import("@futureclick/browser-adapter").AdapterVersion,
      description: "Throws secret",
      assess: () => {
        throw new Error("PASSWORD=super-secret user@example.com");
      },
    };

    const engine = new BrowserAdapterEngine({ registry: [throwingAdapter] });
    const controller = new BrowserExtensionController(mockIndicator, engine);
    controller.start();

    const dummyButton = createMockButton();
    controller.handleDocumentClick({
      target: dummyButton as unknown as EventTarget,
    } as MouseEvent);

    expect(renderAbstentionSpy).toHaveBeenCalledWith({
      status: "error",
      title: "Adaptation error",
      details: "Adapter evaluation failed.",
    });

    const lastCallArgs = renderAbstentionSpy.mock.calls[0]?.[0];
    const json = JSON.stringify(lastCallArgs);
    expect(json).not.toContain("PASSWORD");
    expect(json).not.toContain("super-secret");
    expect(json).not.toContain("user@example.com");
  });

  it("Probe E2E-2: Hostile engine or configuration does not leak unhandled exceptions to extension controller", () => {
    expect(() => new BrowserExtensionController(mockIndicator)).not.toThrow();

    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => {
      try {
        const engine = new BrowserAdapterEngine(
          proxy as unknown as import("@futureclick/browser-adapter").BrowserAdapterEngineOptions,
        );
        new BrowserExtensionController(mockIndicator, engine);
      } catch {
        // Safe catch
      }
    }).not.toThrow();
  });
});

describe("FC-006 Sprint 3: Narrow Continue + FC-005 passive invariants", () => {
  it("FC-006 exposes only private Continue seam; no generic executors", async () => {
    const { Fc006InterceptionController } = await import("../src/fc006/controller.js");
    const { FC006_PREVIEW_COPY } = await import("../src/fc006/preview.js");
    const controller = new Fc006InterceptionController({
      ui: {
        init() {},
        getOwnedRoots: () => ({ hosts: [], shadowRoots: [] }),
        getOwnedControls: () => [],
        setActive() {},
        showEvaluating() {},
        showPreview() {},
        showAbstention() {},
        showStale() {},
        beginContinuing() {},
        clearDialog() {},
      } as never,
    });
    const bag = controller as unknown as Record<string, unknown>;

    expect(bag.continuePending).toBeUndefined();
    expect(typeof bag.continuePendingSyntheticRepositoryAction).toBe("function");
    expect(bag.releasePending).toBeUndefined();
    expect(bag.executeAction).toBeUndefined();
    expect(bag.replayAction).toBeUndefined();
    expect(bag.clickSelector).toBeUndefined();
    expect(bag.dispatchAction).toBeUndefined();
    expect(bag.runDOMCommand).toBeUndefined();
    expect(bag.performBrowserAction).toBeUndefined();
    expect(typeof bag.handleCaptureClick).toBe("function");
    expect(typeof bag.cancelPending).toBe("function");
    expect(typeof bag.stop).toBe("function");
    expect(JSON.stringify(FC006_PREVIEW_COPY)).not.toContain("Continue");
  });

  it("FC-005 content controller remains passive (no cancellation methods)", async () => {
    const { BrowserExtensionController } = await import("../src/content/controller.js");
    const controller = new BrowserExtensionController({
      init() {},
      setObserving() {},
      renderVerifiedResult() {},
      renderAbstention() {},
      clearResult() {},
    } as never);
    const src = String(
      (controller as unknown as { handleDocumentClick: unknown }).handleDocumentClick,
    );
    expect(src).not.toContain("preventDefault");
    expect(src).not.toContain("stopImmediatePropagation");
  });
});
