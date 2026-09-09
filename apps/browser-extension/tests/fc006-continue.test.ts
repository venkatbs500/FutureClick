/**
 * FC-006 Sprint 3 Trusted Continue — release, revalidation, one-shot arming.
 *
 * Programmatic UI Continue is not exercised via DOM here. Trusted Continue is
 * the private controller seam `continuePendingSyntheticRepositoryAction`
 * (wired from owned UI `onContinue` in production). Tests call that seam
 * directly after reaching `preview-ready`.
 */

import {
  type BrowserObservation,
  type BrowserObservationId,
  createBrowserObservation,
} from "@futureclick/browser-adapter";
import type { IsoTimestamp } from "@futureclick/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTR_CURRENT_VISIBILITY,
  ATTR_ENTITY_KEY,
  ATTR_FIXTURE_CONTRACT,
  ATTR_OPERATION,
  ATTR_REQUESTED_VISIBILITY,
} from "../src/fc006/capture.js";
import {
  Fc006InterceptionController,
  type Fc006NativeButtonClickInvoker,
} from "../src/fc006/controller.js";
import { eventTargetsPendingElement } from "../src/fc006/interception.js";
import type { Fc006Ui } from "../src/fc006/preview.js";
import {
  FC006_FIXTURE_CONTRACT,
  FC006_OPERATION,
  FC006_ORIGIN,
  FC006_ROUTE_ID,
} from "../src/fc006/synthetic-repository-interception-adapter.js";

