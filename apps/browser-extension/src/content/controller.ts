/**
 * Content Script Controller (Sprint FC-005)
 *
 * Epistemological Boundary:
 * Orchestrates event listening, observation capture, adapter evaluation,
 * and ConsequenceEngine derivation for the development browser extension.
 *
 * CRITICAL INVARIANTS:
 * - Begins INACTIVE.
 * - NEVER calls preventDefault(), stopPropagation(), or stopImmediatePropagation().
 * - Does not pause navigation, cancel actions, or replay clicks.
 * - Entirely local; zero network requests or background messaging.
 */

import { BrowserAdapterEngine, type BrowserObservation } from "@futureclick/browser-adapter";
import {
  ConsequenceEngine,
  createDeterministicRuleEvaluator,
} from "@futureclick/consequence-engine";
import { captureButtonObservation, resolveActivationButton } from "./capture.js";
import { DevelopmentIndicator } from "./indicator.js";

/**
 * Optional FC-008 observation sidecar. The controller hands off the already
 * captured detached BrowserObservation and never interprets model policy.
 */
export interface ActionUnderstandingSidecar {
  observe(observation: BrowserObservation): void;
  clear(): void;
}

export class BrowserExtensionController {
  private isObserving = false;
  private sessionEpoch = 0;
  private currentRequestSequence = 0;
  private readonly adapterEngine: BrowserAdapterEngine;
  private readonly consequenceEngine: ConsequenceEngine;
  private readonly indicator: DevelopmentIndicator;
  private readonly actionUnderstanding: ActionUnderstandingSidecar | undefined;

  constructor(
    indicator?: DevelopmentIndicator,
    adapterEngine?: BrowserAdapterEngine,
    consequenceEngine?: ConsequenceEngine,
    actionUnderstanding?: ActionUnderstandingSidecar,
  ) {
    this.indicator = indicator ?? new DevelopmentIndicator();
    try {
      this.adapterEngine = adapterEngine ?? new BrowserAdapterEngine();
    } catch {
      this.adapterEngine = new BrowserAdapterEngine();
    }
    if (consequenceEngine) {
      this.consequenceEngine = consequenceEngine;
    } else {
      this.consequenceEngine = new ConsequenceEngine();
      this.consequenceEngine.registerEvaluator(createDeterministicRuleEvaluator());
    }
    this.actionUnderstanding = actionUnderstanding;
  }

  public init(): void {
    this.indicator.init(
      () => this.start(),
      () => this.stop(),
    );
  }

  public start(): void {
    if (this.isObserving) return;
    this.sessionEpoch++;
    this.currentRequestSequence = 0;
    this.isObserving = true;
    this.actionUnderstanding?.clear();

    // Attach passive capture-phase click listener
    if (typeof window !== "undefined") {
      window.addEventListener("click", this.handleDocumentClick, {
        capture: true,
        passive: true,
      });
    }

    this.indicator.setObserving(true);
  }

  public stop(): void {
    if (!this.isObserving) return;
    this.sessionEpoch++;
    this.isObserving = false;
    this.actionUnderstanding?.clear();

    if (typeof window !== "undefined") {
      window.removeEventListener("click", this.handleDocumentClick, { capture: true });
    }
    this.indicator.setObserving(false);
  }

  public get observing(): boolean {
    return this.isObserving;
  }

  public getSessionEpoch(): number {
    return this.sessionEpoch;
  }

  public getRequestSequence(): number {
    return this.currentRequestSequence;
  }

  /**
   * Synchronous capture-phase event handler.
   * STRICTLY DOES NOT CALL preventDefault(), stopPropagation(), or stopImmediatePropagation().
   */
  public handleDocumentClick = (event: MouseEvent): void => {
    if (!this.isObserving) return;

    // Capture current session epoch and monotonic request sequence (Finding M3)
    const capturedSession = this.sessionEpoch;
    const requestSequence = ++this.currentRequestSequence;

    // 1. Resolve activation target conservatively
    const button = resolveActivationButton(event.target);
    if (!button) {
      return;
    }

    // 2. Synchronous snapshot of allowlisted metadata
    const observation = captureButtonObservation(button, window.location);
    if (!observation) {
      return;
    }

    this.actionUnderstanding?.observe(observation);

    // 3. Central adapter evaluation
    const outcome = this.adapterEngine.adapt(observation);

    if (outcome.status === "unsupported") {
      this.indicator.renderAbstention({
        status: "unsupported",
        title: "Unsupported observation",
        details: "No registered browser adapter applies to this observation.",
      });
      return;
    }

    if (outcome.status === "insufficient-evidence") {
      this.indicator.renderAbstention({
        status: "insufficient-evidence",
        title: "Insufficient evidence",
        details: "Required semantic metadata is missing.",
      });
      return;
    }

    if (outcome.status === "error") {
      this.indicator.renderAbstention({
        status: "error",
        title: "Adaptation error",
        details: "Adapter evaluation failed.",
      });
      return;
    }

    // 4. Outcome is MATCHED -> evaluate via ConsequenceEngine
    const context = outcome.context;
    this.consequenceEngine
      .evaluate(context)
      .then((assessmentResult) => {
        // Enforce session and monotonic sequence ordering (Finding M3)
        if (
          !this.isObserving ||
          this.sessionEpoch !== capturedSession ||
          this.currentRequestSequence !== requestSequence
        ) {
          // Stale evaluation from a previous session or superseded request
          return;
        }

        if (!assessmentResult.ok) {
          this.indicator.renderAbstention({
            status: "error",
            title: "Evaluation error",
            details: "ConsequenceEngine evaluation failed.",
          });
          return;
        }

        const assessment = assessmentResult.value;
        const verifiedConsequences = assessment.consequences.filter((c) =>
          c.evidence.some((e) => e.mode === "verified"),
        );

        if (verifiedConsequences.length === 0) {
          this.indicator.renderAbstention({
            status: "unsupported",
            title: "No consequence derived",
            details: "Zero verified consequences produced by rules engine.",
          });
          return;
        }

        const firstConsequence = verifiedConsequences[0];
        if (!firstConsequence) return;

        const stateChange = firstConsequence.stateChanges?.[0];
        const beforeVal =
          stateChange && stateChange.before.status === "known"
            ? String(stateChange.before.value)
            : undefined;
        const afterVal =
          stateChange && stateChange.after.status === "known"
            ? String(stateChange.after.value)
            : undefined;

        this.indicator.renderVerifiedResult({
          mode: "VERIFIED",
          summary: firstConsequence.summary,
          beforeValue: beforeVal,
          afterValue: afterVal,
          riskSeverity: firstConsequence.risk?.severity,
          reversibility: firstConsequence.reversibility?.level,
        });
      })
      .catch(() => {
        if (
          this.isObserving &&
          this.sessionEpoch === capturedSession &&
          this.currentRequestSequence === requestSequence
        ) {
          this.indicator.renderAbstention({
            status: "error",
            title: "Evaluation error",
            details: "Unexpected failure during consequence derivation.",
          });
        }
      });
  };
}
