/**
 * FC-007 Sprint 3A — VERIFIED consequence preview (ShadowRoot isolated).
 *
 * VERIFIED host: exact private light-DOM DIV inside active native dialog,
 * zero light-DOM children/attributes; UI only in CLOSED ShadowRoot.
 * Continue is decision-bound review UI only — NO arm / execute / release.
 */

import type { ConsequenceAssessment } from "@futureclick/action-schema";
import { nativeFirstChild } from "./native-dom.js";

export type Fc007PreviewMode = "hidden" | "pending" | "verified" | "stopped";

export interface Fc007VerifiedPreviewModel {
  readonly repositoryLabel: string;
  readonly actionLabel: string;
  readonly evidenceLabel: string;
  readonly evidenceNote: string;
  readonly riskLabel: string;
  readonly consequencesLabel: string;
  readonly reversibilityLabel: string;
}

export interface Fc007PreviewCallbacks {
  readonly onCancel: () => void;
  /** Trusted browser-generated Continue click only — no release. */
  readonly onContinue?: (event: MouseEvent) => void;
  readonly isTrustedUiEvent?: (event: Event) => boolean;
}

const STYLE = `
:host {
  all: initial;
  position: absolute !important;
  inset: 0 !important;
  z-index: 2147483646 !important;
  display: block !important;
  box-sizing: border-box !important;
  pointer-events: auto !important;
}
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
.backdrop {
  position: absolute; inset: 0; background: rgba(15, 23, 42, 0.35); z-index: 1;
}
.dialog {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(440px, calc(100% - 32px)); padding: 18px;
  color: #0f172a; background: #ffffff; border: 1px solid #cbd5e1;
  border-radius: 10px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
  z-index: 2;
}
.brand { font-size: 15px; font-weight: 700; margin: 0 0 6px; }
.h1 { font-size: 14px; font-weight: 700; margin: 0 0 10px; }
.body { font-size: 13px; line-height: 1.45; margin: 0 0 10px; color: #334155; }
.kv { display: grid; grid-template-columns: 110px 1fr; gap: 4px 10px; font-size: 13px; margin: 0 0 12px; }
.kv dt { color: #64748b; margin: 0; }
.kv dd { margin: 0; font-weight: 600; }
.note { font-size: 12px; color: #64748b; margin: 0 0 12px; line-height: 1.4; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
button {
  border: 1px solid #94a3b8; background: #f8fafc; color: #0f172a;
  border-radius: 6px; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer;
}
button:focus { outline: 2px solid #2563eb; outline-offset: 2px; }
button.danger { background: #fee2e2; border-color: #fca5a5; }
button.continue { background: #e2e8f0; border-color: #94a3b8; }
button[hidden] { display: none !important; }
`;

const STOPPED_STYLE = `
:host {
  all: initial;
  position: fixed !important;
  top: 12px !important;
  right: 12px !important;
  width: min(360px, calc(100vw - 24px)) !important;
  z-index: 2147483646 !important;
  display: block !important;
  pointer-events: none !important;
}
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
.dialog {
  position: relative; width: 100%; padding: 14px;
  color: #0f172a; background: #ffffff; border: 1px solid #cbd5e1;
  border-radius: 10px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
  pointer-events: auto;
}
.brand { font-size: 15px; font-weight: 700; margin: 0 0 6px; }
.h1 { font-size: 14px; font-weight: 700; margin: 0 0 10px; }
.body { font-size: 13px; line-height: 1.45; margin: 0 0 10px; color: #334155; }
.note { font-size: 12px; color: #64748b; margin: 0 0 12px; line-height: 1.4; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
button {
  border: 1px solid #94a3b8; background: #f8fafc; color: #0f172a;
  border-radius: 6px; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer;
}
button:focus { outline: 2px solid #2563eb; outline-offset: 2px; }
button.danger { background: #fee2e2; border-color: #fca5a5; }
`;

function setText(el: HTMLElement, text: string): void {
  el.textContent = text;
}

export function buildVerifiedPreviewModel(args: {
  readonly ownerDisplay: string;
  readonly repoDisplay: string;
  readonly assessment: ConsequenceAssessment;
}): Fc007VerifiedPreviewModel {
  const csq = args.assessment.consequences[0];
  const riskSeverity = csq?.risk?.severity ?? "unknown";
  const riskCats = (csq?.risk?.categories ?? []).join(", ");
  const riskLabel = riskCats.length > 0 ? `${riskSeverity} (${riskCats})` : String(riskSeverity);
  const evidenceModes = (csq?.evidence ?? []).map((e) => e.mode);
  const hasVerified = evidenceModes.some((m) => m === "verified");
  return {
    repositoryLabel: `${args.ownerDisplay}/${args.repoDisplay}`,
    actionLabel: "Make repository public",
    evidenceLabel: hasVerified ? "VERIFIED" : "UNVERIFIED",
    evidenceNote:
      "Deterministically derived from the validated action and current supported state.",
    riskLabel,
    consequencesLabel: csq?.summary ?? "No consequence summary available.",
    reversibilityLabel: csq?.reversibility?.level ?? "unknown",
  };
}

