/**
 * FC-008 Sprint 4B-PreOpen — TypeScript capability façade.
 *
 * Authoritative sealed-row derivation lives in the Python one-shot evaluator.
 * This module does not call `buildDataset`, does not emit rows, and does not
 * keep a second membership list. It only checks the same runtime controls the
 * Python permit requires.
 */

export const FROZEN_FC008_DATASET_HASH =
  "44f01040e479d331920434ed4987ff2d0bdaa85c8bb54d55842c35e697d290fa";

export const FROZEN_FC008_VOCABULARY_HASH =
  "005212cce8104af27cbcb331c2635dd16b3db93ccdbd61841e70be3c0b29cb64";

export const FROZEN_FC008_SPRINT2_MANIFEST_HASH =
  "aa74f73075720326e692c8da0e8ccd13c71f82c51e69d5b933b59ff060c64d77";

export const FROZEN_FC008_SUPPORT_MATRIX_VERSION = "1.0";
export const FROZEN_FC008_FEATURE_POLICY_VERSION = "1.0";

export const PRODUCTION_SEALED_PARTITIONS = Object.freeze([
  "test-id",
  "test-ooa",
  "test-novelty",
] as const);

export const FROZEN_SEALED_PARTITION_COUNTS = Object.freeze({
  "test-id": 143,
  "test-ooa": 66,
  "test-novelty": 28,
} as const);

export class SealedOpeningNotEnabledError extends Error {
  override readonly name = "SealedOpeningNotEnabledError";
}

export interface FinalEvaluationCapability {
  readonly mode: "final-evaluation";
  readonly authorizedFamilies: readonly string[];
  readonly acknowledgeOneShotHoldout: true;
  readonly enableRealSealedOpening: true;
}

/**
 * Capability façade only. Never returns sealed rows.
 */
export function openProductionSealedPartitions(capability: FinalEvaluationCapability): never {
  if (capability.mode !== "final-evaluation") {
    throw new SealedOpeningNotEnabledError(
      "production sealed opening requires mode final-evaluation",
    );
  }
  if (capability.acknowledgeOneShotHoldout !== true) {
    throw new SealedOpeningNotEnabledError(
      "production sealed opening requires an explicit one-shot acknowledgement",
    );
  }
  if (capability.enableRealSealedOpening !== true) {
    throw new SealedOpeningNotEnabledError(
      "production sealed opening requires --enable-real-sealed-opening",
    );
  }
  if (capability.authorizedFamilies.length < 2) {
    throw new SealedOpeningNotEnabledError(
      "production sealed opening requires both model families to be authorized first",
    );
  }
  throw new SealedOpeningNotEnabledError(
    "TypeScript openProductionSealedPartitions is a capability façade; " +
      "authoritative derivation is performed by the Python production source",
  );
}
