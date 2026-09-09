/**
 * Development UI Indicator & Result Display (Sprint FC-005)
 *
 * Epistemological Boundary:
 * Development-only visual indicator demonstrating observation status and derived consequence.
 *
 * Explicit Invariants:
 * - Begins INACTIVE.
 * - Displays clear wording: "FutureClick Dev", "Observation: OFF / ON".
 * - Clearly labels synthetic demonstration:
 *   "Synthetic FutureClick demonstration. No repository is changed. Result is a conditional deduction from fixture metadata."
 * - Displays bounded consequence details or simple abstention statuses.
 * - Stop immediately resets state and clears displayed results.
 */

export interface RenderResultParams {
  readonly mode: string;
  readonly summary: string;
  readonly beforeValue?: string | undefined;
  readonly afterValue?: string | undefined;
  readonly riskSeverity?: string | undefined;
  readonly reversibility?: string | undefined;
}

export interface RenderAbstentionParams {
  readonly status: "unsupported" | "insufficient-evidence" | "error";
  readonly title: string;
  readonly details?: string | undefined;
}

export class DevelopmentIndicator {
  private container: HTMLDivElement | null = null;
  private statusLabel: HTMLSpanElement | null = null;
  private startButton: HTMLButtonElement | null = null;
  private stopButton: HTMLButtonElement | null = null;
  private resultBox: HTMLDivElement | null = null;

  public init(onStart: () => void, onStop: () => void): void {
    if (this.container) return;

    const root = document.createElement("div");
    root.id = "futureclick-dev-indicator";
    root.style.position = "fixed";
    root.style.bottom = "20px";
    root.style.right = "20px";
    root.style.width = "380px";
    root.style.backgroundColor = "#1e1e2e";
    root.style.color = "#cdd6f4";
    root.style.fontFamily = "system-ui, -apple-system, sans-serif";
    root.style.fontSize = "13px";
    root.style.border = "1px solid #45475a";
    root.style.borderRadius = "8px";
    root.style.boxShadow = "0 4px 16px rgba(0,0,0,0.4)";
    root.style.padding = "14px";
    root.style.zIndex = "2147483647";

    // Header
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "10px";

    const title = document.createElement("strong");
    title.textContent = "FutureClick Dev";
    title.style.color = "#89b4fa";
    title.style.fontSize = "14px";

    this.statusLabel = document.createElement("span");
    this.statusLabel.id = "fc-status-label";
    this.statusLabel.textContent = "Observation: OFF";
    this.statusLabel.style.color = "#a6adc8";
    this.statusLabel.style.fontWeight = "bold";

    header.appendChild(title);
    header.appendChild(this.statusLabel);
    root.appendChild(header);

    // Controls
    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "8px";
    controls.style.marginBottom = "12px";

    this.startButton = document.createElement("button");
    this.startButton.type = "button";
    this.startButton.id = "fc-start-btn";
    this.startButton.textContent = "Start";
    this.startButton.style.backgroundColor = "#a6e3a1";
    this.startButton.style.color = "#11111b";
    this.startButton.style.border = "none";
    this.startButton.style.padding = "6px 14px";
    this.startButton.style.borderRadius = "4px";
    this.startButton.style.cursor = "pointer";
    this.startButton.style.fontWeight = "bold";
    this.startButton.onclick = onStart;

    this.stopButton = document.createElement("button");
    this.stopButton.type = "button";
    this.stopButton.id = "fc-stop-btn";
    this.stopButton.textContent = "Stop";
    this.stopButton.style.backgroundColor = "#f38ba8";
    this.stopButton.style.color = "#11111b";
    this.stopButton.style.border = "none";
    this.stopButton.style.padding = "6px 14px";
    this.stopButton.style.borderRadius = "4px";
    this.stopButton.style.cursor = "pointer";
    this.stopButton.style.fontWeight = "bold";
    this.stopButton.disabled = true;
    this.stopButton.style.opacity = "0.5";
    this.stopButton.onclick = onStop;

    controls.appendChild(this.startButton);
    controls.appendChild(this.stopButton);
    root.appendChild(controls);

    // Results container
    this.resultBox = document.createElement("div");
    this.resultBox.id = "fc-result-container";
    this.resultBox.style.display = "none";
    this.resultBox.style.borderTop = "1px solid #313244";
    this.resultBox.style.paddingTop = "10px";
    root.appendChild(this.resultBox);

    document.body.appendChild(root);
    this.container = root;
  }

