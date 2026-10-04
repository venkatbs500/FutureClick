/**
 * FC-008 Sprint 1 — null scoring provider.
 *
 * Sprint 1 contains no trained model, so the only provider that ships is one
 * that reports the honest truth: no model artifact is available. It therefore
 * drives the runtime to the OPERATIONAL failure `MODEL_UNAVAILABLE`, never to an
 * epistemic abstention, because the absence of a model is a system condition and
 * not a statement about input difficulty.
 *
 * This provider demonstrates the capability boundary by construction: it accepts
 * Layer B semantics and a threshold-free context, reads neither, and returns an
 * inert record.
 */

import type { ProviderOutcome, ProviderScoringContext, ScoringProvider } from "../provider.js";
import type { ObservationSemantics } from "../observation.js";

export const NULL_PROVIDER_ID = "fc008-null-provider" as const;

/**
 * Closed diagnostic token, not prose. No FC-008 model artifact exists in
 * Sprint 1; training begins in Sprint 3.
 */
export const NULL_PROVIDER_DETAIL = "not-implemented" as const;

/**
 * Creates the Sprint-1 null provider.
 *
 * Always returns `unavailable`. It never returns `scored`, so it can never
 * produce a hypothesis through any code path.
 */
export function createNullScoringProvider(): ScoringProvider {
  return Object.freeze({
    providerId: NULL_PROVIDER_ID,
    score(_semantics: ObservationSemantics, _context: ProviderScoringContext): ProviderOutcome {
      return Object.freeze({
        status: "unavailable" as const,
        detail: NULL_PROVIDER_DETAIL,
      });
    },
  });
}
