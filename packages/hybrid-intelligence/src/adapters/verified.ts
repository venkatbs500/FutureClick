/**
 * Narrow read-only adapter from deterministic consequence state changes.
 *
 * Consumes action-schema StateChange / Consequence records. Does not import
 * release capability, native click, or ActionGraph mutation.
 *
 * Scope and assumption statements are trusted already-sanitized canonical
 * evidence. This adapter does not sanitize raw browser text and never copies
 * consequence.summary into hybrid scope.
 */

import type { Assumption, Consequence, StateChange } from "@futureclick/action-schema";
import { deepFreeze } from "../freeze.js";
import { isCanonicalProperty, schemaValueStateToHybrid } from "../identity.js";
import type {
  HybridAssumption,
  HybridFreshnessIdentity,
  HybridVerifiedProvenance,
  VerifiedClaimInput,
} from "../types.js";

export interface VerifiedAdapterContext {
  readonly freshness: HybridFreshnessIdentity;
  readonly provenance: HybridVerifiedProvenance;
  readonly scope: string | null;
  readonly assumptions?: readonly Assumption[];
}

function adaptAssumption(assumption: Assumption): HybridAssumption | null {
  if (
    assumption.status !== "assumed" &&
    assumption.status !== "verified" &&
    assumption.status !== "violated" &&
    assumption.status !== "unknown"
  ) {
    return null;
  }
  return {
    id: assumption.id,
    statement: assumption.statement,
    status: assumption.status,
  };
}

export function adaptVerifiedStateChange(
  change: StateChange,
  context: VerifiedAdapterContext,
): VerifiedClaimInput | null {
  const before = schemaValueStateToHybrid(change.before);
  const after = schemaValueStateToHybrid(change.after);
  if (before === null || after === null || !isCanonicalProperty(change.property)) {
    return null;
  }
  const assumptions: HybridAssumption[] = [];
  for (const assumption of context.assumptions ?? []) {
    const adapted = adaptAssumption(assumption);
    if (adapted === null) {
      return null;
    }
    assumptions.push(adapted);
  }
  return deepFreeze({
    property: change.property,
    before,
    after,
    scope: context.scope,
    assumptions,
    provenance: {
      source: context.provenance.source,
      ruleId: context.provenance.ruleId,
      engineVersion: context.provenance.engineVersion,
    },
    freshness: { actionFingerprint: context.freshness.actionFingerprint },
  });
}

export function adaptVerifiedConsequence(
  consequence: Consequence,
  freshness: HybridFreshnessIdentity,
): VerifiedClaimInput[] | null {
  const evidence = consequence.evidence[0];
  const rawScope = evidence?.scope;
  const scope = typeof rawScope === "string" && rawScope.length > 0 ? rawScope : null;
  const assumptions = evidence?.assumptions ?? [];
  const provenance: HybridVerifiedProvenance = {
    source:
      consequence.provenance?.source === "rule" ||
      consequence.provenance?.source === "engine" ||
      consequence.provenance?.source === "adapter" ||
      consequence.provenance?.source === "system"
        ? consequence.provenance.source
        : "engine",
    ruleId: consequence.provenance?.ruleId ?? null,
    engineVersion: consequence.provenance?.engineVersion ?? null,
  };
  const claims: VerifiedClaimInput[] = [];
  for (const change of consequence.stateChanges) {
    const adapted = adaptVerifiedStateChange(change, {
      freshness,
      provenance,
      scope,
      assumptions,
    });
    if (adapted === null) {
      return null;
    }
    claims.push(adapted);
  }
  return claims;
}