  public setObserving(active: boolean): void {
    if (this.statusLabel) {
      this.statusLabel.textContent = active ? "Observation: ON" : "Observation: OFF";
      this.statusLabel.style.color = active ? "#a6e3a1" : "#a6adc8";
    }
    if (this.startButton) {
      this.startButton.disabled = active;
      this.startButton.style.opacity = active ? "0.5" : "1.0";
    }
    if (this.stopButton) {
      this.stopButton.disabled = !active;
      this.stopButton.style.opacity = !active ? "0.5" : "1.0";
    }
    if (!active) {
      this.clearResult();
    }
  }

  public renderVerifiedResult(params: RenderResultParams): void {
    if (!this.resultBox) return;

    this.resultBox.innerHTML = "";
    this.resultBox.style.display = "block";

    const banner = document.createElement("div");
    banner.style.backgroundColor = "#313244";
    banner.style.padding = "8px";
    banner.style.borderRadius = "4px";
    banner.style.marginBottom = "8px";
    banner.style.fontSize = "11px";
    banner.style.color = "#fab387";
    banner.textContent =
      "Synthetic FutureClick demonstration. No repository is changed. Result is a conditional deduction from fixture metadata.";

    const badge = document.createElement("div");
    badge.style.display = "inline-block";
    badge.style.backgroundColor = "#a6e3a1";
    badge.style.color = "#11111b";
    badge.style.fontWeight = "bold";
    badge.style.padding = "2px 8px";
    badge.style.borderRadius = "3px";
    badge.style.marginBottom = "6px";
    badge.textContent = params.mode.toUpperCase();

    const summary = document.createElement("div");
    summary.style.fontWeight = "bold";
    summary.style.marginBottom = "4px";
    summary.textContent =
      'Repository "Synthetic Repository" visibility will change from private to public.';

    const transition = document.createElement("div");
    transition.style.color = "#cdd6f4";
    transition.style.marginBottom = "4px";
    transition.textContent = "Repository visibility: private → public";

    const risk = document.createElement("div");
    risk.style.color = "#f38ba8";
    risk.style.fontSize = "12px";
    risk.textContent = `Risk severity: ${params.riskSeverity ?? "high"}`;

    const rev = document.createElement("div");
    rev.style.color = "#f9e2af";
    rev.style.fontSize = "12px";
    rev.textContent = `Reversibility: ${params.reversibility ?? "partially_reversible"}`;

    this.resultBox.appendChild(banner);
    this.resultBox.appendChild(badge);
    this.resultBox.appendChild(summary);
    this.resultBox.appendChild(transition);
    this.resultBox.appendChild(risk);
    this.resultBox.appendChild(rev);
  }

  public renderAbstention(params: RenderAbstentionParams): void {
    if (!this.resultBox) return;

    this.resultBox.innerHTML = "";
    this.resultBox.style.display = "block";

    const badge = document.createElement("div");
    badge.style.display = "inline-block";
    badge.style.backgroundColor = params.status === "error" ? "#f38ba8" : "#f9e2af";
    badge.style.color = "#11111b";
    badge.style.fontWeight = "bold";
    badge.style.padding = "2px 8px";
    badge.style.borderRadius = "3px";
    badge.style.marginBottom = "6px";
    badge.textContent = params.title;

    const note = document.createElement("div");
    note.style.color = "#a6adc8";
    note.style.fontSize = "12px";
    note.textContent = params.details ?? "No canonical consequence derived.";

    this.resultBox.appendChild(badge);
    this.resultBox.appendChild(note);
  }

  public clearResult(): void {
    if (this.resultBox) {
      this.resultBox.innerHTML = "";
      this.resultBox.style.display = "none";
    }
  }

  public destroy(): void {
    if (this.container?.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.statusLabel = null;
    this.startButton = null;
    this.stopButton = null;
    this.resultBox = null;
  }
}
