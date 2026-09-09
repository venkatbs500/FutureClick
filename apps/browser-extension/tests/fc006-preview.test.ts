/**
 * FC-006 Sprint 2 preview copy + UI ownership/accessibility contracts.
 */

import { describe, expect, it, vi } from "vitest";
import { FC006_PREVIEW_COPY, Fc006Ui } from "../src/fc006/preview.js";

describe("FC-006 Sprint 2: Preview copy integrity", () => {
  it("uses fixed trusted mappings (not raw DOM / draft)", () => {
    expect(FC006_PREVIEW_COPY.riskLabel).toBe("HIGH RISK");
    expect(FC006_PREVIEW_COPY.beforeLabel).toBe("Private");
    expect(FC006_PREVIEW_COPY.afterLabel).toBe("Public");
    expect(FC006_PREVIEW_COPY.evidenceLabel).toBe("VERIFIED");
    expect(FC006_PREVIEW_COPY.categories).toEqual(["Security", "Privacy"]);
    expect(FC006_PREVIEW_COPY.reversibilityLabel).toBe("Partially reversible");
    expect(FC006_PREVIEW_COPY.fixedExplanation).toContain("repository public");
    expect(FC006_PREVIEW_COPY.syntheticDisclaimer).toContain("VERIFIED means a deterministic");
  });
});

