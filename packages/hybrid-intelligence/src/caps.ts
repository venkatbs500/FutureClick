/**
 * FC-009 Sprint 1 — frozen input caps.
 *
 * Exceeding a cap is a fail-closed validation failure. Authoritative evidence
 * is never silently truncated.
 */

export const FC009_SAFETY_CAPS = Object.freeze({
  maxVerifiedClaims: 16,
  maxPredictedAlternatives: 3,
  maxAssumptionsPerClaim: 8,
  maxScopeChars: 512,
  maxPropertyChars: 96,
  maxValueChars: 64,
  maxFingerprintChars: 256,
  maxAssumptionIdChars: 64,
  maxAssumptionStatementChars: 256,
  maxProvenanceTokenChars: 128,
} as const);

export type Fc009SafetyCaps = typeof FC009_SAFETY_CAPS;
