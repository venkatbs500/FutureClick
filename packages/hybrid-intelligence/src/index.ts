/**
 * @futureclick/hybrid-intelligence
 *
 * FC-009 Sprint 1: deterministic hybrid epistemic composition.
 *
 * This package composes VERIFIED deterministic evidence with PREDICTED
 * FC-008 evidence. It does not authorize execution, mutate ActionGraph,
 * promote prediction to verification, or compute a fused confidence.
 */

export { FC009_SAFETY_CAPS } from "./caps.js";
export type { Fc009SafetyCaps } from "./caps.js";
export { composeHybridEvidence } from "./compose.js";
export { adaptPredictedEvidence } from "./adapters/predicted.js";
export { adaptVerifiedConsequence, adaptVerifiedStateChange } from "./adapters/verified.js";
export type { VerifiedAdapterContext } from "./adapters/verified.js";
export {
  claimIdentityFromHybridValues,
  claimIdentityFromStateChange,
  claimIdentityFromTokens,
  claimIdentityFromTuple,
  claimIdentityKey,
  identitiesEqual,
  identityIsComparable,
} from "./identity.js";
export {
  FC009_EPISTEMIC_PRECEDENCE,
  FC009_EXECUTION_AUTHORITY,
  FC009_HYBRID_POLICY_VERSION,
  FC009_POLICY,
  FC009_SCHEMA_VERSION,
} from "./policy.js";
export type { Fc009HybridPolicyVersion, Fc009SchemaVersion } from "./policy.js";
export { HYBRID_REASON_CODES, HYBRID_VALIDATION_CODES } from "./reasons.js";
export type { HybridIssue, HybridReasonCode, HybridValidationCode } from "./reasons.js";
export {
  HYBRID_ASSUMPTION_STATUSES,
  HYBRID_AUTHORITATIVE_BASES,
  HYBRID_EVIDENCE_MODES,
  HYBRID_PREDICTION_STATUSES,
  HYBRID_RELATIONSHIPS,
  HYBRID_VALUE_STATUSES,
  HYBRID_VERIFIED_SOURCES,
} from "./types.js";
export type {
  AdaptedAlternative,
  AdaptedPrediction,
  CanonicalClaimIdentity,
  HybridAssumption,
  HybridAuthoritativeBasis,
  HybridClaim,
  HybridClaimEndpoint,
  HybridCompositionFailure,
  HybridCompositionOutcome,
  HybridCompositionSuccess,
  HybridEvidenceInput,
  HybridEvidenceMode,
  HybridEvidenceResult,
  HybridFreshnessIdentity,
  HybridPredictedProvenance,
  HybridPredictedSupport,
  HybridPredictionStatus,
  HybridRelationship,
  HybridRelationshipRecord,
  HybridValueState,
  HybridVerifiedProvenance,
  VerifiedClaimInput,
} from "./types.js";
