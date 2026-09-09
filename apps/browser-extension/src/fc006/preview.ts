/**
 * FC-006 Owned UI Surfaces (Sprint 3)
 *
 * Epistemological Boundary:
 * Extension-local Start/Stop indicator and evaluating/preview/abstention/stale
 * dialogs inside dedicated ShadowRoots. Exact host/root/control references are
 * the only ownership identity. data-futureclick-ui has ZERO authority.
 *
 * Sprint 3: trusted Continue control exists only in preview-ready.
 * Authorization for release is controller-private — not UI text/class/host.
 */

import type { ContinueDecisionToken } from "./decision-token.js";

export interface Fc006PreviewModel {
  readonly riskLabel: string;
  readonly beforeLabel: string;
  readonly afterLabel: string;
  readonly evidenceLabel: string;
  readonly categories: readonly string[];
  readonly reversibilityLabel: string;
  readonly engineSummary: string;
  readonly fixedExplanation: string;
  readonly syntheticDisclaimer: string;
}

export interface Fc006UiCallbacks {
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onCancel: () => void;
  readonly onDismiss: () => void;
  /** Decision-specific Continue — receives the immutable token for that preview. */
  readonly onContinueDecision: (token: ContinueDecisionToken) => void;
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
.panel {
  position: fixed;
  z-index: 2147483646;
  color: #0f172a;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
}
.indicator {
  bottom: 20px;
  right: 20px;
  width: 260px;
  padding: 14px;
}
.dialog {
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(440px, calc(100vw - 32px));
  padding: 18px;
}
.brand { font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 6px; }
.status { font-size: 13px; font-weight: 600; margin: 0 0 12px; }
.status.on { color: #15803d; }
.status.off { color: #64748b; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
button {
  border: 1px solid #94a3b8;
  background: #f8fafc;
  color: #0f172a;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
button.primary { background: #e2e8f0; }
button.danger { background: #fee2e2; border-color: #fca5a5; }
button.continue { background: #dbeafe; border-color: #93c5fd; }
button:focus { outline: 2px solid #2563eb; outline-offset: 2px; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
.h1 { font-size: 14px; font-weight: 700; margin: 0 0 8px; }
.body { font-size: 13px; line-height: 1.45; margin: 0 0 10px; color: #334155; }
.risk { display: inline-block; background: #fecaca; color: #7f1d1d; font-weight: 700; font-size: 12px; padding: 2px 8px; border-radius: 4px; margin-bottom: 10px; }
.kv { display: grid; grid-template-columns: 88px 1fr; gap: 4px 10px; font-size: 13px; margin: 0 0 12px; }
.kv dt { color: #64748b; margin: 0; }
.kv dd { margin: 0; font-weight: 600; }
.note { font-size: 12px; color: #64748b; margin: 0 0 12px; line-height: 1.4; }
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  z-index: 2147483645;
}
`;

function applyTrustedClick(button: HTMLButtonElement, handler: () => void): void {
  button.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    handler();
  });
}

export class Fc006Ui {
  private indicatorHost: HTMLDivElement | null = null;
  private indicatorShadow: ShadowRoot | null = null;
  private dialogHost: HTMLDivElement | null = null;
  private dialogShadow: ShadowRoot | null = null;
  private backdropHost: HTMLDivElement | null = null;

  private statusEl: HTMLElement | null = null;
  private startBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;

  private dialogTitleEl: HTMLElement | null = null;
  private dialogBodyEl: HTMLElement | null = null;
  private dialogExtraEl: HTMLElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private continueBtn: HTMLButtonElement | null = null;
  private stopDialogBtn: HTMLButtonElement | null = null;
  private dismissBtn: HTMLButtonElement | null = null;
  private continueDecisionListener: ((event: Event) => void) | null = null;
  private boundContinueToken: ContinueDecisionToken | null = null;

  private callbacks: Fc006UiCallbacks | null = null;
  private focusBeforeDialog: HTMLElement | null = null;
  private dialogMode: "hidden" | "evaluating" | "preview" | "abstention" | "stale" | "continuing" =
    "hidden";
  private initialized = false;
  private readyQueued = false;

  public init(callbacks: Fc006UiCallbacks): void {
    this.callbacks = callbacks;
    this.ensureHostsWhenReady();
  }

  public getOwnedRoots(): {
    hosts: Element[];
    shadowRoots: ShadowRoot[];
  } {
    const hosts: Element[] = [];
    const shadowRoots: ShadowRoot[] = [];
    if (this.indicatorHost) hosts.push(this.indicatorHost);
    if (this.dialogHost) hosts.push(this.dialogHost);
    if (this.backdropHost) hosts.push(this.backdropHost);
    if (this.indicatorShadow) shadowRoots.push(this.indicatorShadow);
    if (this.dialogShadow) shadowRoots.push(this.dialogShadow);
    return { hosts, shadowRoots };
  }

  /**
   * Exact FutureClick-created interactive controls.
   * Ownership is identity-based; host containment alone is not authority.
   */
  public getOwnedControls(): Element[] {
    const controls: Element[] = [];
    if (this.startBtn) controls.push(this.startBtn);
    if (this.stopBtn) controls.push(this.stopBtn);
    if (this.cancelBtn) controls.push(this.cancelBtn);
    if (this.continueBtn) controls.push(this.continueBtn);
    if (this.dismissBtn) controls.push(this.dismissBtn);
    if (this.stopDialogBtn) controls.push(this.stopDialogBtn);
    return controls;
  }

  public setActive(active: boolean): void {
    this.ensureHostsWhenReady();
    if (this.statusEl) {
      this.statusEl.textContent = active ? "ON" : "OFF";
      this.statusEl.className = active ? "status on" : "status off";
    }
    if (this.startBtn) {
      this.startBtn.disabled = active;
      this.startBtn.hidden = active;
    }
    if (this.stopBtn) {
      this.stopBtn.disabled = !active;
      this.stopBtn.hidden = !active;
    }
    if (!active) {
      this.clearDialog();
    }
  }

  public showEvaluating(): void {
    this.unbindContinueDecision();
    this.openDialogShell("evaluating");
    if (!this.dialogTitleEl || !this.dialogBodyEl || !this.dialogExtraEl) return;
    this.dialogTitleEl.textContent = "FutureClick";
    this.dialogBodyEl.textContent = "Evaluating consequences…\n\nAction has not been executed.";
    this.dialogExtraEl.replaceChildren();
    this.setDialogControls({ cancel: true, continue: false, stop: true, dismiss: false });
    this.focusControl(this.cancelBtn);
  }

  public showPreview(model: Fc006PreviewModel, decisionToken: ContinueDecisionToken): void {
    this.openDialogShell("preview");
    if (!this.dialogTitleEl || !this.dialogBodyEl || !this.dialogExtraEl) return;

    // Fresh Continue control per preview so retained old nodes cannot keep authority.
    this.replaceContinueControl();

    this.dialogTitleEl.textContent = "FutureClick";
    this.dialogBodyEl.textContent = "";

    const risk = document.createElement("div");
    risk.className = "risk";
    risk.textContent = model.riskLabel;

    const heading = document.createElement("p");
    heading.className = "h1";
    heading.textContent = "Repository visibility";

    const dl = document.createElement("dl");
    dl.className = "kv";
    const rows: Array<[string, string]> = [
      ["BEFORE", model.beforeLabel],
      ["AFTER", model.afterLabel],
      ["Evidence", model.evidenceLabel],
      ["Risk categories", model.categories.join(", ")],
      ["Reversibility", model.reversibilityLabel],
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.append(dt, dd);
    }

    const summary = document.createElement("p");
    summary.className = "body";
    summary.textContent = `Engine summary:\n${model.engineSummary}`;

    const explanation = document.createElement("p");
    explanation.className = "body";
    explanation.textContent = model.fixedExplanation;

    const disclaimer = document.createElement("p");
    disclaimer.className = "note";
    disclaimer.textContent = model.syntheticDisclaimer;

    this.dialogExtraEl.replaceChildren(risk, heading, dl, summary, explanation, disclaimer);
    this.setDialogControls({ cancel: true, continue: true, stop: true, dismiss: false });
    this.bindContinueDecision(decisionToken);
    this.focusControl(this.cancelBtn);
  }

  public showAbstention(): void {
    this.unbindContinueDecision();
    this.openDialogShell("abstention");
    if (!this.dialogTitleEl || !this.dialogBodyEl || !this.dialogExtraEl) return;
    this.dialogTitleEl.textContent = "FutureClick";
    this.dialogBodyEl.textContent =
      "FutureClick could not verify this action.\n\nAction was not executed.";
    this.dialogExtraEl.replaceChildren();
    this.setDialogControls({ cancel: false, continue: false, stop: true, dismiss: true });
    this.focusControl(this.dismissBtn);
  }

  public showStale(): void {
    this.replaceContinueControl();
    this.openDialogShell("stale");
    if (!this.dialogTitleEl || !this.dialogBodyEl || !this.dialogExtraEl) return;
    this.dialogTitleEl.textContent = "FutureClick";
    this.dialogBodyEl.textContent = "";
    this.dialogExtraEl.replaceChildren();
    const heading = document.createElement("p");
    heading.className = "h1";
    heading.textContent = FC006_STALE_COPY.heading;
    const body = document.createElement("p");
    body.className = "body";
    body.style.whiteSpace = "pre-wrap";
    body.textContent = FC006_STALE_COPY.body;
    this.dialogExtraEl.append(heading, body);
    this.setDialogControls({ cancel: false, continue: false, stop: true, dismiss: true });
    this.focusControl(this.dismissBtn);
  }

  /**
   * Disable decision controls and clear preview content as Continue preflight.
   * Must run BEFORE final release revalidation (page disconnectedCallback may fire).
   * After this returns, Continue must not perform further UI/DOM work before arm.
   */
  public beginContinuing(): void {
    this.dialogMode = "continuing";
    this.unbindContinueDecision();
    if (this.continueBtn) {
      this.continueBtn.disabled = true;
      this.continueBtn.hidden = true;
    }
    if (this.cancelBtn) {
      this.cancelBtn.disabled = true;
      this.cancelBtn.hidden = true;
    }
    if (this.dismissBtn) {
      this.dismissBtn.hidden = true;
    }
    // Clear preview content here (pre-final-validation) so any page-inserted
    // custom-element disconnectedCallback mutates page state BEFORE revalidation.
    if (this.dialogExtraEl) {
      this.dialogExtraEl.replaceChildren();
    }
    if (this.dialogBodyEl) {
      this.dialogBodyEl.textContent = "Continuing approved action…";
    }
  }

  public clearDialog(): void {
    this.replaceContinueControl();
    this.dialogMode = "hidden";
    if (this.continueBtn) {
      this.continueBtn.disabled = false;
    }
    if (this.cancelBtn) {
      this.cancelBtn.disabled = false;
    }
    if (this.dialogHost) {
      this.dialogHost.style.display = "none";
    }
    if (this.backdropHost) {
      this.backdropHost.style.display = "none";
    }
    this.restoreFocus();
  }

  public getDialogMode():
    | "hidden"
    | "evaluating"
    | "preview"
    | "abstention"
    | "stale"
    | "continuing" {
    return this.dialogMode;
  }

  /** Testing / accessibility seam: primary action buttons currently visible. */
  public getVisibleDialogControls(): HTMLButtonElement[] {
    const out: HTMLButtonElement[] = [];
    if (this.cancelBtn && !this.cancelBtn.hidden) out.push(this.cancelBtn);
    if (this.continueBtn && !this.continueBtn.hidden) out.push(this.continueBtn);
    if (this.dismissBtn && !this.dismissBtn.hidden) out.push(this.dismissBtn);
    if (this.stopDialogBtn && !this.stopDialogBtn.hidden) out.push(this.stopDialogBtn);
    return out;
  }

  public getStartButton(): HTMLButtonElement | null {
    return this.startBtn;
  }

  public getStopButton(): HTMLButtonElement | null {
    return this.stopBtn;
  }

  public getCancelButton(): HTMLButtonElement | null {
    return this.cancelBtn;
  }

  public getContinueButton(): HTMLButtonElement | null {
    return this.continueBtn;
  }

  /** Test seam: currently bound Continue decision token, if any. */
  public getBoundContinueToken(): ContinueDecisionToken | null {
    return this.boundContinueToken;
  }

  /** Test seam: dialog content region (open ShadowRoot — page may insert nodes). */
  public getDialogExtraElement(): HTMLElement | null {
    return this.dialogExtraEl;
  }

  public getDismissButton(): HTMLButtonElement | null {
    return this.dismissBtn;
  }

  public getDialogTitleId(): string {
    return "fc006-dialog-title";
  }

  public getDialogDescId(): string {
    return "fc006-dialog-desc";
  }

  private ensureHostsWhenReady(): void {
    if (this.initialized) return;
    if (typeof document === "undefined") return;

    if (document.documentElement) {
      this.mount();
      return;
    }

    if (this.readyQueued) return;
    this.readyQueued = true;

    const tryMount = () => {
      if (this.initialized) return;
      if (document.documentElement) {
        this.mount();
      }
    };

    document.addEventListener("DOMContentLoaded", tryMount, { once: true });
    document.addEventListener("readystatechange", tryMount, { once: true });
  }

  private mount(): void {
    if (this.initialized || !this.callbacks || !document.documentElement) return;

    const callbacks = this.callbacks;

    this.indicatorHost = document.createElement("div");
    this.indicatorHost.setAttribute("data-futureclick-ui", "indicator");
    this.indicatorShadow = this.indicatorHost.attachShadow({ mode: "open" });
    this.indicatorShadow.innerHTML = `<style>${STYLE}</style>`;

    const indicator = document.createElement("div");
    indicator.className = "panel indicator";
    const brand = document.createElement("p");
    brand.className = "brand";
    brand.textContent = "FutureClick";
    this.statusEl = document.createElement("p");
    this.statusEl.className = "status off";
    this.statusEl.textContent = "OFF";

    const row = document.createElement("div");
    row.className = "row";
    this.startBtn = document.createElement("button");
    this.startBtn.type = "button";
    this.startBtn.textContent = "Start";
    this.startBtn.className = "primary";
    applyTrustedClick(this.startBtn, () => callbacks.onStart());

    this.stopBtn = document.createElement("button");
    this.stopBtn.type = "button";
    this.stopBtn.textContent = "Stop";
    this.stopBtn.className = "danger";
    this.stopBtn.hidden = true;
    applyTrustedClick(this.stopBtn, () => callbacks.onStop());

    row.append(this.startBtn, this.stopBtn);
    indicator.append(brand, this.statusEl, row);
    this.indicatorShadow.append(indicator);

    this.backdropHost = document.createElement("div");
    this.backdropHost.setAttribute("data-futureclick-ui", "backdrop");
    this.backdropHost.style.display = "none";
    const backdropShadow = this.backdropHost.attachShadow({ mode: "open" });
    backdropShadow.innerHTML = `<style>${STYLE}</style><div class="backdrop" part="backdrop"></div>`;

    this.dialogHost = document.createElement("div");
    this.dialogHost.setAttribute("data-futureclick-ui", "dialog");
    this.dialogHost.style.display = "none";
    this.dialogShadow = this.dialogHost.attachShadow({ mode: "open" });
    this.dialogShadow.innerHTML = `<style>${STYLE}</style>`;

    const dialog = document.createElement("div");
    dialog.className = "panel dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", this.getDialogTitleId());
    dialog.setAttribute("aria-describedby", this.getDialogDescId());

    this.dialogTitleEl = document.createElement("p");
    this.dialogTitleEl.className = "brand";
    this.dialogTitleEl.id = this.getDialogTitleId();

    this.dialogBodyEl = document.createElement("p");
    this.dialogBodyEl.className = "body";
    this.dialogBodyEl.id = this.getDialogDescId();
    this.dialogBodyEl.style.whiteSpace = "pre-wrap";

    this.dialogExtraEl = document.createElement("div");

    const controls = document.createElement("div");
    controls.className = "row";

    this.cancelBtn = document.createElement("button");
    this.cancelBtn.type = "button";
    this.cancelBtn.textContent = "Cancel";
    this.cancelBtn.className = "primary";
    applyTrustedClick(this.cancelBtn, () => callbacks.onCancel());

    this.continueBtn = document.createElement("button");
    this.continueBtn.type = "button";
    this.continueBtn.textContent = "Continue";
    this.continueBtn.className = "continue";
    this.continueBtn.hidden = true;
    // Continue is bound per-preview via bindContinueDecision (decision token).

    this.dismissBtn = document.createElement("button");
    this.dismissBtn.type = "button";
    this.dismissBtn.textContent = "Dismiss";
    this.dismissBtn.className = "primary";
    this.dismissBtn.hidden = true;
    applyTrustedClick(this.dismissBtn, () => callbacks.onDismiss());

    this.stopDialogBtn = document.createElement("button");
    this.stopDialogBtn.type = "button";
    this.stopDialogBtn.textContent = "Stop FutureClick";
    this.stopDialogBtn.className = "danger";
    applyTrustedClick(this.stopDialogBtn, () => callbacks.onStop());

    controls.append(this.cancelBtn, this.continueBtn, this.dismissBtn, this.stopDialogBtn);
    dialog.append(this.dialogTitleEl, this.dialogBodyEl, this.dialogExtraEl, controls);
    this.dialogShadow.append(dialog);

    this.dialogShadow.addEventListener("keydown", (event) => {
      this.handleDialogKeydown(event as KeyboardEvent);
    });

    const parent = document.body ?? document.documentElement;
    parent.append(this.indicatorHost, this.backdropHost, this.dialogHost);
    this.initialized = true;
  }

  private openDialogShell(
    mode: "evaluating" | "preview" | "abstention" | "stale" | "continuing",
  ): void {
    this.ensureHostsWhenReady();
    if (!this.dialogHost || !this.backdropHost) return;
    if (this.dialogMode === "hidden") {
      const active = document.activeElement;
      const isHtml = typeof HTMLElement !== "undefined" && active instanceof HTMLElement;
      this.focusBeforeDialog =
        isHtml && !this.isExactOwnedFocus(active as HTMLElement) ? (active as HTMLElement) : null;
    }
    this.dialogMode = mode;
    this.backdropHost.style.display = "block";
    this.dialogHost.style.display = "block";
  }

  private setDialogControls(flags: {
    cancel: boolean;
    continue: boolean;
    stop: boolean;
    dismiss: boolean;
  }): void {
    if (this.cancelBtn) {
      this.cancelBtn.hidden = !flags.cancel;
      this.cancelBtn.disabled = false;
    }
    if (this.continueBtn) {
      this.continueBtn.hidden = !flags.continue;
      this.continueBtn.disabled = !flags.continue;
    }
    if (this.stopDialogBtn) this.stopDialogBtn.hidden = !flags.stop;
    if (this.dismissBtn) this.dismissBtn.hidden = !flags.dismiss;
  }

  private bindContinueDecision(token: ContinueDecisionToken): void {
    this.unbindContinueDecision();
    if (!this.continueBtn || !this.callbacks) return;
    const callbacks = this.callbacks;
    const frozenToken = token;
    const listener = (event: Event): void => {
      if (!("isTrusted" in event) || event.isTrusted !== true) {
        return;
      }
      callbacks.onContinueDecision(frozenToken);
    };
    this.continueBtn.addEventListener("click", listener);
    this.continueDecisionListener = listener;
    this.boundContinueToken = frozenToken;
  }

  private unbindContinueDecision(): void {
    if (this.continueBtn && this.continueDecisionListener) {
      this.continueBtn.removeEventListener("click", this.continueDecisionListener);
    }
    this.continueDecisionListener = null;
    this.boundContinueToken = null;
  }

  /**
   * Replace the Continue control node so a retained prior Continue DOM reference
   * cannot keep a live listener after teardown / new preview.
   */
  private replaceContinueControl(): void {
    this.unbindContinueDecision();
    const old = this.continueBtn;
    if (typeof document === "undefined") {
      this.continueBtn = null;
      return;
    }
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Continue";
    next.className = "continue";
    next.hidden = true;
    next.disabled = false;
    if (old?.parentElement) {
      old.parentElement.replaceChild(next, old);
    }
    this.continueBtn = next;
  }

  private focusControl(button: HTMLButtonElement | null): void {
    if (!button || button.hidden) return;
    try {
      button.focus();
    } catch {
      // ignore focus failures in incomplete test DOM
    }
  }

  private restoreFocus(): void {
    const target = this.focusBeforeDialog;
    this.focusBeforeDialog = null;
    if (target?.isConnected && target.ownerDocument === document) {
      try {
        target.focus();
        return;
      } catch {
        // fall through
      }
    }
    const safe = this.startBtn ?? this.stopBtn;
    if (safe) {
      try {
        safe.focus();
      } catch {
        // ignore
      }
    }
  }

  /**
   * Exact-identity focus check only (no parentNode / composedPath walk).
   * Compares document/shadow active elements against known owned controls.
   */
  private isExactOwnedFocus(el: Element): boolean {
    for (const control of this.getOwnedControls()) {
      if (control === el) {
        return true;
      }
    }
    if (this.dialogShadow?.activeElement === el) {
      return true;
    }
    if (this.indicatorShadow?.activeElement === el) {
      return true;
    }
    return false;
  }

  private handleDialogKeydown(event: KeyboardEvent): void {
    if (!event.isTrusted) return;
    if (this.dialogMode === "hidden" || this.dialogMode === "continuing") return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (this.dialogMode === "abstention" || this.dialogMode === "stale") {
        this.callbacks?.onDismiss();
      } else {
        this.callbacks?.onCancel();
      }
      return;
    }

    if (event.key !== "Tab") return;

    const focusables = this.getVisibleDialogControls();
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;

    const active = this.dialogShadow?.activeElement ?? null;
    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey) {
      if (active === first || !active) {
        last.focus();
      } else {
        const idx = focusables.indexOf(active as HTMLButtonElement);
        const prev = focusables[idx - 1] ?? last;
        prev.focus();
      }
    } else if (active === last || !active) {
      first.focus();
    } else {
      const idx = focusables.indexOf(active as HTMLButtonElement);
      const next = focusables[idx + 1] ?? first;
      next.focus();
    }
  }
}

/** Fixed trusted FutureClick preview copy (never from raw DOM / draft). */
export const FC006_PREVIEW_COPY = Object.freeze({
  riskLabel: "HIGH RISK",
  beforeLabel: "Private",
  afterLabel: "Public",
  evidenceLabel: "VERIFIED",
  categories: Object.freeze(["Security", "Privacy"] as const),
  reversibilityLabel: "Partially reversible",
  fixedExplanation: "Making a repository public can expose its contents to others.",
  syntheticDisclaimer:
    "Synthetic FutureClick demonstration. No real repository is being changed. VERIFIED means a deterministic deduction from the validated represented state and proposed action within the stated assumptions.",
});

/** Fixed stale copy — never includes raw failure reasons or secrets. */
export const FC006_STALE_COPY = Object.freeze({
  heading: "ACTION CHANGED",
  body: "FutureClick can no longer verify that this is the same action you reviewed.\n\nThe action was not executed.",
});