function createObservation(
  overrides?: Partial<{
    entityKey: string;
    fixtureContract: string;
    operation: string;
    currentVisibility: string;
    requestedVisibility: string;
  }>,
): BrowserObservation {
  return createBrowserObservation({
    id: "obs-fc006-continue-01" as BrowserObservationId,
    capturedAt: "2026-09-09T12:00:00.000Z" as IsoTimestamp,
    page: { origin: FC006_ORIGIN, routeId: FC006_ROUTE_ID },
    element: { kind: "button", role: "button", buttonType: "button" },
    metadata: {
      fixtureContract: overrides?.fixtureContract ?? FC006_FIXTURE_CONTRACT,
      operation: overrides?.operation ?? FC006_OPERATION,
      entityKey: overrides?.entityKey ?? "fixture-repository",
      currentVisibility: overrides?.currentVisibility ?? "private",
      requestedVisibility: overrides?.requestedVisibility ?? "public",
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
  const ui = {
    init,
    getOwnedRoots: () => ({ hosts: [] as Element[], shadowRoots: [] as ShadowRoot[] }),
    getOwnedControls: () => [] as Element[],
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
  };
}

class MockClickEvent {
  type = "click";
  isTrusted = false;
  cancelable = true;
  defaultPrevented = false;
  immediatePropagationStopped = false;
  target: EventTarget;
  currentTarget: EventTarget | null = null;

  constructor(target: EventTarget) {
    this.target = target;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopImmediatePropagation(): void {
    this.immediatePropagationStopped = true;
  }

  composedPath(): EventTarget[] {
    throw new Error("COMPOSED_PATH_MUST_NOT_BE_USED");
  }
}

type CaptureOpts = boolean | { capture?: boolean } | undefined;

class MockNode {
  isConnected = true;
  ownerDocument: unknown = null;
  parentElement: MockElement | null = null;
  parentNode: MockNode | null = null;
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
  /** Hostile instance override — release must not use this. */
  click = vi.fn();

  private captureListeners = new Set<EventListener>();
  private targetListeners = new Set<EventListener>();

  addEventListener(type: string, fn: EventListener, opts?: CaptureOpts): void {
    if (type !== "click") return;
    const capture = typeof opts === "boolean" ? opts : Boolean(opts?.capture);
    if (capture) this.captureListeners.add(fn);
    else this.targetListeners.add(fn);
  }

  removeEventListener(type: string, fn: EventListener, opts?: CaptureOpts): void {
    if (type !== "click") return;
    const capture = typeof opts === "boolean" ? opts : Boolean(opts?.capture);
    if (capture) this.captureListeners.delete(fn);
    else this.targetListeners.delete(fn);
  }

  dispatchCapture(event: MockClickEvent): void {
    for (const fn of [...this.captureListeners]) {
      if (event.immediatePropagationStopped) break;
      event.currentTarget = this as unknown as EventTarget;
      fn(event as unknown as Event);
    }
  }

  dispatchTarget(event: MockClickEvent): void {
    for (const fn of [...this.targetListeners]) {
      if (event.immediatePropagationStopped) break;
      event.currentTarget = this as unknown as EventTarget;
      fn(event as unknown as Event);
    }
  }

  get captureListenerCount(): number {
    return this.captureListeners.size;
  }
}

const AUTHORIZED_LOCATION = {
  protocol: "http:",
  hostname: "127.0.0.1",
  port: "4173",
  pathname: "/fc006/repository-visibility-interception.html",
};

describe("FC-006 Sprint 3: Trusted Continue", () => {
  let origWindow: unknown;
  let origDocument: unknown;
  let origNode: unknown;
  let origElement: unknown;
  let origHTMLElement: unknown;
  let origHTMLButtonElement: unknown;
  let locationState: typeof AUTHORIZED_LOCATION;

  beforeEach(() => {
    origWindow = globalThis.window;
    origDocument = globalThis.document;
    origNode = (globalThis as unknown as { Node: unknown }).Node;
    origElement = (globalThis as unknown as { Element: unknown }).Element;
    origHTMLElement = (globalThis as unknown as { HTMLElement: unknown }).HTMLElement;
    origHTMLButtonElement = (globalThis as unknown as { HTMLButtonElement: unknown })
      .HTMLButtonElement;

    locationState = { ...AUTHORIZED_LOCATION };
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: vi.fn(),
      location: locationState,
    };
    (globalThis as unknown as { document: unknown }).document = {};
    (globalThis as unknown as { Node: unknown }).Node = MockNode;
    (globalThis as unknown as { Element: unknown }).Element = MockElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = MockHTMLElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      MockHTMLButtonElement;
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = origWindow;
    (globalThis as unknown as { document: unknown }).document = origDocument;
    (globalThis as unknown as { Node: unknown }).Node = origNode;
    (globalThis as unknown as { Element: unknown }).Element = origElement;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = origHTMLElement;
    (globalThis as unknown as { HTMLButtonElement: unknown }).HTMLButtonElement =
      origHTMLButtonElement;
  });

  function createValidButton(): MockHTMLButtonElement {
    const btn = new MockHTMLButtonElement();
    btn.ownerDocument = globalThis.document;
    btn.isConnected = true;
    btn.type = "button";
    btn.disabled = false;
    btn.isContentEditable = false;
    btn.setAttribute(ATTR_FIXTURE_CONTRACT, FC006_FIXTURE_CONTRACT);
    btn.setAttribute(ATTR_OPERATION, FC006_OPERATION);
    btn.setAttribute(ATTR_ENTITY_KEY, "fixture-repository");
    btn.setAttribute(ATTR_CURRENT_VISIBILITY, "private");
    btn.setAttribute(ATTR_REQUESTED_VISIBILITY, "public");
    return btn;
  }

  function createClickEvent(target: EventTarget): MockClickEvent {
    return new MockClickEvent(target);
  }

  async function reachPreviewReady(options?: {
    nativeButtonClick?: Fc006NativeButtonClickInvoker;
  }): Promise<{
    controller: Fc006InterceptionController;
    button: MockHTMLButtonElement;
    ui: ReturnType<typeof createMockUi>;
  }> {
    const ui = createMockUi();
    const controller = new Fc006InterceptionController({
      ui: ui.ui,
      ...(options?.nativeButtonClick ? { nativeButtonClick: options.nativeButtonClick } : {}),
    });
    controller.start();
    const button = createValidButton();
    const pendingId = controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    expect(pendingId).not.toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getLifecycleKind()).toBe("preview-ready");
    expect(controller.getPending()?.context).toBeDefined();
    expect(controller.getPending()?.assessment).toBeDefined();
    return { controller, button, ui };
  }

  async function expectStaleNoNativeRelease(
    mutate: (args: {
      controller: Fc006InterceptionController;
      button: MockHTMLButtonElement;
      ui: ReturnType<typeof createMockUi>;
    }) => void,
  ): Promise<void> {
    let nativeInvocationCount = 0;
    const { controller, button, ui } = await reachPreviewReady({
      nativeButtonClick: () => {
        nativeInvocationCount += 1;
      },
    });
    const beforeGen = controller.getReleaseDebugState().releaseGeneration;
    mutate({ controller, button, ui });
    controller.continuePendingSyntheticRepositoryAction();
    expect(controller.getLifecycleKind()).toBe("stale");
    expect(ui.showStale).toHaveBeenCalled();
    expect(nativeInvocationCount).toBe(0);
    expect(controller.getReleaseDebugState().releaseGeneration).toBe(beforeGen);
    expect(controller.getReleaseDebugState().armed).toBeNull();
    expect(controller.getReleaseDebugState().releaseInProgress).toBe(false);
    expect(controller.getReleaseDebugState().hasAuthorizedReleasedEvent).toBe(false);
  }

  it("composedPath-throws still matches pending via eventTargetsPendingElement", () => {
    const button = createValidButton();
    const event = createClickEvent(button as unknown as EventTarget);
    expect(
      eventTargetsPendingElement(event as unknown as Event, button as unknown as HTMLButtonElement),
    ).toBe(true);
    expect(() => event.composedPath()).toThrow(/COMPOSED_PATH_MUST_NOT_BE_USED/);
  });

  it("trusted-equivalent Continue path succeeds via continuePendingSyntheticRepositoryAction", async () => {
    let releaseCount = 0;
    let handlerCount = 0;
    const mockUi = createMockUi();
    const controller = new Fc006InterceptionController({
      ui: mockUi.ui,
      nativeButtonClick: (el) => {
        releaseCount += 1;
        const event = createClickEvent(el);
        controller.handleCaptureClick(event as unknown as MouseEvent);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
        if (!event.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    button.addEventListener("click", () => {
      handlerCount += 1;
    });
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getLifecycleKind()).toBe("preview-ready");
    expect(mockUi.beginContinuing).not.toHaveBeenCalled();
    // Private Continue seam (not page-exposed DOM Continue).
    controller.continuePendingSyntheticRepositoryAction();

    expect(releaseCount).toBe(1);
    expect(handlerCount).toBe(1);
    expect(controller.getLifecycleKind()).toBe("observing");
    expect(controller.getPending()).toBeNull();
    expect(controller.hasPendingElementGuard()).toBe(false);
    expect(mockUi.beginContinuing).toHaveBeenCalled();
    expect(mockUi.clearDialog).toHaveBeenCalled();
  });

  it("calling continue twice while continuing does not double-release", async () => {
    let releaseCount = 0;
    let handlerCount = 0;
    let nestedContinueDuringRelease = 0;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: (el) => {
        releaseCount += 1;
        // Duplicate Continue while armed / releaseInProgress must no-op.
        controller.continuePendingSyntheticRepositoryAction();
        nestedContinueDuringRelease += 1;
        const event = createClickEvent(el);
        controller.handleCaptureClick(event as unknown as MouseEvent);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
        if (!event.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    button.addEventListener("click", () => {
      handlerCount += 1;
    });
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getLifecycleKind()).toBe("preview-ready");

    controller.continuePendingSyntheticRepositoryAction();
    // After success, state is observing — second Continue is also a no-op.
    controller.continuePendingSyntheticRepositoryAction();

    expect(nestedContinueDuringRelease).toBe(1);
    expect(releaseCount).toBe(1);
    expect(handlerCount).toBe(1);
  });

  it("stale on metadata change before continue", async () => {
    let nativeInvocationCount = 0;
    const { controller, button, ui } = await reachPreviewReady({
      nativeButtonClick: () => {
        nativeInvocationCount += 1;
      },
    });
    const beforeGen = controller.getReleaseDebugState().releaseGeneration;
    button.setAttribute(ATTR_CURRENT_VISIBILITY, "public");
    controller.continuePendingSyntheticRepositoryAction();
    expect(controller.getLifecycleKind()).toBe("stale");
    expect(ui.showStale).toHaveBeenCalled();
    expect(ui.beginContinuing).toHaveBeenCalled();
    expect(controller.getPending()).not.toBeNull();
    expect(nativeInvocationCount).toBe(0);
    expect(controller.getReleaseDebugState().releaseGeneration).toBe(beforeGen);
    expect(controller.getReleaseDebugState().armed).toBeNull();
    expect(controller.getReleaseDebugState().releaseInProgress).toBe(false);
  });

  it("detached element → stale", async () => {
    await expectStaleNoNativeRelease(({ button }) => {
      button.isConnected = false;
    });
  });

  it("clone replacement → stale (pending points to original detached)", async () => {
    let nativeInvocationCount = 0;
    const { controller, button, ui } = await reachPreviewReady({
      nativeButtonClick: () => {
        nativeInvocationCount += 1;
      },
    });
    const beforeGen = controller.getReleaseDebugState().releaseGeneration;
    const clone = createValidButton();
    clone.id = "clone";
    // Pending still references the original; original is detached after swap.
    button.isConnected = false;
    expect(controller.getPending()?.element).toBe(button);
    expect(clone.isConnected).toBe(true);
    controller.continuePendingSyntheticRepositoryAction();
    expect(controller.getLifecycleKind()).toBe("stale");
    expect(ui.showStale).toHaveBeenCalled();
    expect(controller.getPending()?.element).toBe(button);
    expect(nativeInvocationCount).toBe(0);
    expect(controller.getReleaseDebugState().releaseGeneration).toBe(beforeGen);
    expect(controller.getReleaseDebugState().armed).toBeNull();
  });

  it("disabled element → stale", async () => {
    await expectStaleNoNativeRelease(({ button }) => {
      button.disabled = true;
    });
  });

  it("editable/contenteditable → stale", async () => {
    await expectStaleNoNativeRelease(({ button }) => {
      button.isContentEditable = true;
    });
  });

  it("wrong location → stale", async () => {
    await expectStaleNoNativeRelease(() => {
      locationState.pathname = "/other.html";
    });
  });

  it("assessment mismatch / context tamper / lineage tamper → stale", async () => {
    const cases: Array<{
      name: string;
      mutate: (pending: NonNullable<ReturnType<Fc006InterceptionController["getPending"]>>) => void;
    }> = [
      {
        name: "empty consequences",
        mutate: (pending) => {
          const assessment = pending.assessment;
          if (!assessment) throw new Error("missing assessment");
          (pending as { assessment?: unknown }).assessment = {
            ...assessment,
            consequences: [],
          };
        },
      },
      {
        name: "evaluationContextId tamper",
        mutate: (pending) => {
          const assessment = pending.assessment;
          if (!assessment) throw new Error("missing assessment");
          (pending as { assessment?: unknown }).assessment = {
            ...assessment,
            evaluationContextId: "ctx-tampered",
          };
        },
      },
      {
        name: "context id lineage break",
        mutate: (pending) => {
          const context = pending.context;
          if (!context) throw new Error("missing context");
          (pending as { context?: unknown }).context = {
            ...context,
            id: "ctx-lineage-break",
          };
        },
      },
      {
        name: "context parameter tamper",
        mutate: (pending) => {
          const context = pending.context;
          if (!context) throw new Error("missing context");
          (pending as { context?: unknown }).context = {
            ...context,
            action: {
              ...context.action,
              parameters: { ...context.action.parameters, newVisibility: "private" },
            },
          };
        },
      },
    ];

    for (const { mutate } of cases) {
      locationState.pathname = AUTHORIZED_LOCATION.pathname;
      let nativeInvocationCount = 0;
      const { controller, ui } = await reachPreviewReady({
        nativeButtonClick: () => {
          nativeInvocationCount += 1;
        },
      });
      const beforeGen = controller.getReleaseDebugState().releaseGeneration;
      const pending = controller.getPending();
      expect(pending).not.toBeNull();
      if (!pending) throw new Error("missing pending");
      mutate(pending);
      controller.continuePendingSyntheticRepositoryAction();
      expect(controller.getLifecycleKind()).toBe("stale");
      expect(ui.showStale).toHaveBeenCalled();
      expect(nativeInvocationCount).toBe(0);
      expect(controller.getReleaseDebugState().releaseGeneration).toBe(beforeGen);
      expect(controller.getReleaseDebugState().armed).toBeNull();
    }
  });

  it("exact one release (nativeButtonClick seam counts 1)", async () => {
    let releaseCount = 0;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: (el) => {
        releaseCount += 1;
        const event = createClickEvent(el);
        controller.handleCaptureClick(event as unknown as MouseEvent);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
        if (!event.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.continuePendingSyntheticRepositoryAction();
    expect(releaseCount).toBe(1);
  });

  it("authorization consumed before handler (page handler sees armed.consumed)", async () => {
    let sawConsumedBeforeHandlerWork = false;
    let handlerCount = 0;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: (el) => {
        const event = createClickEvent(el);
        // Window capture consumes one-shot auth BEFORE target handlers.
        controller.handleCaptureClick(event as unknown as MouseEvent);
        expect(controller.getReleaseDebugState().armed?.consumed).toBe(true);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
        if (!event.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    button.addEventListener("click", () => {
      const debug = controller.getReleaseDebugState();
      expect(debug.armed?.consumed).toBe(true);
      sawConsumedBeforeHandlerWork = true;
      handlerCount += 1;
    });
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.continuePendingSyntheticRepositoryAction();
    expect(sawConsumedBeforeHandlerWork).toBe(true);
    expect(handlerCount).toBe(1);
  });

  it("nested dispatchEvent blocked during release; execution count stays 1", async () => {
    let handlerCount = 0;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: (el) => {
        const event = createClickEvent(el);
        controller.handleCaptureClick(event as unknown as MouseEvent);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
        if (!event.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    button.addEventListener("click", () => {
      handlerCount += 1;
      const nested = createClickEvent(button as unknown as EventTarget);
      controller.handleCaptureClick(nested as unknown as MouseEvent);
      button.dispatchCapture(nested);
      if (!nested.immediatePropagationStopped) {
        button.dispatchTarget(nested);
      }
      expect(nested.immediatePropagationStopped).toBe(true);
    });
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.continuePendingSyntheticRepositoryAction();
    expect(handlerCount).toBe(1);
  });

  it("nested .click() blocked", async () => {
    let handlerCount = 0;
    let nestedClickInvocations = 0;
    const releasePath = {
      run: (_el: HTMLButtonElement): void => {
        /* assigned below */
      },
    };

    const controller = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: (el) => {
        releasePath.run(el);
      },
    });
    releasePath.run = (el: HTMLButtonElement): void => {
      const event = createClickEvent(el);
      controller.handleCaptureClick(event as unknown as MouseEvent);
      (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
      if (!event.immediatePropagationStopped) {
        (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
      }
    };
    controller.start();
    const button = createValidButton();
    button.addEventListener("click", () => {
      handlerCount += 1;
      // Nested page-world .click() simulated as another dispatch through the same path.
      nestedClickInvocations += 1;
      releasePath.run(button as unknown as HTMLButtonElement);
    });
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.continuePendingSyntheticRepositoryAction();
    expect(handlerCount).toBe(1);
    expect(nestedClickInvocations).toBe(1);
  });

  it("other supported nested target blocked during release", async () => {
    let handlerCount = 0;
    let secondaryBlocked = false;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: (el) => {
        const event = createClickEvent(el);
        controller.handleCaptureClick(event as unknown as MouseEvent);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
        if (!event.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    const secondary = createValidButton();
    secondary.id = "secondary-supported";
    button.addEventListener("click", () => {
      handlerCount += 1;
      const nestedSecondary = createClickEvent(secondary as unknown as EventTarget);
      controller.handleCaptureClick(nestedSecondary as unknown as MouseEvent);
      secondaryBlocked = nestedSecondary.immediatePropagationStopped;
    });
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.continuePendingSyntheticRepositoryAction();
    expect(handlerCount).toBe(1);
    expect(secondaryBlocked).toBe(true);
  });

  it("duplicate Continue blocked", async () => {
    let releaseCount = 0;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: (el) => {
        releaseCount += 1;
        controller.continuePendingSyntheticRepositoryAction();
        const event = createClickEvent(el);
        controller.handleCaptureClick(event as unknown as MouseEvent);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
        if (!event.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.continuePendingSyntheticRepositoryAction();
    controller.continuePendingSyntheticRepositoryAction();
    expect(releaseCount).toBe(1);
    expect(controller.getLifecycleKind()).toBe("observing");
  });

  it("release cleanup success → observing, no pending, no guard", async () => {
    const uiBag = createMockUi();
    const controller = new Fc006InterceptionController({
      ui: uiBag.ui,
      nativeButtonClick: (el) => {
        const event = createClickEvent(el);
        controller.handleCaptureClick(event as unknown as MouseEvent);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
        if (!event.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    button.addEventListener("click", () => {
      /* page consequential handler */
    });
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.hasPendingElementGuard()).toBe(true);
    expect(button.captureListenerCount).toBe(1);

    controller.continuePendingSyntheticRepositoryAction();

    expect(controller.getLifecycleKind()).toBe("observing");
    expect(controller.getPending()).toBeNull();
    expect(controller.hasPendingElementGuard()).toBe(false);
    expect(button.captureListenerCount).toBe(0);
    expect(controller.getReleaseDebugState().armed).toBeNull();
    expect(controller.getReleaseDebugState().releaseInProgress).toBe(false);
    expect(controller.getReleaseDebugState().hasAuthorizedReleasedEvent).toBe(false);
    expect(uiBag.beginContinuing).toHaveBeenCalled();
    expect(uiBag.clearDialog).toHaveBeenCalled();
  });

  it("native-click no-dispatch → stale, execution 0", async () => {
    let handlerCount = 0;
    const { controller, button, ui } = await reachPreviewReady({
      nativeButtonClick: () => {
        // No event dispatch — authorization never consumed.
      },
    });
    button.addEventListener("click", () => {
      handlerCount += 1;
    });
    controller.continuePendingSyntheticRepositoryAction();
    expect(ui.beginContinuing).toHaveBeenCalled();
    expect(handlerCount).toBe(0);
    expect(controller.getLifecycleKind()).toBe("stale");
    expect(ui.showStale).toHaveBeenCalled();
    expect(controller.getPending()).not.toBeNull();
    expect(controller.getReleaseDebugState().armed).toBeNull();
    expect(controller.getReleaseDebugState().releaseInProgress).toBe(false);
  });

  it("native-click throws with secret → stale, no secret in UI, release cleared", async () => {
    const secret = "PASSWORD=super-secret user@example.com";
    const { controller, ui } = await reachPreviewReady({
      nativeButtonClick: () => {
        throw new Error(secret);
      },
    });
    controller.continuePendingSyntheticRepositoryAction();
    expect(controller.getLifecycleKind()).toBe("stale");
    expect(ui.showStale).toHaveBeenCalled();
    expect(controller.getReleaseDebugState().armed).toBeNull();
    expect(controller.getReleaseDebugState().releaseInProgress).toBe(false);
    const serialized = JSON.stringify(ui.showStale.mock.calls);
    expect(serialized).not.toContain("PASSWORD");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("user@example.com");
    expect(JSON.stringify(ui.beginContinuing.mock.calls)).not.toContain(secret);
  });

  it("reentrant Stop during release → off after stack", async () => {
    const uiBag = createMockUi();
    const controller = new Fc006InterceptionController({
      ui: uiBag.ui,
      nativeButtonClick: (el) => {
        // Stop requested while releaseInProgress — deferred until cleanup.
        controller.stop();
        expect(controller.getLifecycleKind()).toBe("continuing");
        expect(controller.getReleaseDebugState().stopRequestedAfterRelease).toBe(true);
        const event = createClickEvent(el);
        controller.handleCaptureClick(event as unknown as MouseEvent);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
        if (!event.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    button.addEventListener("click", () => {
      /* execute once */
    });
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.continuePendingSyntheticRepositoryAction();
    expect(controller.getLifecycleKind()).toBe("off");
    expect(controller.getPending()).toBeNull();
    expect(uiBag.setActive).toHaveBeenCalledWith(false);
  });

  it("old continue after Cancel cannot release", async () => {
    let releaseCount = 0;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: () => {
        releaseCount += 1;
      },
    });
    controller.start();
    const buttonA = createValidButton();
    controller.beginPendingFromCandidate(
      buttonA as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getLifecycleKind()).toBe("preview-ready");
    const tokenA = controller.getActiveDecisionToken();
    expect(tokenA).not.toBeNull();
    controller.cancelPending();
    expect(controller.getLifecycleKind()).toBe("observing");

    const buttonB = createValidButton();
    controller.beginPendingFromCandidate(
      buttonB as unknown as HTMLButtonElement,
      createObservation({ entityKey: "fixture-repository" }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getLifecycleKind()).toBe("preview-ready");
    const tokenB = controller.getActiveDecisionToken();
    expect(tokenB).not.toBeNull();
    expect(tokenA).not.toEqual(tokenB);
    const pendingB = controller.getPending();
    const evaluationB = pendingB?.assessment;

    if (!tokenA) throw new Error("missing tokenA");
    controller.continueDecision(tokenA);
    expect(releaseCount).toBe(0);
    expect(controller.getLifecycleKind()).toBe("preview-ready");
    expect(controller.getPending()?.pendingId).toBe(pendingB?.pendingId);
    expect(controller.getPending()?.assessment).toBe(evaluationB);
  });

  it("old continue after Stop/Start cannot release", async () => {
    let releaseCount = 0;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: () => {
        releaseCount += 1;
      },
    });
    controller.start();
    const buttonA = createValidButton();
    controller.beginPendingFromCandidate(
      buttonA as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    const tokenA = controller.getActiveDecisionToken();
    expect(tokenA).not.toBeNull();
    controller.stop();
    controller.start();
    expect(controller.getLifecycleKind()).toBe("observing");

    const buttonB = createValidButton();
    controller.beginPendingFromCandidate(
      buttonB as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getLifecycleKind()).toBe("preview-ready");
    const pendingB = controller.getPending();
    const evaluationB = pendingB?.assessment;

    if (!tokenA) throw new Error("missing tokenA");
    controller.continueDecision(tokenA);
    expect(releaseCount).toBe(0);
    expect(controller.getLifecycleKind()).toBe("preview-ready");
    expect(controller.getPending()?.pendingId).toBe(pendingB?.pendingId);
    expect(controller.getPending()?.assessment).toBe(evaluationB);
  });

  it("event object identity: authorized Event A allowed, nested Event B same target blocked", async () => {
    let handlerCount = 0;
    let authorizedEventA: MockClickEvent | null = null;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: (el) => {
        const eventA = createClickEvent(el);
        authorizedEventA = eventA;
        controller.handleCaptureClick(eventA as unknown as MouseEvent);
        expect(controller.getReleaseDebugState().hasAuthorizedReleasedEvent).toBe(true);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(eventA);
        if (!eventA.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(eventA);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    button.addEventListener("click", () => {
      handlerCount += 1;
      const eventB = createClickEvent(button as unknown as EventTarget);
      expect(eventB).not.toBe(authorizedEventA);
      controller.handleCaptureClick(eventB as unknown as MouseEvent);
      button.dispatchCapture(eventB);
      if (!eventB.immediatePropagationStopped) {
        button.dispatchTarget(eventB);
      }
      expect(eventB.immediatePropagationStopped).toBe(true);
    });
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.continuePendingSyntheticRepositoryAction();
    expect(handlerCount).toBe(1);
    expect(authorizedEventA).not.toBeNull();
  });

  it("hostile instance click override not used (captured-path seam)", async () => {
    let releaseViaCapturedPath = 0;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      // Captured-path simulation: never call instance `.click()`.
      nativeButtonClick: (el) => {
        releaseViaCapturedPath += 1;
        const event = createClickEvent(el);
        controller.handleCaptureClick(event as unknown as MouseEvent);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
        if (!event.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    const hostileClick = button.click;
    button.addEventListener("click", () => {
      /* ok */
    });
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.continuePendingSyntheticRepositoryAction();
    expect(releaseViaCapturedPath).toBe(1);
    expect(hostileClick).not.toHaveBeenCalled();
  });

  it("H1: different valid entityKey before Continue → stale", async () => {
    let nativeInvocationCount = 0;
    const { controller, button, ui } = await reachPreviewReady({
      nativeButtonClick: () => {
        nativeInvocationCount += 1;
      },
    });
    const beforeGen = controller.getReleaseDebugState().releaseGeneration;
    button.setAttribute(ATTR_ENTITY_KEY, "fixture-repository-alternate");
    controller.continuePendingSyntheticRepositoryAction();
    expect(controller.getLifecycleKind()).toBe("stale");
    expect(ui.beginContinuing).toHaveBeenCalled();
    expect(nativeInvocationCount).toBe(0);
    expect(controller.getReleaseDebugState().releaseGeneration).toBe(beforeGen);
    expect(controller.getReleaseDebugState().armed).toBeNull();
  });

  it("H1: invalid entityKey before Continue → stale", async () => {
    await expectStaleNoNativeRelease(({ button }) => {
      button.setAttribute(ATTR_ENTITY_KEY, "");
    });
  });

  it("H1: entity/fact binding mismatch → stale", async () => {
    await expectStaleNoNativeRelease(({ controller }) => {
      const pending = controller.getPending();
      if (!pending?.context) throw new Error("missing context");
      const entity = pending.context.state.entities[0];
      if (!entity) throw new Error("missing entity");
      (pending as { context?: unknown }).context = {
        ...pending.context,
        state: {
          ...pending.context.state,
          facts: pending.context.state.facts.map((f) => ({
            ...f,
            subjectEntityId: "entity-other" as never,
          })),
        },
      };
    });
  });

  it("H1: target role mismatch → stale", async () => {
    await expectStaleNoNativeRelease(({ controller }) => {
      const pending = controller.getPending();
      if (!pending?.context) throw new Error("missing context");
      (pending as { context?: unknown }).context = {
        ...pending.context,
        action: {
          ...pending.context.action,
          targets: pending.context.action.targets.map((t) => ({
            ...t,
            role: "secondary" as never,
          })),
        },
      };
    });
  });

  it("H2: old Continue after success is inert", async () => {
    let releaseCount = 0;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: (el) => {
        releaseCount += 1;
        const event = createClickEvent(el);
        controller.handleCaptureClick(event as unknown as MouseEvent);
        (el as unknown as MockHTMLButtonElement).dispatchCapture(event);
        if (!event.immediatePropagationStopped) {
          (el as unknown as MockHTMLButtonElement).dispatchTarget(event);
        }
      },
    });
    controller.start();
    const button = createValidButton();
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    const tokenA = controller.getActiveDecisionToken();
    controller.continuePendingSyntheticRepositoryAction();
    expect(releaseCount).toBe(1);
    expect(controller.getLifecycleKind()).toBe("observing");
    if (!tokenA) throw new Error("missing tokenA");
    controller.continueDecision(tokenA);
    expect(releaseCount).toBe(1);
    expect(controller.getLifecycleKind()).toBe("observing");
  });

  it("H2: old Continue after stale/Dismiss does not disturb new pending", async () => {
    let releaseCount = 0;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: () => {
        releaseCount += 1;
      },
    });
    controller.start();
    const buttonA = createValidButton();
    controller.beginPendingFromCandidate(
      buttonA as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    const tokenA = controller.getActiveDecisionToken();
    buttonA.setAttribute(ATTR_ENTITY_KEY, "fixture-repository-alternate");
    controller.continuePendingSyntheticRepositoryAction();
    expect(controller.getLifecycleKind()).toBe("stale");
    controller.dismissDecision();
    expect(controller.getLifecycleKind()).toBe("observing");

    const buttonB = createValidButton();
    controller.beginPendingFromCandidate(
      buttonB as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    const pendingB = controller.getPending();
    if (!tokenA) throw new Error("missing tokenA");
    controller.continueDecision(tokenA);
    expect(releaseCount).toBe(0);
    expect(controller.getLifecycleKind()).toBe("preview-ready");
    expect(controller.getPending()?.pendingId).toBe(pendingB?.pendingId);
  });

  it("H2: token mismatch does not disturb current valid B", async () => {
    let nativeInvocationCount = 0;
    const { controller } = await reachPreviewReady({
      nativeButtonClick: () => {
        nativeInvocationCount += 1;
      },
    });
    const beforeGen = controller.getReleaseDebugState().releaseGeneration;
    const pendingB = controller.getPending();
    if (!pendingB) throw new Error("missing pendingB");
    const wrong = {
      pendingId: "not-this-pending",
      sessionEpoch: pendingB.sessionEpoch,
      requestSequence: pendingB.requestSequence,
      previewGeneration: 999,
    };
    controller.continueDecision(wrong);
    expect(nativeInvocationCount).toBe(0);
    expect(controller.getReleaseDebugState().releaseGeneration).toBe(beforeGen);
    expect(controller.getReleaseDebugState().armed).toBeNull();
    expect(controller.getLifecycleKind()).toBe("preview-ready");
    expect(controller.getPending()?.pendingId).toBe(pendingB.pendingId);
  });

  it("H3: beginContinuing page mutation of fixtureContract → stale before arm", async () => {
    const ui = createMockUi();
    let buttonRef: MockHTMLButtonElement | null = null;
    let nativeInvocationCount = 0;
    ui.beginContinuing.mockImplementation(() => {
      buttonRef?.setAttribute(ATTR_FIXTURE_CONTRACT, "hostile-mutated-contract");
    });
    const controller = new Fc006InterceptionController({
      ui: ui.ui,
      nativeButtonClick: () => {
        nativeInvocationCount += 1;
      },
    });
    controller.start();
    buttonRef = createValidButton();
    controller.beginPendingFromCandidate(
      buttonRef as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    const beforeGen = controller.getReleaseDebugState().releaseGeneration;
    controller.continuePendingSyntheticRepositoryAction();
    expect(ui.beginContinuing).toHaveBeenCalled();
    expect(controller.getLifecycleKind()).toBe("stale");
    expect(nativeInvocationCount).toBe(0);
    expect(controller.getReleaseDebugState().releaseGeneration).toBe(beforeGen);
    expect(controller.getReleaseDebugState().armed).toBeNull();
    expect(controller.getReleaseDebugState().releaseInProgress).toBe(false);
  });

  it("H3: beginContinuing page mutation of valid entityKey → stale before arm", async () => {
    const ui = createMockUi();
    let buttonRef: MockHTMLButtonElement | null = null;
    let nativeInvocationCount = 0;
    ui.beginContinuing.mockImplementation(() => {
      buttonRef?.setAttribute(ATTR_ENTITY_KEY, "fixture-repository-alternate");
    });
    const controller = new Fc006InterceptionController({
      ui: ui.ui,
      nativeButtonClick: () => {
        nativeInvocationCount += 1;
      },
    });
    controller.start();
    buttonRef = createValidButton();
    controller.beginPendingFromCandidate(
      buttonRef as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    const beforeGen = controller.getReleaseDebugState().releaseGeneration;
    controller.continuePendingSyntheticRepositoryAction();
    expect(controller.getLifecycleKind()).toBe("stale");
    expect(nativeInvocationCount).toBe(0);
    expect(controller.getReleaseDebugState().releaseGeneration).toBe(beforeGen);
    expect(controller.getReleaseDebugState().armed).toBeNull();
  });

  it("M1 assessment tamper matrix → all stale", async () => {
    type Pending = NonNullable<ReturnType<Fc006InterceptionController["getPending"]>>;

    function firstConsequence(assessment: NonNullable<Pending["assessment"]>) {
      const c = assessment.consequences[0];
      if (!c) throw new Error("missing consequence");
      return c;
    }

    function setAssessment(pending: Pending, next: NonNullable<Pending["assessment"]>): void {
      (pending as { assessment?: unknown }).assessment = next;
    }

    function setContext(pending: Pending, next: NonNullable<Pending["context"]>): void {
      (pending as { context?: unknown }).context = next;
    }

    const cases: Array<{ name: string; mutate: (pending: Pending) => void }> = [
      {
        name: "summary",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          setAssessment(p, {
            ...assessment,
            consequences: [{ ...c, summary: "tampered summary" }],
          });
        },
      },
      {
        name: "evidence mode",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const e = c.evidence[0];
          if (!e) throw new Error("missing evidence");
          setAssessment(p, {
            ...assessment,
            consequences: [{ ...c, evidence: [{ ...e, mode: "simulated" }] }],
          });
        },
      },
      {
        name: "evidence confidence",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const e = c.evidence[0];
          if (!e) throw new Error("missing evidence");
          setAssessment(p, {
            ...assessment,
            consequences: [{ ...c, evidence: [{ ...e, confidence: 0.5 as never }] }],
          });
        },
      },
      {
        name: "evidence rule / provenance",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          if (!c.provenance) throw new Error("missing provenance");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                provenance: {
                  ...c.provenance,
                  ruleId: "tampered.rule",
                },
              },
            ],
          });
        },
      },
      {
        name: "evidence scope",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const e = c.evidence[0];
          if (!e) throw new Error("missing evidence");
          setAssessment(p, {
            ...assessment,
            consequences: [{ ...c, evidence: [{ ...e, scope: "tampered scope" }] }],
          });
        },
      },
      {
        name: "evidence assumptions",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const e = c.evidence[0];
          if (!e) throw new Error("missing evidence");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                evidence: [
                  {
                    ...e,
                    assumptions: [{ id: "x", statement: "tampered", status: "assumed" }],
                  },
                ],
              },
            ],
          });
        },
      },
      {
        name: "risk severity",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          if (!c.risk) throw new Error("missing risk");
          setAssessment(p, {
            ...assessment,
            consequences: [{ ...c, risk: { ...c.risk, severity: "low" } }],
          });
        },
      },
      {
        name: "risk description",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          if (!c.risk) throw new Error("missing risk");
          setAssessment(p, {
            ...assessment,
            consequences: [{ ...c, risk: { ...c.risk, description: "tampered risk" } }],
          });
        },
      },
      {
        name: "missing security",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          if (!c.risk) throw new Error("missing risk");
          setAssessment(p, {
            ...assessment,
            consequences: [{ ...c, risk: { ...c.risk, categories: ["privacy"] } }],
          });
        },
      },
      {
        name: "missing privacy",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          if (!c.risk) throw new Error("missing risk");
          setAssessment(p, {
            ...assessment,
            consequences: [{ ...c, risk: { ...c.risk, categories: ["security"] } }],
          });
        },
      },
      {
        name: "extra category",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          if (!c.risk) throw new Error("missing risk");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                risk: { ...c.risk, categories: ["security", "privacy", "reputation"] },
              },
            ],
          });
        },
      },
      {
        name: "reversibility level",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          if (!c.reversibility) throw new Error("missing reversibility");
          setAssessment(p, {
            ...assessment,
            consequences: [{ ...c, reversibility: { ...c.reversibility, level: "irreversible" } }],
          });
        },
      },
      {
        name: "reversibility method",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          if (!c.reversibility) throw new Error("missing reversibility");
          setAssessment(p, {
            ...assessment,
            consequences: [
              { ...c, reversibility: { ...c.reversibility, method: "tampered method" } },
            ],
          });
        },
      },
      {
        name: "reversibility requirements",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          if (!c.reversibility) throw new Error("missing reversibility");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                reversibility: { ...c.reversibility, requirements: ["tampered req"] },
              },
            ],
          });
        },
      },
      {
        name: "before",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const sc = c.stateChanges?.[0];
          if (!sc) throw new Error("missing state change");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                stateChanges: [{ ...sc, before: { status: "known", value: "internal" } }],
              },
            ],
          });
        },
      },
      {
        name: "after",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const sc = c.stateChanges?.[0];
          if (!sc) throw new Error("missing state change");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                stateChanges: [{ ...sc, after: { status: "known", value: "private" } }],
              },
            ],
          });
        },
      },
      {
        name: "state-change entity",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const sc = c.stateChanges?.[0];
          if (!sc) throw new Error("missing state change");
          setAssessment(p, {
            ...assessment,
            consequences: [{ ...c, stateChanges: [{ ...sc, entityId: "entity-other" as never }] }],
          });
        },
      },
      {
        name: "extra entity",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          const entity = ctx.state.entities[0];
          if (!entity) throw new Error("missing entity");
          setContext(p, {
            ...ctx,
            state: {
              ...ctx.state,
              entities: [entity, { ...entity, id: "entity-extra" as never, label: "Extra" }],
            },
          });
        },
      },
      {
        name: "duplicate fact",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          const fact = ctx.state.facts[0];
          if (!fact) throw new Error("missing fact");
          setContext(p, {
            ...ctx,
            state: {
              ...ctx.state,
              facts: [fact, { ...fact, id: "fact-dup" as never }],
            },
          });
        },
      },
      {
        name: "extra consequence",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          setAssessment(p, {
            ...assessment,
            consequences: [c, { ...c, id: "csq-extra" as never }],
          });
        },
      },
      {
        name: "assessment provenance source",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          setAssessment(p, {
            ...assessment,
            provenance: { ...assessment.provenance, source: "adapter" as never },
          });
        },
      },
      {
        name: "before array coercion",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const sc = c.stateChanges?.[0];
          if (!sc) throw new Error("missing state change");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                stateChanges: [{ ...sc, before: { status: "known", value: ["private"] } }],
              },
            ],
          });
        },
      },
      {
        name: "after array coercion",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const sc = c.stateChanges?.[0];
          if (!sc) throw new Error("missing state change");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                stateChanges: [{ ...sc, after: { status: "known", value: ["public"] } }],
              },
            ],
          });
        },
      },
      {
        name: "before String object",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const sc = c.stateChanges?.[0];
          if (!sc) throw new Error("missing state change");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                stateChanges: [
                  {
                    ...sc,
                    before: { status: "known", value: new String("private") as never },
                  },
                ],
              },
            ],
          });
        },
      },
      {
        name: "after String object",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const sc = c.stateChanges?.[0];
          if (!sc) throw new Error("missing state change");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                stateChanges: [
                  {
                    ...sc,
                    after: { status: "known", value: new String("public") as never },
                  },
                ],
              },
            ],
          });
        },
      },
      {
        name: "before custom toString",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const sc = c.stateChanges?.[0];
          if (!sc) throw new Error("missing state change");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                stateChanges: [
                  {
                    ...sc,
                    before: {
                      status: "known",
                      value: {
                        toString: () => "private",
                      } as never,
                    },
                  },
                ],
              },
            ],
          });
        },
      },
      {
        name: "after custom toString",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const sc = c.stateChanges?.[0];
          if (!sc) throw new Error("missing state change");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                stateChanges: [
                  {
                    ...sc,
                    after: {
                      status: "known",
                      value: {
                        toString: () => "public",
                      } as never,
                    },
                  },
                ],
              },
            ],
          });
        },
      },
      {
        name: "state provenance source",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx?.state.provenance) throw new Error("missing state provenance");
          setContext(p, {
            ...ctx,
            state: {
              ...ctx.state,
              provenance: { ...ctx.state.provenance, source: "model" },
            },
          });
        },
      },
      {
        name: "state provenance synthetic",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx?.state.provenance?.details) throw new Error("missing state provenance details");
          setContext(p, {
            ...ctx,
            state: {
              ...ctx.state,
              provenance: {
                ...ctx.state.provenance,
                details: { ...ctx.state.provenance.details, synthetic: false },
              },
            },
          });
        },
      },
      {
        name: "state provenance extra semantic field",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx?.state.provenance?.details) throw new Error("missing state provenance details");
          setContext(p, {
            ...ctx,
            state: {
              ...ctx.state,
              provenance: {
                ...ctx.state.provenance,
                details: {
                  ...ctx.state.provenance.details,
                  hostileSemantic: "injected",
                },
              },
            },
          });
        },
      },
      {
        name: "assessment engine version",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          setAssessment(p, {
            ...assessment,
            provenance: { ...assessment.provenance, engineVersion: "9.9.9" },
          });
        },
      },
      {
        name: "evidence details unexpected",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          const e = c.evidence[0];
          if (!e) throw new Error("missing evidence");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                evidence: [{ ...e, details: { contradictory: true } }],
              },
            ],
          });
        },
      },
      {
        name: "reversibility timeWindow unexpected",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          if (!c.reversibility) throw new Error("missing reversibility");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                reversibility: { ...c.reversibility, timeWindow: "immediate" },
              },
            ],
          });
        },
      },
      {
        name: "consequence provenance unexpected engineVersion",
        mutate: (p) => {
          const assessment = p.assessment;
          if (!assessment) throw new Error("missing assessment");
          const c = firstConsequence(assessment);
          if (!c.provenance) throw new Error("missing consequence provenance");
          setAssessment(p, {
            ...assessment,
            consequences: [
              {
                ...c,
                provenance: { ...c.provenance, engineVersion: "0.2.0" },
              },
            ],
          });
        },
      },
    ];

    for (const { name, mutate } of cases) {
      locationState.pathname = AUTHORIZED_LOCATION.pathname;
      let nativeInvocationCount = 0;
      const { controller } = await reachPreviewReady({
        nativeButtonClick: () => {
          nativeInvocationCount += 1;
        },
      });
      const beforeGen = controller.getReleaseDebugState().releaseGeneration;
      const pending = controller.getPending();
      if (!pending) throw new Error("missing pending");
      mutate(pending);
      controller.continuePendingSyntheticRepositoryAction();
      expect(controller.getLifecycleKind(), name).toBe("stale");
      expect(nativeInvocationCount, name).toBe(0);
      expect(controller.getReleaseDebugState().releaseGeneration, name).toBe(beforeGen);
      expect(controller.getReleaseDebugState().armed, name).toBeNull();
      expect(controller.getReleaseDebugState().releaseInProgress, name).toBe(false);
      expect(controller.getReleaseDebugState().hasAuthorizedReleasedEvent, name).toBe(false);
    }
  });

  it("Sprint 3C actor/environment binding rejects substitutions", async () => {
    type Pending = NonNullable<ReturnType<Fc006InterceptionController["getPending"]>>;

    function setContext(pending: Pending, next: NonNullable<Pending["context"]>): void {
      (pending as { context?: unknown }).context = next;
    }

    const cases: Array<{ name: string; mutate: (pending: Pending) => void }> = [
      {
        name: "actor kind agent",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          setContext(p, {
            ...ctx,
            action: { ...ctx.action, actor: { kind: "agent" } },
          });
        },
      },
      {
        name: "actor id insertion",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          setContext(p, {
            ...ctx,
            action: {
              ...ctx.action,
              actor: { kind: "human", id: "different-principal" },
            },
          });
        },
      },
      {
        name: "actor alternate valid kind system",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          setContext(p, {
            ...ctx,
            action: { ...ctx.action, actor: { kind: "system" } },
          });
        },
      },
      {
        name: "environment kind service both sides",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          const env = { ...ctx.state.environment, kind: "service" as const };
          setContext(p, {
            ...ctx,
            state: { ...ctx.state, environment: env },
            action: { ...ctx.action, environment: env },
          });
        },
      },
      {
        name: "environment platform desktop both sides",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          const env = { ...ctx.state.environment, platform: "macos" as const };
          setContext(p, {
            ...ctx,
            state: { ...ctx.state, environment: env },
            action: { ...ctx.action, environment: env },
          });
        },
      },
      {
        name: "application name both sides",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          const application = {
            ...ctx.state.environment.application,
            name: "Other Platform",
          };
          const env = { ...ctx.state.environment, application };
          setContext(p, {
            ...ctx,
            state: { ...ctx.state, environment: env },
            action: { ...ctx.action, environment: env },
          });
        },
      },
      {
        name: "application id both sides",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          const application = {
            ...ctx.state.environment.application,
            id: "app-other-platform",
          };
          const env = { ...ctx.state.environment, application };
          setContext(p, {
            ...ctx,
            state: { ...ctx.state, environment: env },
            action: { ...ctx.action, environment: env },
          });
        },
      },
      {
        name: "application version both sides",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          const application = {
            ...ctx.state.environment.application,
            version: "9.9",
          };
          const env = { ...ctx.state.environment, application };
          setContext(p, {
            ...ctx,
            state: { ...ctx.state, environment: env },
            action: { ...ctx.action, environment: env },
          });
        },
      },
      {
        name: "sessionId inserted both sides",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          const env = {
            ...ctx.state.environment,
            sessionId: "other-session",
          };
          setContext(p, {
            ...ctx,
            state: { ...ctx.state, environment: env },
            action: { ...ctx.action, environment: env },
          });
        },
      },
      {
        name: "state/action environment kind mismatch",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          setContext(p, {
            ...ctx,
            action: {
              ...ctx.action,
              environment: { ...ctx.action.environment, kind: "service" },
            },
          });
        },
      },
      {
        name: "unexpected environment semantic field",
        mutate: (p) => {
          const ctx = p.context;
          if (!ctx) throw new Error("missing context");
          const env = {
            ...ctx.state.environment,
            hostileField: "injected",
          } as typeof ctx.state.environment;
          setContext(p, {
            ...ctx,
            state: { ...ctx.state, environment: env },
            action: { ...ctx.action, environment: env },
          });
        },
      },
    ];

    for (const { name, mutate } of cases) {
      locationState.pathname = AUTHORIZED_LOCATION.pathname;
      let nativeInvocationCount = 0;
      const { controller } = await reachPreviewReady({
        nativeButtonClick: () => {
          nativeInvocationCount += 1;
        },
      });
      const beforeGen = controller.getReleaseDebugState().releaseGeneration;
      const pending = controller.getPending();
      if (!pending) throw new Error("missing pending");
      mutate(pending);
      controller.continuePendingSyntheticRepositoryAction();
      expect(controller.getLifecycleKind(), name).toBe("stale");
      expect(nativeInvocationCount, name).toBe(0);
      expect(controller.getReleaseDebugState().releaseGeneration, name).toBe(beforeGen);
      expect(controller.getReleaseDebugState().armed, name).toBeNull();
      expect(controller.getReleaseDebugState().releaseInProgress, name).toBe(false);
      expect(controller.getReleaseDebugState().hasAuthorizedReleasedEvent, name).toBe(false);
    }
  });

  it("window authorization checks releaseGeneration", async () => {
    let blockedWrongGeneration = false;
    const controller: Fc006InterceptionController = new Fc006InterceptionController({
      ui: createMockUi().ui,
      nativeButtonClick: (el) => {
        controller.testDesyncArmedReleaseGeneration();
        const event = createClickEvent(el);
        controller.handleCaptureClick(event as unknown as MouseEvent);
        blockedWrongGeneration =
          event.immediatePropagationStopped === true &&
          controller.getReleaseDebugState().hasAuthorizedReleasedEvent === false;
      },
    });
    controller.start();
    const button = createValidButton();
    button.addEventListener("click", () => {
      /* should not run */
    });
    controller.beginPendingFromCandidate(
      button as unknown as HTMLButtonElement,
      createObservation(),
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.continuePendingSyntheticRepositoryAction();
    expect(blockedWrongGeneration).toBe(true);
    expect(controller.getLifecycleKind()).toBe("stale");
    expect(controller.getReleaseDebugState().armed).toBeNull();
  });
});
