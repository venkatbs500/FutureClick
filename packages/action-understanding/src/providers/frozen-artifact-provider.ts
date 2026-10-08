/**
 * FC-008 Sprint 4A — scoring provider backed by the frozen model artifacts.
 *
 * PROVIDERS SCORE. THE RUNTIME DECIDES. Nothing in this file changes that.
 *
 * This is the first provider that returns `scored`, so it is worth being explicit
 * about what it still refuses to do, because every one of these was reachable and
 * is deliberately not taken:
 *
 * - It returns RAW UNCALIBRATED logits. It holds a parsed calibration artifact
 *   only to publish `calibrationArtifactVersion` in the artifact descriptor;
 *   temperature is applied by the calibrator the runtime owns.
 * - It returns the factorized heads UNCOMPOSED, as 10 verb, 9 object, and 10
 *   transition-property logits. Composition stays runtime-side where the support
 *   matrix restricts the 900 combinations to the 13 supported tuples.
 * - It reads the frozen confidence threshold from the policy artifact and then
 *   does nothing with it. The threshold is not even carried out of this module:
 *   `ProviderScoringContext` has no threshold field to read and
 *   `ProviderScoreSet` has no field to write one into. The provider cannot
 *   accept, abstain, release, or click.
 * - It produces no `ActionHypothesis` and no evidence mode. A model can only
 *   support a PREDICTED hypothesis, and only the runtime may construct one.
 *
 * ENVIRONMENT
 *
 * Pure. The artifacts are INJECTED as an already-parsed, already-hash-verified
 * bundle rather than read from disk here, so this module has no `node:fs` and no
 * `node:crypto` import and stays usable wherever the runtime runs. The Node-only
 * reading and hashing path lives in `@futureclick/futurebench-dataset`.
 */

import { FC008_FEATURE_POLICY, type FeatureVocabulary } from "../feature-policy.js";
import type {
  ArtifactBundle,
  FactorizedModelArtifact,
  JointModelArtifact,
} from "../inference/artifact.js";
import { densifyFeatures, factorizedHeadLogits, jointRawLogits } from "../inference/scoring.js";
import type { ObservationSemantics } from "../observation.js";
import type {
  ArtifactDescriptor,
  ProviderOutcome,
  ProviderScoringContext,
  ScoringProvider,
} from "../provider.js";
import { projectPrimaryFeatures } from "../projection.js";

export const FROZEN_ARTIFACT_PROVIDER_ID = "fc008-frozen-artifact-provider" as const;

/**
 * Build the projector vocabulary from the model's own frozen feature order.
 *
 * Deriving it from the artifact rather than refitting it is the whole point: the
 * coefficient at index `j` was fitted for `featureOrder[j]`, so any vocabulary
 * that disagrees about that mapping silently scores the wrong weights against the
 * wrong features. Nothing here sorts, reorders, or normalizes.
 */
export function vocabularyFromModelArtifact(
  model: JointModelArtifact | FactorizedModelArtifact,
  vocabularyVersion: string,
): FeatureVocabulary {
  const entries = new Map<string, number>();
  for (let index = 0; index < model.featureOrder.length; index += 1) {
    entries.set(model.featureOrder[index] as string, index);
  }
  return Object.freeze({
    vocabularyVersion,
    featurePolicyVersion: FC008_FEATURE_POLICY.version,
    entries,
    size: entries.size,
  });
}

function describeArtifact(bundle: ArtifactBundle): ArtifactDescriptor {
  return Object.freeze({
    modelFamily: bundle.modelFamily,
    modelVersion: bundle.model.modelVersion,
    artifactSha256: bundle.modelSha256,
    supportMatrixVersion: bundle.model.identity.supportMatrixVersion,
    featurePolicyVersion: bundle.model.identity.featurePolicyVersion,
    calibrationArtifactVersion: bundle.calibration.calibrationArtifactVersion,
  });
}

export interface FrozenArtifactProviderOptions {
  /** Hash-verified, parsed artifacts for exactly one family. */
  readonly bundle: ArtifactBundle;
  /** Vocabulary version to publish. Defaults to the model version. */
  readonly vocabularyVersion?: string;
}

/**
 * Creates a provider that scores one family from its frozen artifacts.
 *
 * Failure is bounded and categorical. A projector refusal becomes `error` /
 * `internal-error` rather than an epistemic claim, because a provider has no
 * standing to say an input was too difficult: epistemic abstention is a runtime
 * decision made from support assessment, which providers cannot see.
 */
export function createFrozenArtifactProvider(
  options: FrozenArtifactProviderOptions,
): ScoringProvider {
  const { bundle } = options;
  const artifact = describeArtifact(bundle);
  const vocabulary = vocabularyFromModelArtifact(
    bundle.model,
    options.vocabularyVersion ?? bundle.model.modelVersion,
  );

  return Object.freeze({
    providerId: FROZEN_ARTIFACT_PROVIDER_ID,
    score(semantics: ObservationSemantics, context: ProviderScoringContext): ProviderOutcome {
      // Version agreement first. Scoring under a different support matrix or
      // feature policy produces numbers that look valid and mean something else.
      if (
        context.supportMatrixVersion !== artifact.supportMatrixVersion ||
        context.featurePolicyVersion !== artifact.featurePolicyVersion
      ) {
        return Object.freeze({
          status: "version-mismatch" as const,
          detail: "version-unsupported",
        });
      }

      const projected = projectPrimaryFeatures(semantics, vocabulary, FC008_FEATURE_POLICY);
      if (!projected.ok) {
        return Object.freeze({ status: "error" as const, detail: "internal-error" });
      }

      try {
        const features = densifyFeatures(
          projected.projection.vector.indices,
          projected.projection.vector.values,
        ).vector;

        if (bundle.modelFamily === "joint-logistic") {
          return Object.freeze({
            status: "scored" as const,
            scores: Object.freeze({
              scores: Object.freeze({
                family: "joint-logistic" as const,
                tupleLogits: jointRawLogits(bundle.model as JointModelArtifact, features),
              }),
              artifact,
            }),
          });
        }

        const heads = factorizedHeadLogits(bundle.model as FactorizedModelArtifact, features);
        return Object.freeze({
          status: "scored" as const,
          scores: Object.freeze({
            scores: Object.freeze({
              family: "factorized-logistic" as const,
              verbLogits: heads.verb,
              objectLogits: heads.objectKind,
              transitionLogits: heads.transitionProperty,
            }),
            artifact,
          }),
        });
      } catch {
        // Fail closed into the bounded operational vocabulary. A corrupt or
        // out-of-range artifact is a system defect, never an epistemic finding.
        return Object.freeze({ status: "error" as const, detail: "internal-error" });
      }
    },
  });
}