describe("FC-006 Sprint 2: UI mount + a11y contracts", () => {
  it("mounts indicator/dialog with alertdialog semantics and trusted-only controls", () => {
    const created: Array<{ tag: string; el: FakeEl }> = [];

    class FakeEl {
      tagName: string;
      style: Record<string, string> = {};
      hidden = false;
      disabled = false;
      textContent = "";
      id = "";
      children: FakeEl[] = [];
      attrs = new Map<string, string>();
      listeners = new Map<string, Array<(e: FakeEvent) => void>>();
      shadow: FakeShadow | null = null;
      parent: FakeEl | null = null;
      isConnected = true;
      ownerDocument: unknown = null;
      activeElement: FakeEl | null = null;

      get parentElement(): FakeEl | null {
        return this.parent;
      }

      constructor(tag: string) {
        this.tagName = tag.toUpperCase();
        created.push({ tag, el: this });
      }
      setAttribute(k: string, v: string) {
        this.attrs.set(k, v);
      }
      getAttribute(k: string) {
        return this.attrs.get(k) ?? null;
      }
      append(...nodes: FakeEl[]) {
        for (const n of nodes) {
          n.parent = this;
          this.children.push(n);
        }
      }
      replaceChildren(...nodes: FakeEl[]) {
        this.children = [];
        this.append(...nodes);
      }
      addEventListener(type: string, fn: (e: FakeEvent) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      }
      removeEventListener(type: string, fn: (e: FakeEvent) => void) {
        const list = this.listeners.get(type) ?? [];
        this.listeners.set(
          type,
          list.filter((h) => h !== fn),
        );
      }
      replaceChild(next: FakeEl, old: FakeEl) {
        const idx = this.children.indexOf(old);
        if (idx >= 0) {
          this.children[idx] = next;
          next.parent = this;
          old.parent = null;
        }
      }
      attachShadow(_init: { mode: string }) {
        this.shadow = new FakeShadow(this);
        return this.shadow;
      }
      focus() {
        /* no-op */
      }
      dispatchTrustedClick() {
        const handlers = this.listeners.get("click") ?? [];
        for (const h of handlers)
          h({
            isTrusted: true,
            type: "click",
            key: "",
            preventDefault() {},
            stopPropagation() {},
            shiftKey: false,
          });
      }
      dispatchUntrustedClick() {
        const handlers = this.listeners.get("click") ?? [];
        for (const h of handlers)
          h({
            isTrusted: false,
            type: "click",
            key: "",
            preventDefault() {},
            stopPropagation() {},
            shiftKey: false,
          });
      }
    }

    class FakeShadow {
      host: FakeEl;
      children: FakeEl[] = [];
      activeElement: FakeEl | null = null;
      listeners = new Map<string, Array<(e: FakeEvent) => void>>();
      innerHTML = "";
      constructor(host: FakeEl) {
        this.host = host;
      }
      append(...nodes: FakeEl[]) {
        this.children.push(...nodes);
      }
      addEventListener(type: string, fn: (e: FakeEvent) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      }
    }

    interface FakeEvent {
      isTrusted: boolean;
      type: string;
      key: string;
      shiftKey: boolean;
      preventDefault(): void;
      stopPropagation(): void;
    }

    const body = new FakeEl("body");
    const docEl = new FakeEl("html");
    docEl.append(body);

    const fakeDocument = {
      documentElement: docEl,
      body,
      createElement: (tag: string) => {
        const el = new FakeEl(tag);
        el.ownerDocument = fakeDocument;
        return el;
      },
      activeElement: null as FakeEl | null,
      addEventListener: vi.fn(),
    };

    const origDocument = globalThis.document;
    (globalThis as unknown as { document: unknown }).document = fakeDocument;

    try {
      const onStart = vi.fn();
      const onStop = vi.fn();
      const onCancel = vi.fn();
      const onDismiss = vi.fn();
      const onContinueDecision = vi.fn();
      const ui = new Fc006Ui();
      ui.init({ onStart, onStop, onCancel, onDismiss, onContinueDecision });

      const roots = ui.getOwnedRoots();
      expect(roots.hosts.length).toBeGreaterThanOrEqual(2);
      expect(roots.shadowRoots.length).toBeGreaterThanOrEqual(2);

      const dialogHost = roots.hosts.find(
        (h) => (h as unknown as FakeEl).attrs.get("data-futureclick-ui") === "dialog",
      ) as unknown as FakeEl | undefined;
      expect(dialogHost).toBeDefined();
      const dialogPanel = dialogHost?.shadow?.children.find(
        (c) => c.attrs.get("role") === "alertdialog",
      );
      expect(dialogPanel).toBeDefined();
      expect(dialogPanel?.attrs.get("aria-modal")).toBe("true");
      expect(dialogPanel?.attrs.get("aria-labelledby")).toBe("fc006-dialog-title");
      expect(dialogPanel?.attrs.get("aria-describedby")).toBe("fc006-dialog-desc");

      ui.setActive(true);
      ui.showEvaluating();
      expect(ui.getDialogMode()).toBe("evaluating");
      expect(ui.getCancelButton()?.hidden).toBe(false);
      expect(ui.getDismissButton()?.hidden).toBe(true);

      (ui.getStartButton() as unknown as FakeEl | null)?.dispatchUntrustedClick();
      expect(onStart).not.toHaveBeenCalled();
      (ui.getCancelButton() as unknown as FakeEl | null)?.dispatchUntrustedClick();
      expect(onCancel).not.toHaveBeenCalled();

      (ui.getCancelButton() as unknown as FakeEl | null)?.dispatchTrustedClick();
      expect(onCancel).toHaveBeenCalledTimes(1);

      ui.showPreview(
        {
          riskLabel: FC006_PREVIEW_COPY.riskLabel,
          beforeLabel: FC006_PREVIEW_COPY.beforeLabel,
          afterLabel: FC006_PREVIEW_COPY.afterLabel,
          evidenceLabel: FC006_PREVIEW_COPY.evidenceLabel,
          categories: [...FC006_PREVIEW_COPY.categories],
          reversibilityLabel: FC006_PREVIEW_COPY.reversibilityLabel,
          engineSummary:
            'Repository "Synthetic Repository" visibility will change from private to public.',
          fixedExplanation: FC006_PREVIEW_COPY.fixedExplanation,
          syntheticDisclaimer: FC006_PREVIEW_COPY.syntheticDisclaimer,
        },
        {
          pendingId: "pending-test",
          sessionEpoch: 1,
          requestSequence: 1,
          previewGeneration: 1,
        },
      );
      expect(ui.getDialogMode()).toBe("preview");
      (ui.getContinueButton() as unknown as FakeEl | null)?.dispatchTrustedClick();
      expect(onContinueDecision).toHaveBeenCalledTimes(1);
      expect(onContinueDecision.mock.calls[0]?.[0]).toEqual({
        pendingId: "pending-test",
        sessionEpoch: 1,
        requestSequence: 1,
        previewGeneration: 1,
      });
      (ui.getContinueButton() as unknown as FakeEl | null)?.dispatchUntrustedClick();
      expect(onContinueDecision).toHaveBeenCalledTimes(1);
      const previewText = JSON.stringify(
        (ui as unknown as { dialogExtraEl: FakeEl | null }).dialogExtraEl?.children.map(
          (c) => c.textContent,
        ),
      );
      // private field may not be accessible — use getVisibleDialogControls instead
      expect(ui.getVisibleDialogControls().map((b) => b.textContent)).toEqual([
        "Cancel",
        "Continue",
        "Stop FutureClick",
      ]);
      expect(previewText === undefined || !previewText.includes("Continue")).toBe(true);

      ui.showAbstention();
      expect(ui.getVisibleDialogControls().map((b) => b.textContent)).toEqual([
        "Dismiss",
        "Stop FutureClick",
      ]);

      // Escape dismisses abstention
      const keyHandlers = dialogHost?.shadow?.listeners.get("keydown") ?? [];
      for (const h of keyHandlers) {
        h({
          isTrusted: true,
          type: "keydown",
          key: "Escape",
          shiftKey: false,
          preventDefault() {},
          stopPropagation() {},
        });
      }
      expect(onDismiss).toHaveBeenCalled();
    } finally {
      (globalThis as unknown as { document: unknown }).document = origDocument;
    }
  });
});

