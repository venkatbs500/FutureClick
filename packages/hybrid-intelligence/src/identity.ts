/**
 * Canonical claim identity from semantic state-transition fields only.
 */

import type { StateChange, ValueState } from "@futureclick/action-schema";
import type { SupportedTuple } from "@futureclick/action-understanding";
import { FC009_SAFETY_CAPS } from "./caps.js";
import type { CanonicalClaimIdentity, HybridKnownValue, HybridValueState } from "./types.js";

const PROPERTY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function isCanonicalProperty(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= FC009_SAFETY_CAPS.maxPropertyChars &&
    PROPERTY_PATTERN.test(value)
  );
}

export function isCanonicalToken(value: string): boolean {
  return (
    value.length > 0 && value.length <= FC009_SAFETY_CAPS.maxValueChars && TOKEN_PATTERN.test(value)
  );
}

export function knownValueToToken(value: HybridKnownValue): string | null {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return String(value);
  }
  if (typeof value === "string") {
    return isCanonicalToken(value) ? value : null;
  }
  return null;
}

export function valueStateToToken(state: HybridValueState): string | null {
  if (state.status === "absent") {
    return "absent";
  }
  if (state.status === "unknown") {
    return "unknown";
  }
  return knownValueToToken(state.value);
}

export function schemaValueStateToHybrid(state: ValueState): HybridValueState | null {
  if (state.status === "absent") {
    return { status: "absent" };
  }
  if (state.status === "unknown") {
    return { status: "unknown" };
  }
  const value = state.value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { status: "known", value };
  }
  return null;
}

export function claimIdentityKey(identity: CanonicalClaimIdentity): string {
  return `${identity.property}|${identity.before}->${identity.after}`;
}

export function identitiesEqual(a: CanonicalClaimIdentity, b: CanonicalClaimIdentity): boolean {
  return a.property === b.property && a.before === b.before && a.after === b.after;
}

export function claimIdentityFromTokens(
  property: string,
  before: string,
  after: string,
): CanonicalClaimIdentity | null {
  if (!isCanonicalProperty(property) || !isCanonicalToken(before) || !isCanonicalToken(after)) {
    return null;
  }
  return Object.freeze({ property, before, after });
}

export function claimIdentityFromHybridValues(
  property: string,
  before: HybridValueState,
  after: HybridValueState,
): CanonicalClaimIdentity | null {
  const beforeToken = valueStateToToken(before);
  const afterToken = valueStateToToken(after);
  if (beforeToken === null || afterToken === null) {
    return null;
  }
  return claimIdentityFromTokens(property, beforeToken, afterToken);
}

/**
 * Predicted tuple identity: objectKind.transitionProperty + from → to.
 * Example: repository.visibility private → public.
 */
export function claimIdentityFromTuple(tuple: SupportedTuple): CanonicalClaimIdentity | null {
  return claimIdentityFromTokens(
    `${tuple.objectKind}.${tuple.transition.property}`,
    tuple.transition.from,
    tuple.transition.to,
  );
}

/**
 * Verified StateChange identity: property + before → after.
 * entityId, selectors, and labels are excluded.
 */
export function claimIdentityFromStateChange(change: StateChange): CanonicalClaimIdentity | null {
  const before = schemaValueStateToHybrid(change.before);
  const after = schemaValueStateToHybrid(change.after);
  if (before === null || after === null) {
    return null;
  }
  return claimIdentityFromHybridValues(change.property, before, after);
}

export function isComparableToken(token: string): boolean {
  return token !== "unknown";
}

/** Both before and after must be comparable before AGREES or CONFLICTS. */
export function identityIsComparable(identity: CanonicalClaimIdentity): boolean {
  return isComparableToken(identity.before) && isComparableToken(identity.after);
}