export class Fc007PreviewUi {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private backdrop: HTMLDivElement | null = null;
  private dialog: HTMLDivElement | null = null;
  private titleEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private extraEl: HTMLElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private continueBtn: HTMLButtonElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private callbacks: Fc007PreviewCallbacks | null = null;
  private mode: Fc007PreviewMode = "hidden";
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private focusBefore: HTMLElement | null = null;
  private mountParent: Element | null = null;
  private hostKind: "modal" | "stopped" | null = null;
  private readonly doc: Document;

  constructor(doc: Document = document) {
    this.doc = doc;
  }

  getMode(): Fc007PreviewMode {
    return this.mode;
  }

  isVisible(): boolean {
    return this.mode === "verified" || this.mode === "stopped";
  }

  getHost(): HTMLDivElement | null {
    return this.host;
  }

  getCancelButtonForTest(): HTMLButtonElement | null {
    return this.cancelBtn;
  }

  /** Exact retained Continue object — identity authority only. */
  getContinueButtonForTest(): HTMLButtonElement | null {
    return this.continueBtn;
  }

  isContinueVisibleForTest(): boolean {
    return (
      this.mode === "verified" &&
      this.continueBtn != null &&
      !this.continueBtn.hidden &&
      !this.continueBtn.disabled
    );
  }

  getShadowActiveElementForTest(): Element | null {
    return this.shadow?.activeElement ?? null;
  }