describe("FC-006 Sprint 2B: Focus trap uses exact controls (no ancestor walk)", () => {
  it("Tab cycles known controls without parentNode / composedPath inspection", () => {
    class FakeEl {
      tagName: string;
      style: Record<string, string> = {};
      hidden = false;
      disabled = false;
      textContent = "";
      id = "";
      children: FakeEl[] = [];
      attrs = new Map<string, string>();
      listeners = new Map<string, Array<(e: FakeEvent) => void>>();
      shadow: FakeShadow | null = null;
      parent: FakeEl | null = null;
      parentNode: FakeEl | null = null;
      parentElement: FakeEl | null = null;
      isConnected = true;
      ownerDocument: unknown = null;
      focusCalls = 0;

      constructor(tag: string) {
        this.tagName = tag.toUpperCase();
      }
      setAttribute(k: string, v: string) {
        this.attrs.set(k, v);
      }
      getAttribute(k: string) {
        return this.attrs.get(k) ?? null;
      }
      append(...nodes: FakeEl[]) {
        for (const n of nodes) {
          n.parent = this;
          n.parentNode = this;
          n.parentElement = this;
          this.children.push(n);
        }
      }
      replaceChildren(...nodes: FakeEl[]) {
        this.children = [];
        this.append(...nodes);
      }
      addEventListener(type: string, fn: (e: FakeEvent) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      }
      removeEventListener(type: string, fn: (e: FakeEvent) => void) {
        const list = this.listeners.get(type) ?? [];
        this.listeners.set(
          type,
          list.filter((h) => h !== fn),
        );
      }
      replaceChild(next: FakeEl, old: FakeEl) {
        const idx = this.children.indexOf(old);
        if (idx >= 0) {
          this.children[idx] = next;
          next.parent = this;
          old.parent = null;
        }
      }
      attachShadow(_init: { mode: string }) {
        this.shadow = new FakeShadow(this);
        return this.shadow;
      }
      focus() {
        this.focusCalls += 1;
        if (this.shadow) {
          // no-op for host
        }
      }
    }

    class FakeShadow {
      host: FakeEl;
      children: FakeEl[] = [];
      activeElement: FakeEl | null = null;
      listeners = new Map<string, Array<(e: FakeEvent) => void>>();
      innerHTML = "";
      constructor(host: FakeEl) {
        this.host = host;
      }
      append(...nodes: FakeEl[]) {
        this.children.push(...nodes);
      }
      addEventListener(type: string, fn: (e: FakeEvent) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      }
    }

    interface FakeEvent {
      isTrusted: boolean;
      type: string;
      key: string;
      shiftKey: boolean;
      preventDefault(): void;
      stopPropagation(): void;
      composedPath?: () => unknown[];
    }

    const body = new FakeEl("body");
    const docEl = new FakeEl("html");
    docEl.append(body);
    const fakeDocument = {
      documentElement: docEl,
      body,
      createElement: (tag: string) => {
        const el = new FakeEl(tag);
        el.ownerDocument = fakeDocument;
        return el;
      },
      activeElement: null as FakeEl | null,
      addEventListener: vi.fn(),
    };

    const origDocument = globalThis.document;
    (globalThis as unknown as { document: unknown }).document = fakeDocument;

    try {
      const ui = new Fc006Ui();
      ui.init({
        onStart: () => {},
        onStop: () => {},
        onCancel: () => {},
        onDismiss: () => {},
        onContinueDecision: () => {},
      });
      ui.showEvaluating();

      const cancel = ui.getCancelButton() as unknown as FakeEl;
      const stop = ui.getVisibleDialogControls()[1] as unknown as FakeEl;
      expect(cancel).toBeTruthy();
      expect(stop).toBeTruthy();

      const dialogHost = ui
        .getOwnedRoots()
        .hosts.find(
          (h) => (h as unknown as FakeEl).attrs.get("data-futureclick-ui") === "dialog",
        ) as unknown as FakeEl;
      const keyHandlers = dialogHost.shadow?.listeners.get("keydown") ?? [];

      // Hostile deep ancestry on an unrelated focused node must not be walked.
      let parentReads = 0;
      const deep = new FakeEl("div");
      Object.defineProperty(deep, "parentElement", {
        get() {
          parentReads += 1;
          return null;
        },
      });
      Object.defineProperty(deep, "parentNode", {
        get() {
          parentReads += 1;
          return null;
        },
      });
      // Build 1000-wrapper illusion via getters that would explode if climbed.
      let depth = 0;
      const hostile = new FakeEl("span");
      Object.defineProperty(hostile, "parentElement", {
        get() {
          parentReads += 1;
          depth += 1;
          return depth > 1000 ? null : hostile;
        },
      });
      Object.defineProperty(hostile, "parentNode", {
        get() {
          parentReads += 1;
          return hostile;
        },
      });
      if (dialogHost.shadow) {
        dialogHost.shadow.activeElement = hostile;
      }

      for (const h of keyHandlers) {
        h({
          isTrusted: true,
          type: "keydown",
          key: "Tab",
          shiftKey: false,
          preventDefault() {},
          stopPropagation() {},
          composedPath: () => {
            throw new Error("COMPOSED_PATH_MUST_NOT_BE_USED");
          },
        });
      }

      expect(parentReads).toBe(0);
      expect(cancel.focusCalls + stop.focusCalls).toBeGreaterThan(0);

      if (dialogHost.shadow) {
        dialogHost.shadow.activeElement = cancel;
      }
      const stopFocusBefore = stop.focusCalls;
      for (const h of keyHandlers) {
        h({
          isTrusted: true,
          type: "keydown",
          key: "Tab",
          shiftKey: false,
          preventDefault() {},
          stopPropagation() {},
          composedPath: () => {
            throw new Error("COMPOSED_PATH_MUST_NOT_BE_USED");
          },
        });
      }
      expect(stop.focusCalls).toBe(stopFocusBefore + 1);
      expect(parentReads).toBe(0);
    } finally {
      (globalThis as unknown as { document: unknown }).document = origDocument;
    }
  });
});
