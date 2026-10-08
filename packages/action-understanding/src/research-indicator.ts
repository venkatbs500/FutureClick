/**
 * FC-008 Sprint 5A — inert research-indicator view model.
 *
 * Plumbing only. This object can be rendered later. It cannot click, submit,
 * release, continue, or emit telemetry. It holds no native event, no form
 * handle, and no browser capability.
 */

import type { Fc008ModelFamily } from "./hypothesis.js";
import type { EpistemicAbstentionReason, UnderstandingResult } from "./result.js";

export const RESEARCH_INDICATOR_RETENTION = "ephemeral-memory-only" as const;

export const CONFIDENCE_BUCKETS = Object.freeze(["none", "low", "medium", "high"] as const);
export type ConfidenceBucket = (typeof CONFIDENCE_BUCKETS)[number];

export interface ResearchIndicatorViewModel {
  readonly predictionAvailable: boolean;
  readonly predictionStatus: UnderstandingResult["outcome"] | "none";
  readonly predictionFamily: Fc008ModelFamily | null;
  readonly confidenceBucket: ConfidenceBucket;
  readonly abstentionReason: EpistemicAbstentionReason | null;
  readonly retentionPolicy: typeof RESEARCH_INDICATOR_RETENTION;
}

function bucketFor(confidence: number | null): ConfidenceBucket {
  if (confidence === null) {
    return "none";
  }
  if (confidence >= 0.8) {
    return "high";
  }
  if (confidence >= 0.5) {
    return "medium";
  }
  return "low";
}

/**
 * Derive an inert indicator from a finished understanding result.
 *
 * Thresholds here are display buckets only. They do not accept, abstain, or
 * release anything.
 */
export function researchIndicatorFromResult(
  result: UnderstandingResult,
): ResearchIndicatorViewModel {
  if (result.outcome === "hypothesis") {
    return Object.freeze({
      predictionAvailable: true,
      predictionStatus: "hypothesis",
      predictionFamily: result.hypothesis.provenance.modelFamily,
      confidenceBucket: bucketFor(result.hypothesis.confidence.calibratedConfidence),
      abstentionReason: null,
      retentionPolicy: RESEARCH_INDICATOR_RETENTION,
    });
  }
  if (result.outcome === "abstained") {
    return Object.freeze({
      predictionAvailable: false,
      predictionStatus: "abstained",
      predictionFamily: result.provenance?.modelFamily ?? null,
      confidenceBucket: "none",
      abstentionReason: result.reason,
      retentionPolicy: RESEARCH_INDICATOR_RETENTION,
    });
  }
  return Object.freeze({
    predictionAvailable: false,
    predictionStatus: "failed",
    predictionFamily: null,
    confidenceBucket: "none",
    abstentionReason: null,
    retentionPolicy: RESEARCH_INDICATOR_RETENTION,
  });
}

export const RESEARCH_INDICATOR_FORBIDDEN_KEYS = Object.freeze([
  "release",
  "click",
  "nativeEvent",
  "formSubmit",
  "browserMutation",
  "continue",
  "approve",
  "telemetry",
] as const);
