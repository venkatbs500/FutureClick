/**
 * FC-009 Sprint 1 — hybrid evidence contracts.
 *
 * VERIFIED and PREDICTED remain distinct evidence modes. Confidence is
 * modality-specific. Agreement never promotes a prediction. The result is a
 * view: it has no execution method and no ActionGraph mutation.
 */

import type {
  EpistemicAbstentionReason,
  OperationalFailureCode,
} from "@futureclick/action-understanding";
import type { Fc009HybridPolicyVersion, Fc009SchemaVersion } from "./policy.js";
import type { HybridReasonCode } from "./reasons.js";

export const HYBRID_EVIDENCE_MODES = Object.freeze(["verified", "predicted"] as const);
export type HybridEvidenceMode = (typeof HYBRID_EVIDENCE_MODES)[number];

export const HYBRID_RELATIONSHIPS = Object.freeze([
  "AGREES",
  "CONFLICTS",
  "PREDICTION_ONLY",
  "VERIFIED_ONLY",
  "INCOMPARABLE",
  "ABSTAINED_PREDICTION",
  "PREDICTION_FAILED",
  "VERIFIED_CONFLICT",
  "PREDICTION_STALE",
] as const);
export type HybridRelationship = (typeof HYBRID_RELATIONSHIPS)[number];

export const HYBRID_VALUE_STATUSES = Object.freeze(["known", "absent", "unknown"] as const);
export type HybridValueStatus = (typeof HYBRID_VALUE_STATUSES)[number];

export const HYBRID_VERIFIED_SOURCES = Object.freeze([
  "rule",
  "engine",
  "adapter",
  "system",
] as const);
export type HybridVerifiedSource = (typeof HYBRID_VERIFIED_SOURCES)[number];

export const HYBRID_ASSUMPTION_STATUSES = Object.freeze([
  "assumed",
  "verified",
  "violated",
  "unknown",
] as const);
export type HybridAssumptionStatus = (typeof HYBRID_ASSUMPTION_STATUSES)[number];

export const HYBRID_PREDICTION_STATUSES = Object.freeze([
  "absent",
  "hypothesis",
  "abstained",
  "failed",
  "stale",
] as const);
export type HybridPredictionStatus = (typeof HYBRID_PREDICTION_STATUSES)[number];

export const HYBRID_AUTHORITATIVE_BASES = Object.freeze([
  "verified",
  "none",
  "verified-conflict",
] as const);
export type HybridAuthoritativeBasis = (typeof HYBRID_AUTHORITATIVE_BASES)[number];

export type HybridKnownValue = string | number | boolean;

export type HybridValueState =
  | { readonly status: "known"; readonly value: HybridKnownValue }
  | { readonly status: "absent" }
  | { readonly status: "unknown" };

/**
 * Canonical semantic claim identity.
 *
 * Built only from property + before + after. Not from selectors, site identity,
 * hostname, URL, fixture id, private object names, UI labels, or timestamps.
 */
export interface CanonicalClaimIdentity {
  readonly property: string;
  readonly before: string;
  readonly after: string;
}

export interface HybridFreshnessIdentity {
  readonly actionFingerprint: string;
}

export interface HybridAssumption {
  readonly id: string;
  readonly statement: string;
  readonly status: HybridAssumptionStatus;
}

export interface HybridVerifiedProvenance {
  readonly source: HybridVerifiedSource;
  readonly ruleId: string | null;
  readonly engineVersion: string | null;
}

export interface HybridPredictedProvenance {
  readonly source: "model";
  readonly modelFamily: string;
  readonly modelVersion: string;
  readonly artifactSha256: string;
  readonly supportMatrixVersion: string;
}

export interface HybridPredictedSupport {
  readonly supportedTupleResolved: boolean;
  readonly featureCoverage: number;
  readonly supportedObjectEvidence: boolean;
}

/**
 * Caller-owned verified claim.
 *
 * `scope` and `assumption.statement` are trusted already-sanitized canonical
 * evidence. FC-009 validates closed shape and bounds only. It does not sanitize
 * raw browser, page, or DOM text.
 */
