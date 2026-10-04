/**
 * FC-007 Sprint 1 — repository identity helpers (display + ASCII-normalized).
 */

import { asciiLower, isSupportedOwnerSegment, isSupportedRepoSegment } from "./location.js";

export interface Fc007RepoIdentity {
  readonly ownerDisplay: string;
  readonly ownerNormalized: string;
  readonly repoDisplay: string;
  readonly repoNormalized: string;
  readonly identityKey: string;
}

export function buildRepoIdentity(
  ownerDisplay: string,
  repoDisplay: string,
): Fc007RepoIdentity | null {
  if (!isSupportedOwnerSegment(ownerDisplay) || !isSupportedRepoSegment(repoDisplay)) {
    return null;
  }
  const ownerNormalized = asciiLower(ownerDisplay);
  const repoNormalized = asciiLower(repoDisplay);
  return {
    ownerDisplay,
    ownerNormalized,
    repoDisplay,
    repoNormalized,
    identityKey: `${ownerNormalized}/${repoNormalized}`,
  };
}

export function parseOwnerRepoText(
  text: string,
  expected?: { readonly ownerNormalized: string; readonly repoNormalized: string },
): Fc007RepoIdentity | null {
  const trimmed = text.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash !== trimmed.lastIndexOf("/")) return null;
  const ownerDisplay = trimmed.slice(0, slash);
  const repoDisplay = trimmed.slice(slash + 1);
  const id = buildRepoIdentity(ownerDisplay, repoDisplay);
  if (!id) return null;
  if (expected) {
    if (
      id.ownerNormalized !== expected.ownerNormalized ||
      id.repoNormalized !== expected.repoNormalized
    ) {
      return null;
    }
  }
  return id;
}

export function identitiesEqual(a: Fc007RepoIdentity, b: Fc007RepoIdentity): boolean {
  return a.identityKey === b.identityKey;
}
