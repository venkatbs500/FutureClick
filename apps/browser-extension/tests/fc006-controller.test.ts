/**
 * FC-006 Sprint 2 controller lifecycle, races, secondary blocking, fail-closed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BrowserObservation,
  createBrowserObservation,
  type BrowserObservationId,
} from "@futureclick/browser-adapter";
import type { IsoTimestamp } from "@futureclick/shared";
import {
  Fc006InterceptionController,
  type Fc006EvaluationOutcome,
  type Fc006PendingEvaluator,
} from "../src/fc006/controller.js";
import type { Fc006Ui } from "../src/fc006/preview.js";
import {
  FC006_FIXTURE_CONTRACT,
  FC006_OPERATION,
  FC006_ORIGIN,
  FC006_ROUTE_ID,
} from "../src/fc006/synthetic-repository-interception-adapter.js";
import { FC006_PREVIEW_COPY } from "../src/fc006/preview.js";

function createObservation(): BrowserObservation {
  return createBrowserObservation({
    id: "obs-fc006-ctrl-01" as BrowserObservationId,
    capturedAt: "2026-09-09T04:00:00.000Z" as IsoTimestamp,
    page: { origin: FC006_ORIGIN, routeId: FC006_ROUTE_ID },
    element: { kind: "button", role: "button", buttonType: "button" },
    metadata: {
      fixtureContract: FC006_FIXTURE_CONTRACT,
      operation: FC006_OPERATION,
      entityKey: "fixture-repository",
      currentVisibility: "private",
      requestedVisibility: "public",
    },
  });
}

function createMockUi() {
  const showEvaluating = vi.fn();
  const showPreview = vi.fn();
  const showAbstention = vi.fn();
  const showStale = vi.fn();
  const beginContinuing = vi.fn();
  const clearDialog = vi.fn();
  const setActive = vi.fn();
  const init = vi.fn();
  const ownedControl = { id: "fc-owned-control" } as unknown as Element;
  const ui = {
    init,
    getOwnedRoots: () => ({ hosts: [] as Element[], shadowRoots: [] as ShadowRoot[] }),
    getOwnedControls: () => [ownedControl],
    setActive,
    showEvaluating,
    showPreview,
    showAbstention,
    showStale,
    beginContinuing,
    clearDialog,
  } as unknown as Fc006Ui;
  return {
    ui,
    showEvaluating,
    showPreview,
    showAbstention,
    showStale,
    beginContinuing,
    clearDialog,
    setActive,
    ownedControl,
  };
}

function createDeferredEvaluator() {
  let resolve!: (value: Fc006EvaluationOutcome) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Fc006EvaluationOutcome>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const evaluator: Fc006PendingEvaluator = async () => promise;
  return { evaluator, resolve, reject };
}

describe("FC-006 Sprint 2: Controller lifecycle", () => {
  let origWindow: unknown;

  beforeEach(() => {
    origWindow = globalThis.window;
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: vi.fn(),
      location: {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc006/repository-visibility-interception.html",
      },
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = origWindow;
  });

  it("starts off; start→observing; stop→off; increments sessionEpoch", () => {
    const { ui, setActive } = createMockUi();
    const controller = new Fc006InterceptionController({ ui });
    expect(controller.getLifecycleKind()).toBe("off");
    controller.start();
    expect(controller.getLifecycleKind()).toBe("observing");
    expect(controller.getSessionEpoch()).toBe(1);
    expect(setActive).toHaveBeenCalledWith(true);
    controller.stop();
    expect(controller.getLifecycleKind()).toBe("off");
    expect(controller.getSessionEpoch()).toBe(2);
    expect(setActive).toHaveBeenCalledWith(false);
  });

  it("Cancel during deferred evaluation ignores late VERIFIED result", async () => {
    const { ui, showEvaluating, showPreview, clearDialog } = createMockUi();
    const deferred = createDeferredEvaluator();
    const controller = new Fc006InterceptionController({
      ui,
      evaluator: deferred.evaluator,
    });
    controller.start();
    const button = { id: "pending-btn" } as unknown as HTMLButtonElement;
    const pendingId = controller.beginPendingFromCandidate(button, createObservation());
    expect(pendingId).not.toBeNull();
    expect(controller.getLifecycleKind()).toBe("evaluating");
    expect(showEvaluating).toHaveBeenCalled();

    controller.cancelPending();
    expect(controller.getLifecycleKind()).toBe("observing");
    expect(controller.getPending()).toBeNull();
    expect(clearDialog).toHaveBeenCalled();

    deferred.resolve({
      kind: "verified",
      context: {} as never,
      assessment: {} as never,
      preview: {
        riskLabel: FC006_PREVIEW_COPY.riskLabel,
        beforeLabel: FC006_PREVIEW_COPY.beforeLabel,
        afterLabel: FC006_PREVIEW_COPY.afterLabel,
        evidenceLabel: FC006_PREVIEW_COPY.evidenceLabel,
        categories: [...FC006_PREVIEW_COPY.categories],
        reversibilityLabel: FC006_PREVIEW_COPY.reversibilityLabel,
        engineSummary: "should not appear",
        fixedExplanation: FC006_PREVIEW_COPY.fixedExplanation,
        syntheticDisclaimer: FC006_PREVIEW_COPY.syntheticDisclaimer,
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getLifecycleKind()).toBe("observing");
    expect(showPreview).not.toHaveBeenCalled();
    expect(controller.getPending()).toBeNull();
  });

  it("Stop during deferred evaluation ignores late result and leaves off", async () => {
    const { ui, showPreview } = createMockUi();
    const deferred = createDeferredEvaluator();
    const controller = new Fc006InterceptionController({
      ui,
      evaluator: deferred.evaluator,
    });
    controller.start();
    const button = { id: "pending-btn" } as unknown as HTMLButtonElement;
    controller.beginPendingFromCandidate(button, createObservation());
    controller.stop();
    expect(controller.getLifecycleKind()).toBe("off");
    deferred.resolve({
      kind: "verified",
      context: {} as never,
      assessment: {} as never,
      preview: {
        riskLabel: "HIGH RISK",
        beforeLabel: "Private",
        afterLabel: "Public",
        evidenceLabel: "VERIFIED",
        categories: ["Security", "Privacy"],
        reversibilityLabel: "Partially reversible",
        engineSummary: "stale",
        fixedExplanation: "x",
        syntheticDisclaimer: "y",
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getLifecycleKind()).toBe("off");
    expect(showPreview).not.toHaveBeenCalled();
  });

  it("old session result cannot affect new session", async () => {
    const { ui, showPreview } = createMockUi();
    const deferred = createDeferredEvaluator();
    const controller = new Fc006InterceptionController({
      ui,
      evaluator: deferred.evaluator,
    });
    controller.start();
    const button = { id: "a" } as unknown as HTMLButtonElement;
    controller.beginPendingFromCandidate(button, createObservation());
    const oldSeq = controller.getRequestSequence();
    const oldEpoch = controller.getSessionEpoch();
    controller.stop();
    controller.start();
    expect(controller.getSessionEpoch()).toBeGreaterThan(oldEpoch);
    deferred.resolve({
      kind: "verified",
      context: {} as never,
      assessment: {} as never,
      preview: {
        riskLabel: "HIGH RISK",
        beforeLabel: "Private",
        afterLabel: "Public",
        evidenceLabel: "VERIFIED",
        categories: ["Security"],
        reversibilityLabel: "Partially reversible",
        engineSummary: `stale-seq-${oldSeq}`,
        fixedExplanation: "x",
        syntheticDisclaimer: "y",
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(showPreview).not.toHaveBeenCalled();
    expect(controller.getLifecycleKind()).toBe("observing");
  });

  it("failure paths and secret throws become abstention without leaking secrets", async () => {
    const secret = "PASSWORD=super-secret user@example.com";
    const cases: Array<() => Promise<Fc006EvaluationOutcome>> = [
      async () => {
        throw new Error(secret);
      },
      async () => {
        throw secret;
      },
      async () => {
        throw null;
      },
      async () => ({ kind: "abstention" }),
    ];

    for (const factory of cases) {
      const { ui, showAbstention, showPreview } = createMockUi();
      const controller = new Fc006InterceptionController({
        ui,
        evaluator: factory,
      });
      controller.start();
      controller.beginPendingFromCandidate(
        { id: "b" } as unknown as HTMLButtonElement,
        createObservation(),
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(controller.getLifecycleKind()).toBe("abstention");
      expect(showAbstention).toHaveBeenCalled();
      expect(showPreview).not.toHaveBeenCalled();
      const serialized = JSON.stringify(showAbstention.mock.calls);
      expect(serialized).not.toContain("PASSWORD");
      expect(serialized).not.toContain("super-secret");
      expect(serialized).not.toContain("user@example.com");
    }
  });

  it("pending same-target activations are cancelled regardless of isTrusted", () => {
    const { ui } = createMockUi();
    const deferred = createDeferredEvaluator();
    const controller = new Fc006InterceptionController({
      ui,
      evaluator: deferred.evaluator,
    });
    controller.installEarlyListener();
    controller.start();
    const pendingBtn = { id: "pending" } as unknown as HTMLButtonElement;
    controller.beginPendingFromCandidate(pendingBtn, createObservation());
    expect(controller.getPending()?.pendingId).toBeTruthy();
    const pendingId = controller.getPending()?.pendingId;

    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    controller.handleCaptureClick({
      type: "click",
      isTrusted: false,
      cancelable: true,
      defaultPrevented: false,
      target: pendingBtn,
      preventDefault,
      stopImmediatePropagation,
      composedPath: () => [pendingBtn],
    } as unknown as MouseEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopImmediatePropagation).toHaveBeenCalled();
    expect(controller.getPending()?.pendingId).toBe(pendingId);
    expect(controller.getLifecycleKind()).toBe("evaluating");
  });

  it("untrusted original click while observing does not begin preview", () => {
    const { ui, showEvaluating } = createMockUi();
    const controller = new Fc006InterceptionController({ ui });
    controller.start();
    const preventDefault = vi.fn();
    controller.handleCaptureClick({
      type: "click",
      isTrusted: false,
      cancelable: true,
      defaultPrevented: false,
      target: { id: "page-btn" },
      preventDefault,
      stopImmediatePropagation: vi.fn(),
      composedPath: () => [],
    } as unknown as MouseEvent);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(showEvaluating).not.toHaveBeenCalled();
    expect(controller.getLifecycleKind()).toBe("observing");
  });

  it("production default evaluator yields verified preview model from engines", async () => {
    const { ui, showPreview } = createMockUi();
    const controller = new Fc006InterceptionController({ ui });
    controller.start();
    controller.beginPendingFromCandidate(
      { id: "btn" } as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getLifecycleKind()).toBe("preview-ready");
    expect(showPreview).toHaveBeenCalled();
    const model = showPreview.mock.calls[0]?.[0];
    expect(model.riskLabel).toBe("HIGH RISK");
    expect(model.beforeLabel).toBe("Private");
    expect(model.afterLabel).toBe("Public");
    expect(model.evidenceLabel).toBe("VERIFIED");
    expect(model.categories).toEqual(["Security", "Privacy"]);
    expect(model.reversibilityLabel).toBe("Partially reversible");
    expect(model.engineSummary).toContain("Synthetic Repository");
    expect(model.engineSummary.toLowerCase()).toContain("private");
    expect(model.engineSummary.toLowerCase()).toContain("public");
    expect(model.fixedExplanation).toBe(FC006_PREVIEW_COPY.fixedExplanation);
    expect(model.syntheticDisclaimer).toContain("Synthetic FutureClick demonstration");
  });

  it("pending secondary exact target is blocked without replacing pending", () => {
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
    }
    class MockHTMLElement extends MockElement {
      isContentEditable = false;
    }
    class MockHTMLButtonElement extends MockHTMLElement {
      override tagName = "BUTTON";
      type = "button";
      disabled = false;
    }

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

    try {
      const { ui } = createMockUi();
      const deferred = createDeferredEvaluator();
      const controller = new Fc006InterceptionController({
        ui,
        evaluator: deferred.evaluator,
      });
      controller.start();

      const pending = new MockHTMLButtonElement();
      pending.ownerDocument = globalThis.document;
      pending.id = "pending";
      const pendingId = controller.beginPendingFromCandidate(
        pending as unknown as HTMLButtonElement,
        createObservation(),
      );

      const secondary = new MockHTMLButtonElement();
      secondary.ownerDocument = globalThis.document;
      secondary.id = "secondary";
      secondary.setAttribute("data-futureclick-fixture-contract", FC006_FIXTURE_CONTRACT);
      secondary.setAttribute("data-futureclick-operation", FC006_OPERATION);
      secondary.setAttribute("data-futureclick-entity-key", "fixture-repository");
      secondary.setAttribute("data-futureclick-current-visibility", "private");
      secondary.setAttribute("data-futureclick-requested-visibility", "public");

      const preventDefault = vi.fn();
      const stopImmediatePropagation = vi.fn();
      controller.handleCaptureClick({
        type: "click",
        isTrusted: true,
        cancelable: true,
        defaultPrevented: false,
        target: secondary,
        preventDefault,
        stopImmediatePropagation,
        composedPath: () => [secondary],
      } as unknown as MouseEvent);

      expect(preventDefault).toHaveBeenCalled();
      expect(stopImmediatePropagation).toHaveBeenCalled();
      expect(controller.getPending()?.pendingId).toBe(pendingId);
      expect(controller.getLifecycleKind()).toBe("evaluating");
    } finally {
      (globalThis as unknown as { Node: unknown }).Node = orig.Node;
      (globalThis as unknown as { Element: unknown }).Element = orig.Element;
      (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = orig.HTMLElement;
      (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
        orig.HTMLButtonElement;
      (globalThis as unknown as { document: unknown }).document = orig.document;
    }
  });
});

describe("FC-006 Sprint 2A: Pending identity guard", () => {
  let origWindow: unknown;

  beforeEach(() => {
    origWindow = globalThis.window;
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: vi.fn(),
      location: {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc006/repository-visibility-interception.html",
      },
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = origWindow;
  });

  function beginPending(controller: Fc006InterceptionController) {
    const pendingBtn = { id: "pending-exact" } as unknown as HTMLButtonElement;
    const pendingId = controller.beginPendingFromCandidate(pendingBtn, createObservation());
    expect(pendingId).not.toBeNull();
    return { pendingBtn, pendingId: pendingId as string };
  }

  it("non-cancelable pending click still stopImmediatePropagation; no preventDefault", () => {
    const { ui, showEvaluating } = createMockUi();
    const deferred = createDeferredEvaluator();
    const controller = new Fc006InterceptionController({ ui, evaluator: deferred.evaluator });
    controller.start();
    const { pendingBtn, pendingId } = beginPending(controller);
    const evalCalls = showEvaluating.mock.calls.length;

    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    controller.handleCaptureClick({
      type: "click",
      isTrusted: true,
      cancelable: false,
      defaultPrevented: false,
      target: pendingBtn,
      preventDefault,
      stopImmediatePropagation,
      composedPath: () => [pendingBtn],
    } as unknown as MouseEvent);

    expect(stopImmediatePropagation).toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(controller.getPending()?.pendingId).toBe(pendingId);
    expect(showEvaluating.mock.calls.length).toBe(evalCalls);
  });

  it("already-defaultPrevented pending click still stopImmediatePropagation", () => {
    const { ui, showEvaluating } = createMockUi();
    const deferred = createDeferredEvaluator();
    const controller = new Fc006InterceptionController({ ui, evaluator: deferred.evaluator });
    controller.start();
    const { pendingBtn, pendingId } = beginPending(controller);
    const evalCalls = showEvaluating.mock.calls.length;

    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    controller.handleCaptureClick({
      type: "click",
      isTrusted: false,
      cancelable: true,
      defaultPrevented: true,
      target: pendingBtn,
      preventDefault,
      stopImmediatePropagation,
      composedPath: () => [pendingBtn],
    } as unknown as MouseEvent);

    expect(stopImmediatePropagation).toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(controller.getPending()?.pendingId).toBe(pendingId);
    expect(showEvaluating.mock.calls.length).toBe(evalCalls);
  });

  it("pending guard runs before ownership; reparented under owned host still blocked", () => {
    const { ui, ownedControl, showEvaluating } = createMockUi();
    const deferred = createDeferredEvaluator();
    const controller = new Fc006InterceptionController({ ui, evaluator: deferred.evaluator });
    controller.start();
    const { pendingBtn, pendingId } = beginPending(controller);
    const evalCalls = showEvaluating.mock.calls.length;

    // Simulate page reparenting pending beneath an owned host/control path.
    const ownedHost = { id: "fc-host" };
    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    controller.handleCaptureClick({
      type: "click",
      isTrusted: true,
      cancelable: false,
      defaultPrevented: true,
      target: pendingBtn,
      preventDefault,
      stopImmediatePropagation,
      composedPath: () => [pendingBtn, ownedHost, ownedControl],
    } as unknown as MouseEvent);

    expect(stopImmediatePropagation).toHaveBeenCalled();
    expect(controller.getPending()?.pendingId).toBe(pendingId);
    expect(showEvaluating.mock.calls.length).toBe(evalCalls);
  });

  it("pending child target within hop bound is blocked by identity", () => {
    class MockElement {
      parentElement: MockElement | null = null;
    }
    class MockButton extends MockElement {}
    const origElement = (globalThis as unknown as { Element: unknown }).Element;
    (globalThis as unknown as { Element: unknown }).Element = MockElement;

    try {
      const { ui, showEvaluating } = createMockUi();
      const deferred = createDeferredEvaluator();
      const controller = new Fc006InterceptionController({ ui, evaluator: deferred.evaluator });
      controller.start();
      const pendingBtn = new MockButton() as unknown as HTMLButtonElement;
      const child = new MockElement();
      child.parentElement = pendingBtn as unknown as MockElement;
      const pendingId = controller.beginPendingFromCandidate(pendingBtn, createObservation());
      const evalCalls = showEvaluating.mock.calls.length;

      const stopImmediatePropagation = vi.fn();
      controller.handleCaptureClick({
        type: "click",
        isTrusted: true,
        cancelable: false,
        defaultPrevented: false,
        target: child,
        preventDefault: vi.fn(),
        stopImmediatePropagation,
        composedPath: () => [child, pendingBtn],
      } as unknown as MouseEvent);

      expect(stopImmediatePropagation).toHaveBeenCalled();
      expect(controller.getPending()?.pendingId).toBe(pendingId);
      expect(showEvaluating.mock.calls.length).toBe(evalCalls);
    } finally {
      (globalThis as unknown as { Element: unknown }).Element = origElement;
    }
  });

  it("metadata mutation does not remove pending identity protection", () => {
    const { ui, showEvaluating } = createMockUi();
    const deferred = createDeferredEvaluator();
    const controller = new Fc006InterceptionController({ ui, evaluator: deferred.evaluator });
    controller.start();
    const { pendingBtn, pendingId } = beginPending(controller);
    const mutated = pendingBtn as unknown as { attrs?: Record<string, string> };
    mutated.attrs = {
      "data-futureclick-fixture-contract": "mutated",
      "data-futureclick-operation": "mutated",
      "data-futureclick-entity-key": "mutated",
      "data-futureclick-current-visibility": "public",
      "data-futureclick-requested-visibility": "private",
    };
    const evalCalls = showEvaluating.mock.calls.length;

    const stopImmediatePropagation = vi.fn();
    controller.handleCaptureClick({
      type: "click",
      isTrusted: true,
      cancelable: true,
      defaultPrevented: false,
      target: pendingBtn,
      preventDefault: vi.fn(),
      stopImmediatePropagation,
      composedPath: () => [pendingBtn],
    } as unknown as MouseEvent);

    expect(stopImmediatePropagation).toHaveBeenCalled();
    expect(controller.getPending()?.pendingId).toBe(pendingId);
    expect(showEvaluating.mock.calls.length).toBe(evalCalls);
  });

  it("page element under owned host is not treated as owned control", () => {
    const { ui, showEvaluating } = createMockUi();
    const controller = new Fc006InterceptionController({ ui });
    controller.start();
    const pageBtn = { id: "page-under-host" };
    const preventDefault = vi.fn();
    controller.handleCaptureClick({
      type: "click",
      isTrusted: true,
      cancelable: true,
      defaultPrevented: false,
      target: pageBtn,
      preventDefault,
      stopImmediatePropagation: vi.fn(),
      // Host containment only — exact Start/Stop/Cancel controls are absent from the path.
      composedPath: () => [pageBtn, { id: "fc-host" }],
    } as unknown as MouseEvent);
    expect(showEvaluating).not.toHaveBeenCalled();
  });
});

describe("FC-006 Sprint 2B: Bounded pending path + direct guard lifecycle", () => {
  let origWindow: unknown;
  let origElement: unknown;

  beforeEach(() => {
    origWindow = globalThis.window;
    origElement = (globalThis as unknown as { Element: unknown }).Element;
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: vi.fn(),
      location: {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
        pathname: "/fc006/repository-visibility-interception.html",
      },
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = origWindow;
    (globalThis as unknown as { Element: unknown }).Element = origElement;
  });

  class MockElement {
    parentElement: MockElement | null = null;
    listeners = new Map<string, Set<EventListener>>();
    addEventListener(type: string, fn: EventListener, _opts?: unknown): void {
      const set = this.listeners.get(type) ?? new Set();
      set.add(fn);
      this.listeners.set(type, set);
    }
    removeEventListener(type: string, fn: EventListener, _opts?: unknown): void {
      this.listeners.get(type)?.delete(fn);
    }
    dispatchCaptureClick(event: Event): void {
      for (const fn of this.listeners.get("click") ?? []) {
        fn(event);
      }
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

  it("window fast path parent reads are hard-bounded for deep descendants", () => {
    (globalThis as unknown as { Element: unknown }).Element = MockElement;
    const cases: Array<{ depth: number; windowHit: boolean; maxReads: number }> = [
      { depth: 0, windowHit: true, maxReads: 0 },
      { depth: 1, windowHit: true, maxReads: 1 },
      { depth: 4, windowHit: true, maxReads: 4 },
      { depth: 5, windowHit: false, maxReads: 4 },
      { depth: 100, windowHit: false, maxReads: 4 },
      { depth: 1000, windowHit: false, maxReads: 4 },
    ];

    for (const { depth, windowHit, maxReads } of cases) {
      let parentReads = 0;
      const { ui, showEvaluating } = createMockUi();
      const deferred = createDeferredEvaluator();
      const controller = new Fc006InterceptionController({
        ui,
        evaluator: deferred.evaluator,
        pendingMatchOptions: {
          onParentRead: () => {
            parentReads += 1;
          },
        },
      });
      controller.start();
      const { pending, leaf } = chain(depth);
      const pendingId = controller.beginPendingFromCandidate(
        pending as unknown as HTMLButtonElement,
        createObservation(),
      );
      expect(controller.hasPendingElementGuard()).toBe(true);
      const evalCalls = showEvaluating.mock.calls.length;
      const stopImmediatePropagation = vi.fn();
      const preventDefault = vi.fn();

      controller.handleCaptureClick({
        type: "click",
        isTrusted: true,
        cancelable: false,
        defaultPrevented: false,
        target: leaf,
        preventDefault,
        stopImmediatePropagation,
        composedPath: () => {
          throw new Error("COMPOSED_PATH_MUST_NOT_BE_USED");
        },
      } as unknown as MouseEvent);

      expect(parentReads).toBe(maxReads);
      expect(parentReads).toBeLessThanOrEqual(4);

      if (windowHit) {
        expect(stopImmediatePropagation).toHaveBeenCalled();
        expect(controller.getPending()?.pendingId).toBe(pendingId);
        expect(showEvaluating.mock.calls.length).toBe(evalCalls);
      } else {
        // Window path misses deep targets; direct pending-element guard blocks with 0 ancestry reads.
        expect(stopImmediatePropagation).not.toHaveBeenCalled();
        const guardBefore = controller.getPendingGuardInvocations();
        pending.dispatchCaptureClick({
          type: "click",
          isTrusted: true,
          cancelable: false,
          defaultPrevented: false,
          target: leaf,
          preventDefault: vi.fn(),
          stopImmediatePropagation,
          composedPath: () => {
            throw new Error("COMPOSED_PATH_MUST_NOT_BE_USED");
          },
        } as unknown as Event);
        expect(controller.getPendingGuardInvocations()).toBe(guardBefore + 1);
        expect(stopImmediatePropagation).toHaveBeenCalled();
        expect(controller.getPending()?.pendingId).toBe(pendingId);
        expect(showEvaluating.mock.calls.length).toBe(evalCalls);
      }
    }
  });

  it("pending protection works when composedPath throws", () => {
    const { ui } = createMockUi();
    const deferred = createDeferredEvaluator();
    const controller = new Fc006InterceptionController({ ui, evaluator: deferred.evaluator });
    controller.start();
    const pending = new MockElement();
    const pendingId = controller.beginPendingFromCandidate(
      pending as unknown as HTMLButtonElement,
      createObservation(),
    );
    const stopImmediatePropagation = vi.fn();
    controller.handleCaptureClick({
      type: "click",
      isTrusted: false,
      cancelable: true,
      defaultPrevented: true,
      target: pending,
      preventDefault: vi.fn(),
      stopImmediatePropagation,
      composedPath: () => {
        throw new Error("COMPOSED_PATH_MUST_NOT_BE_USED");
      },
    } as unknown as MouseEvent);
    expect(stopImmediatePropagation).toHaveBeenCalled();
    expect(controller.getPending()?.pendingId).toBe(pendingId);
  });

  it("installs pending guard once and removes it on Cancel / Stop / Dismiss", async () => {
    const { ui, showAbstention } = createMockUi();
    const pending = new MockElement();
    const deferred = createDeferredEvaluator();
    const controller = new Fc006InterceptionController({ ui, evaluator: deferred.evaluator });
    controller.start();
    controller.beginPendingFromCandidate(
      pending as unknown as HTMLButtonElement,
      createObservation(),
    );
    expect(controller.hasPendingElementGuard()).toBe(true);
    expect(pending.listeners.get("click")?.size).toBe(1);

    controller.cancelPending();
    expect(controller.hasPendingElementGuard()).toBe(false);
    expect(pending.listeners.get("click")?.size ?? 0).toBe(0);

    // Fresh pending after Cancel
    controller.beginPendingFromCandidate(
      pending as unknown as HTMLButtonElement,
      createObservation(),
    );
    expect(controller.hasPendingElementGuard()).toBe(true);
    expect(pending.listeners.get("click")?.size).toBe(1);
    controller.stop();
    expect(controller.hasPendingElementGuard()).toBe(false);
    expect(pending.listeners.get("click")?.size ?? 0).toBe(0);

    // Dismiss path
    controller.start();
    const controller2 = new Fc006InterceptionController({
      ui,
      evaluator: async () => ({ kind: "abstention" }),
    });
    controller2.start();
    const pending2 = new MockElement();
    controller2.beginPendingFromCandidate(
      pending2 as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(showAbstention).toHaveBeenCalled();
    expect(controller2.hasPendingElementGuard()).toBe(true);
    controller2.dismissAbstention();
    expect(controller2.hasPendingElementGuard()).toBe(false);
    expect(pending2.listeners.get("click")?.size ?? 0).toBe(0);
  });

  it("after Cancel, same element is not blocked by a stale pending guard", () => {
    const { ui } = createMockUi();
    const deferred = createDeferredEvaluator();
    const controller = new Fc006InterceptionController({ ui, evaluator: deferred.evaluator });
    controller.start();
    const pending = new MockElement();
    controller.beginPendingFromCandidate(
      pending as unknown as HTMLButtonElement,
      createObservation(),
    );
    controller.cancelPending();
    expect(controller.hasPendingElementGuard()).toBe(false);

    const stopImmediatePropagation = vi.fn();
    pending.dispatchCaptureClick({
      type: "click",
      isTrusted: true,
      cancelable: true,
      defaultPrevented: false,
      target: pending,
      preventDefault: vi.fn(),
      stopImmediatePropagation,
    } as unknown as Event);
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(controller.getPendingGuardInvocations()).toBe(0);
  });

  it("secondary supported action still blocked without composedPath", () => {
    class MockNode {
      isConnected = true;
      ownerDocument: unknown = null;
      parentElement: MockElement | null = null;
    }
    class AttrMockElement extends MockNode {
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
    }
    class MockHTMLElement extends AttrMockElement {
      isContentEditable = false;
    }
    class MockHTMLButtonElement extends MockHTMLElement {
      override tagName = "BUTTON";
      type = "button";
      disabled = false;
      listeners = new Map<string, Set<EventListener>>();
      addEventListener(type: string, fn: EventListener): void {
        const set = this.listeners.get(type) ?? new Set();
        set.add(fn);
        this.listeners.set(type, set);
      }
      removeEventListener(type: string, fn: EventListener): void {
        this.listeners.get(type)?.delete(fn);
      }
    }

    const orig = {
      Node: (globalThis as unknown as { Node: unknown }).Node,
      Element: (globalThis as unknown as { Element: unknown }).Element,
      HTMLElement: (globalThis as unknown as { HTMLElement: unknown }).HTMLElement,
      HTMLButtonElement: (globalThis as unknown as { HTMLButtonElement: unknown })
        .HTMLButtonElement,
      document: globalThis.document,
    };
    (globalThis as unknown as { Node: unknown }).Node = MockNode;
    (globalThis as unknown as { Element: unknown }).Element = AttrMockElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = MockHTMLElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      MockHTMLButtonElement;
    (globalThis as unknown as { document: unknown }).document = {};

    try {
      const { ui } = createMockUi();
      const deferred = createDeferredEvaluator();
      const controller = new Fc006InterceptionController({ ui, evaluator: deferred.evaluator });
      controller.start();
      const pending = new MockHTMLButtonElement();
      pending.ownerDocument = globalThis.document;
      const pendingId = controller.beginPendingFromCandidate(
        pending as unknown as HTMLButtonElement,
        createObservation(),
      );

      const secondary = new MockHTMLButtonElement();
      secondary.ownerDocument = globalThis.document;
      secondary.setAttribute("data-futureclick-fixture-contract", FC006_FIXTURE_CONTRACT);
      secondary.setAttribute("data-futureclick-operation", FC006_OPERATION);
      secondary.setAttribute("data-futureclick-entity-key", "fixture-repository");
      secondary.setAttribute("data-futureclick-current-visibility", "private");
      secondary.setAttribute("data-futureclick-requested-visibility", "public");

      const stopImmediatePropagation = vi.fn();
      controller.handleCaptureClick({
        type: "click",
        isTrusted: false,
        cancelable: false,
        defaultPrevented: true,
        target: secondary,
        preventDefault: vi.fn(),
        stopImmediatePropagation,
        composedPath: () => {
          throw new Error("COMPOSED_PATH_MUST_NOT_BE_USED");
        },
      } as unknown as MouseEvent);

      expect(stopImmediatePropagation).toHaveBeenCalled();
      expect(controller.getPending()?.pendingId).toBe(pendingId);
    } finally {
      (globalThis as unknown as { Node: unknown }).Node = orig.Node;
      (globalThis as unknown as { Element: unknown }).Element = orig.Element;
      (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = orig.HTMLElement;
      (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
        orig.HTMLButtonElement;
      (globalThis as unknown as { document: unknown }).document = orig.document;
    }
  });
});
