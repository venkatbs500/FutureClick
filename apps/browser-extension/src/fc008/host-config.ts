/**
 * FC-008 Sprint 5B — trusted host configuration.
 *
 * There is no hidden model-family default and no silent production support-gate
 * policy. A missing family or missing gates means inference stays unavailable.
 * This file does not read the Sprint-4 final evaluation.
 */

import type { Fc008ModelFamily, HeadlessSupportGates } from "@futureclick/action-understanding";

export interface Fc008HostConfig {
  readonly modelFamily?: Fc008ModelFamily;
  readonly supportGates?: HeadlessSupportGates;
}

/**
 * Caller-owned development gates. These are NOT production policy and are NOT
 * holdout retunes. The Sprint-3 policy artifact does not lock these four fields.
 * Production must pass them explicitly through trusted host configuration.
 */
export const FC008_DEVELOPMENT_SUPPORT_GATES: HeadlessSupportGates = Object.freeze({
  minMargin: 0,
  maxUnknownTokenRatio: 1,
  minFeatureCoverage: 0,
  minRetainedRedactionRatio: 0,
});

/**
 * Production/development host config. Family and support gates are omitted until
 * a trusted host supplies both. Do not add a default here.
 */
export function readFc008HostConfig(): Fc008HostConfig {
  return Object.freeze({});
}