  getCancelCenterForTest(): {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null {
    if (!this.cancelBtn) return null;
    const r = this.cancelBtn.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  getContinueCenterForTest(): {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null {
    if (!this.continueBtn || this.continueBtn.hidden) return null;
    const r = this.continueBtn.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  hitTestCancelCenterForTest(): boolean {
    if (!this.cancelBtn || !this.shadow) return false;
    const center = this.getCancelCenterForTest();
    if (!center) return false;
    const hit =
      typeof this.shadow.elementFromPoint === "function"
        ? this.shadow.elementFromPoint(center.x, center.y)
        : null;
    if (!hit) return false;
    return hit === this.cancelBtn || this.cancelBtn.contains(hit);
  }

  init(callbacks: Fc007PreviewCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Mount attribute-free host inside active modal BEFORE VERIFIED.
   * UI remains hidden (pending). Closed shadow holds controls.
   */
  mountPendingInDialog(dialog: HTMLDialogElement): HTMLDivElement {
    this.stopKeyHandlerOnly();
    this.ensureModalHost(dialog);
    this.mode = "pending";
    if (this.backdrop) this.backdrop.hidden = true;
    if (this.dialog) this.dialog.hidden = true;
    if (!this.host) throw new Error("FC007_PREVIEW_HOST_MISSING");
    return this.host;
  }

  showVerified(model: Fc007VerifiedPreviewModel, mountParent: Element): void {
    this.ensureModalHost(mountParent);
    if (!this.dialog || !this.titleEl || !this.bodyEl || !this.extraEl || !this.cancelBtn) return;
    this.focusBefore =
      this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : null;
    this.mode = "verified";
    if (this.backdrop) this.backdrop.hidden = false;
    this.dialog.hidden = false;
    this.dialog.style.top = "50%";
    this.dialog.style.left = "50%";
    this.dialog.style.right = "auto";
    this.dialog.style.transform = "translate(-50%, -50%)";
    this.dialog.style.width = "";
    this.dialog.style.pointerEvents = "auto";
    setText(this.titleEl, "Before you continue");
    setText(this.bodyEl, "FutureClick intercepted a supported repository visibility change.");
    this.extraEl.replaceChildren();
    const kv = this.doc.createElement("dl");
    kv.className = "kv";
    const rows: Array<[string, string]> = [
      ["Repository", model.repositoryLabel],
      ["Action", model.actionLabel],
      ["Evidence", model.evidenceLabel],
      ["Risk", model.riskLabel],
      ["Consequences", model.consequencesLabel],
      ["Reversibility", model.reversibilityLabel],
    ];
    for (const [k, v] of rows) {
      const dt = this.doc.createElement("dt");
      setText(dt, k);
      const dd = this.doc.createElement("dd");
      setText(dd, v);
      kv.appendChild(dt);
      kv.appendChild(dd);
    }
    this.extraEl.appendChild(kv);
    const note = this.doc.createElement("p");
    note.className = "note";
    setText(note, model.evidenceNote);
    this.extraEl.appendChild(note);
    this.cancelBtn.hidden = false;
    if (this.continueBtn) {
      this.continueBtn.hidden = false;
      this.continueBtn.disabled = false;
    }
    if (this.closeBtn) this.closeBtn.hidden = false;
    this.installKeyHandler();
    // Default focus remains Cancel — never auto-focus Continue.
    this.cancelBtn.focus();
  }

  /** Hide/inert Continue without dismissing the preview chrome. */
  inertContinue(): void {
    if (!this.continueBtn) return;
    this.continueBtn.hidden = true;
    this.continueBtn.disabled = true;
  }

  showStopped(message: string, _mountParent?: Element | null): void {
    const parent = this.doc.body;
    if (!parent) return;
    this.ensureStoppedHost(parent);
    if (!this.dialog || !this.titleEl || !this.bodyEl || !this.extraEl || !this.cancelBtn) return;
    this.focusBefore =
      this.doc.activeElement instanceof HTMLElement ? this.doc.activeElement : null;
    this.mode = "stopped";
    if (this.backdrop) this.backdrop.hidden = true;
    this.dialog.hidden = false;
    setText(this.titleEl, "Action stopped");
    setText(this.bodyEl, message);
    this.extraEl.replaceChildren();
    const note = this.doc.createElement("p");
    note.className = "note";
    setText(note, "The GitHub action was blocked. FutureClick did not execute the change.");
    this.extraEl.appendChild(note);
    this.cancelBtn.hidden = false;
    if (this.continueBtn) {
      this.continueBtn.hidden = true;
      this.continueBtn.disabled = true;
    }
    if (this.closeBtn) this.closeBtn.hidden = false;
    this.installKeyHandler();
    this.cancelBtn.focus();
  }

  dismiss(): void {
    this.mode = "hidden";
    this.clearKeyHandler();
    if (this.backdrop) this.backdrop.hidden = true;
    if (this.dialog) this.dialog.hidden = true;
    if (this.continueBtn) {
      this.continueBtn.hidden = true;
      this.continueBtn.disabled = true;
    }
    // Remove modal host so page dialog budget returns to pre-mount page count.
    if (this.hostKind === "modal" && this.host) {
      this.host.remove();
      this.host = null;
      this.shadow = null;
      this.backdrop = null;
      this.dialog = null;
      this.titleEl = null;
      this.bodyEl = null;
      this.extraEl = null;
      this.cancelBtn = null;
      this.continueBtn = null;
      this.closeBtn = null;
      this.mountParent = null;
      this.hostKind = null;
    }
    const restore = this.focusBefore;
    this.focusBefore = null;
    if (restore && this.doc.contains(restore)) {
      try {
        restore.focus();
      } catch {
        // ignore
      }
    }
  }

  destroy(): void {
    this.dismiss();
    this.clearKeyHandler();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.backdrop = null;
    this.dialog = null;
    this.titleEl = null;
    this.bodyEl = null;
    this.extraEl = null;
    this.cancelBtn = null;
    this.continueBtn = null;
    this.closeBtn = null;
    this.callbacks = null;
    this.mountParent = null;
    this.hostKind = null;
  }

  private isTrustedUi(event: Event): boolean {
    if (this.callbacks?.isTrustedUiEvent) {
      return this.callbacks.isTrustedUiEvent(event);
    }
    return event.isTrusted === true;
  }

  private ensureModalHost(mountParent: Element): void {
    if (
      this.host &&
      this.shadow &&
      this.hostKind === "modal" &&
      this.mountParent === mountParent &&
      mountParent.contains(this.host) &&
      this.host.attributes.length === 0 &&
      nativeFirstChild(this.host) === null
    ) {
      return;
    }
    this.teardownHost();
    this.mountParent = mountParent;
    this.hostKind = "modal";

    const host = this.doc.createElement("div");
    // Strict contract: zero attributes, zero light-DOM children.
    const shadow = host.attachShadow({ mode: "closed" });
    this.buildShadowTree(shadow, STYLE);
    if (mountParent instanceof HTMLElement) {
      const pos = this.doc.defaultView?.getComputedStyle(mountParent).position;
      if (!pos || pos === "static") {
        mountParent.style.position = "relative";
      }
    }
    // Approved mount: append as last child of the active modal (Chromium).
    // Test environments that break form.nextSibling on append must fix harnesses.
    mountParent.appendChild(host);
    this.host = host;
  }

  private ensureStoppedHost(mountParent: Element): void {
    if (
      this.host &&
      this.shadow &&
      this.hostKind === "stopped" &&
      this.mountParent === mountParent &&
      mountParent.contains(this.host)
    ) {
      return;
    }
    this.teardownHost();
    this.mountParent = mountParent;
    this.hostKind = "stopped";
    const host = this.doc.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    this.buildShadowTree(shadow, STOPPED_STYLE);
    mountParent.appendChild(host);
    this.host = host;
  }

  private teardownHost(): void {
    this.clearKeyHandler();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.backdrop = null;
    this.dialog = null;
    this.titleEl = null;
    this.bodyEl = null;
    this.extraEl = null;
    this.cancelBtn = null;
    this.continueBtn = null;
    this.closeBtn = null;
    this.mountParent = null;
    this.hostKind = null;
  }

  private buildShadowTree(shadow: ShadowRoot, css: string): void {
    const style = this.doc.createElement("style");
    style.textContent = css;
    shadow.appendChild(style);

    const backdrop = this.doc.createElement("div");
    backdrop.className = "backdrop";
    backdrop.hidden = true;
    backdrop.addEventListener("click", (event) => {
      if (!this.isTrustedUi(event)) return;
      if (event.target !== backdrop) return;
      this.callbacks?.onCancel();
    });

    const dialog = this.doc.createElement("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "fc007-preview-title");
    dialog.hidden = true;

    const brand = this.doc.createElement("p");
    brand.className = "brand";
    setText(brand, "FutureClick");

    const title = this.doc.createElement("h1");
    title.className = "h1";
    title.id = "fc007-preview-title";

    const body = this.doc.createElement("p");
    body.className = "body";

    const extra = this.doc.createElement("div");

    const row = this.doc.createElement("div");
    row.className = "row";

    const cancel = this.doc.createElement("button");
    cancel.type = "button";
    cancel.className = "danger";
    setText(cancel, "Cancel");
    cancel.addEventListener("click", (event) => {
      if (!this.isTrustedUi(event)) return;
      if (event.currentTarget !== cancel) return;
      this.callbacks?.onCancel();
    });

    const continueBtn = this.doc.createElement("button");
    continueBtn.type = "button";
    continueBtn.className = "continue";
    continueBtn.hidden = true;
    continueBtn.disabled = true;
    setText(continueBtn, "Continue");
    continueBtn.addEventListener("click", (event) => {
      if (!(event instanceof MouseEvent)) return;
      if (event.type !== "click") return;
      if (!this.isTrustedUi(event)) return;
      if (event.currentTarget !== continueBtn) return;
      if (this.mode !== "verified") return;
      if (continueBtn.hidden || continueBtn.disabled) return;
      this.callbacks?.onContinue?.(event);
    });

    const close = this.doc.createElement("button");
    close.type = "button";
    setText(close, "Close");
    close.addEventListener("click", (event) => {
      if (!this.isTrustedUi(event)) return;
      if (event.currentTarget !== close) return;
      this.callbacks?.onCancel();
    });

    row.appendChild(cancel);
    row.appendChild(continueBtn);
    row.appendChild(close);
    dialog.appendChild(brand);
    dialog.appendChild(title);
    dialog.appendChild(body);
    dialog.appendChild(extra);
    dialog.appendChild(row);
    shadow.appendChild(backdrop);
    shadow.appendChild(dialog);

    this.shadow = shadow;
    this.backdrop = backdrop;
    this.dialog = dialog;
    this.titleEl = title;
    this.bodyEl = body;
    this.extraEl = extra;
    this.cancelBtn = cancel;
    this.continueBtn = continueBtn;
    this.closeBtn = close;
  }

  private installKeyHandler(): void {
    this.clearKeyHandler();
    const handler = (event: KeyboardEvent): void => {
      if (!this.isTrustedUi(event)) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.callbacks?.onCancel();
    };
    this.keyHandler = handler;
    this.doc.addEventListener("keydown", handler, true);
  }

  private stopKeyHandlerOnly(): void {
    this.clearKeyHandler();
  }

  private clearKeyHandler(): void {
    if (this.keyHandler) {
      this.doc.removeEventListener("keydown", this.keyHandler, true);
      this.keyHandler = null;
    }
  }
}
