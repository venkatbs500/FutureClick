/**
 * FC-009 Sprint 1 — versioned hybrid-composition policy.
 *
 * This is a closed evidence-composition policy, not product tuning.
 * Changing comparison, freshness, or precedence rules requires a new version.
 */

export const FC009_HYBRID_POLICY_VERSION = "1.0" as const;
export type Fc009HybridPolicyVersion = typeof FC009_HYBRID_POLICY_VERSION;

export const FC009_SCHEMA_VERSION = "1.0" as const;
export type Fc009SchemaVersion = typeof FC009_SCHEMA_VERSION;

/**
 * Epistemic precedence is not release authority.
 *
 * VERIFIED dominates PREDICTED when a downstream consumer needs a preferred
 * factual basis. That preference never authorizes click, submit, continue,
 * approve, release, capability grant, or native dispatch.
 */
export const FC009_EPISTEMIC_PRECEDENCE = "verified-over-predicted" as const;
export const FC009_EXECUTION_AUTHORITY = "none" as const;

export const FC009_POLICY = Object.freeze({
  version: FC009_HYBRID_POLICY_VERSION,
  schemaVersion: FC009_SCHEMA_VERSION,
  epistemicPrecedence: FC009_EPISTEMIC_PRECEDENCE,
  executionAuthority: FC009_EXECUTION_AUTHORITY,
  compareByCanonicalIdentity: true,
  agreementPromotesPrediction: false,
  fusedConfidence: false,
  predictionResolvesVerifiedConflict: false,
  stalePredictionMayMerge: false,
  unknownIsComparable: false,
  duplicateVerifiedDeduped: true,
  assertedPredictedClaims: 1,
} as const);