export interface VerifiedClaimInput {
  readonly property: string;
  readonly before: HybridValueState;
  readonly after: HybridValueState;
  readonly scope: string | null;
  readonly assumptions: readonly HybridAssumption[];
  readonly provenance: HybridVerifiedProvenance;
  readonly freshness: HybridFreshnessIdentity;
}

export interface AdaptedAlternative {
  readonly identity: CanonicalClaimIdentity;
  readonly calibratedConfidence: number;
  readonly role: "uncertainty";
}

export type AdaptedPrediction =
  | {
      readonly status: "hypothesis";
      readonly identity: CanonicalClaimIdentity;
      readonly calibratedConfidence: number;
      readonly alternatives: readonly AdaptedAlternative[];
      readonly freshness: HybridFreshnessIdentity;
      readonly provenance: HybridPredictedProvenance;
      readonly support: HybridPredictedSupport;
    }
  | {
      readonly status: "abstained";
      readonly reason: EpistemicAbstentionReason;
      readonly freshness: HybridFreshnessIdentity | null;
      readonly provenance: HybridPredictedProvenance | null;
      readonly support: HybridPredictedSupport | null;
    }
  | {
      readonly status: "failed";
      readonly code: OperationalFailureCode;
      readonly stage: string;
      readonly failureReason: string;
    };

export interface HybridEvidenceInput {
  readonly schemaVersion: Fc009SchemaVersion;
  readonly policyVersion: Fc009HybridPolicyVersion;
  readonly identity: HybridFreshnessIdentity;
  readonly verifiedClaims: readonly VerifiedClaimInput[];
  readonly prediction: AdaptedPrediction | null;
}

export interface HybridClaim {
  readonly evidenceMode: HybridEvidenceMode;
  readonly identity: CanonicalClaimIdentity;
  readonly confidence: number | null;
  readonly scope: string | null;
  readonly assumptions: readonly HybridAssumption[];
  readonly provenance: HybridVerifiedProvenance | HybridPredictedProvenance;
  readonly freshness: HybridFreshnessIdentity;
  readonly current: boolean;
}

/**
 * One side of a hybrid relationship. Modes are explicit so VERIFIED↔VERIFIED
 * pairs are not forced through a predictedIdentity field.
 */
export interface HybridClaimEndpoint {
  readonly evidenceMode: HybridEvidenceMode;
  readonly identity: CanonicalClaimIdentity;
}

export interface HybridRelationshipRecord {
  readonly kind: HybridRelationship;
  readonly leftClaim: HybridClaimEndpoint | null;
  readonly rightClaim: HybridClaimEndpoint | null;
}

export interface HybridEvidenceResult {
  readonly schemaVersion: Fc009SchemaVersion;
  readonly policyVersion: Fc009HybridPolicyVersion;
  readonly identity: HybridFreshnessIdentity;
  readonly claims: readonly HybridClaim[];
  readonly relationships: readonly HybridRelationshipRecord[];
  readonly alternatives: readonly AdaptedAlternative[];
  readonly predictionStatus: HybridPredictionStatus;
  readonly predictionAbstentionReason: EpistemicAbstentionReason | null;
  readonly predictionFailureCode: OperationalFailureCode | null;
  readonly predictionFailureStage: string | null;
  readonly predictionFailureReason: string | null;
  readonly predictionProvenance: HybridPredictedProvenance | null;
  readonly predictionSupport: HybridPredictedSupport | null;
  readonly authoritativeBasis: HybridAuthoritativeBasis;
  readonly epistemicPrecedence: "verified-over-predicted";
  readonly executionAuthority: "none";
  readonly reason: HybridReasonCode | null;
}

export interface HybridCompositionSuccess {
  readonly ok: true;
  readonly result: HybridEvidenceResult;
}

export interface HybridCompositionFailure {
  readonly ok: false;
  readonly reason: HybridReasonCode;
  readonly issues: readonly import("./reasons.js").HybridIssue[];
}

export type HybridCompositionOutcome = HybridCompositionSuccess | HybridCompositionFailure;
