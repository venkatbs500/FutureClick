/**
 * FC-008 Sprint 1 — runtime-owned deterministic support assessment.
 *
 * Everything in this module is DETERMINISTIC EVIDENCE, never a probability.
 *
 * FC-008 makes no claim of robust statistical out-of-distribution detection.
 * Feature-vector norms, Mahalanobis distance, and calibrated OOD probabilities
 * are deliberately absent and must not be introduced. Known features appearing
 * in a novel combination are NOT automatically out of distribution; they are
 * reported as an unsupported combination, which is a different and checkable
 * claim.
 *
 * OWNERSHIP
 *
 * Support assessment is produced HERE, on the runtime side, from Layer B
 * semantics and the frozen policy artifacts. It is NOT supplied by a scoring
 * provider.
 *
 * The reason is direct: if a provider reported its own input-support evidence,
 * a provider could claim full feature coverage and zero unknown tokens for any
 * input and thereby convert an input that should have been refused into an
 * accepted hypothesis. A provider would be certifying the very thing the
 * runtime is supposed to check. `assessSupport` therefore takes only the
 * validated observation semantics and runtime-held policy state, and the
 * provider contract carries no support field at all.
 */

import {
  type FeatureVocabulary,
  REQUIRED_SEMANTIC_FEATURE_GROUP_COUNT,
  REQUIRED_SEMANTIC_FEATURE_GROUPS,
  type RequiredSemanticFeatureGroup,
  tokenFeatureName,
} from "./feature-policy.js";
import type { ObservationSemantics } from "./observation.js";
import { FC008_MATRIX_OBJECT_KINDS } from "./support-matrix.js";

const SUPPORTED_OBJECT_KINDS = new Set<string>(FC008_MATRIX_OBJECT_KINDS);

/**
 * The closed-vocabulary escape hatch value.
 *
 * Every Layer B categorical is drawn from a closed vocabulary whose final
 * member is `"other"`. A categorical that resolved to `"other"` is a value the
 * extractor could not place in the vocabulary, which is exactly the
 * deterministic notion of "unknown categorical" FC-008 uses. No statistical
 * inference is involved.
 */
const UNKNOWN_CATEGORICAL_VALUE = "other";

/**
 * Deterministic support diagnostics carried on a hypothesis or an abstention.
 *
 * Contains no `ConfidenceScore`, probability, logit, score, or distance by
 * design. This is asserted at the type level and at runtime by the tests.
 */
export interface RuntimeSupportDiagnostics {
  readonly requiredFeatureGroupsPresent: number;
  readonly requiredFeatureGroupsTotal: typeof REQUIRED_SEMANTIC_FEATURE_GROUP_COUNT;
  /** Represented required groups divided by six. Input quality, not confidence. */
  readonly featureCoverage: number;
  /** Unknown tokens divided by considered tokens. Zero when none were considered. */
  readonly unknownTokenRatio: number;
  /**
   * Whether the ratio above was computable.
   *
   * The ratio needs a fitted feature vocabulary, which is a Sprint 3 artifact.
   * Until one is loaded this is `false` and the ratio is reported as zero. The
   * outcome mapping does not apply the ratio rule when it is not available, so
   * Sprint 1 cannot pass a check it is structurally unable to perform.
   */
  readonly unknownTokenRatioAvailable: boolean;
  readonly unknownCategoricalCount: number;
  /** At least one evidenced object kind is among the nine supported kinds. */
  readonly supportedObjectEvidence: boolean;
  readonly minimumSemanticEvidence: boolean;
  /**
   * The composed semantic tuple is a member of the frozen support matrix.
   *
   * Trivially true on the joint path, where every class index maps to a matrix
   * entry by construction. It becomes load-bearing in Sprint 3 for the
   * factorized family, whose composition can name a triple outside the matrix.
   */
  readonly supportedTupleResolved: boolean;
  readonly schemaVersionsMatched: boolean;
}

/** Deprecated alias retained so a rename does not ripple through consumers. */
export type SupportDiagnostics = RuntimeSupportDiagnostics;

/**
 * Which required groups a set of semantics represents.
 *
 * Representation is judged on the semantics alone, before any vocabulary is
 * consulted, so that coverage is computable in Sprint 1 and is independent of
 * which model artifact is loaded.
 */
export function representedRequiredGroups(
  semantics: ObservationSemantics,
): readonly RequiredSemanticFeatureGroup[] {
  const represented: RequiredSemanticFeatureGroup[] = [];

  if (semantics.tokens.some((t) => t.channel === "ctl")) {
    represented.push("control-text");
  }
  if (
    semantics.controlKind !== UNKNOWN_CATEGORICAL_VALUE ||
    semantics.controlRole !== UNKNOWN_CATEGORICAL_VALUE
  ) {
    represented.push("control-role-kind");
  }
  if (semantics.interactionKind !== UNKNOWN_CATEGORICAL_VALUE) {
    represented.push("interaction-kind");
  }
  if (semantics.surfaceKind !== UNKNOWN_CATEGORICAL_VALUE) {
    represented.push("surface-kind");
  }
  if (semantics.objectKindEvidence.length > 0) {
    represented.push("object-kind-evidence");
  }
  if (semantics.stateTokens.length > 0) {
    represented.push("state-tokens");
  }

  return Object.freeze(represented);
}

/** Represented required groups divided by the total of six. */
export function computeFeatureCoverage(semantics: ObservationSemantics): number {
  return representedRequiredGroups(semantics).length / REQUIRED_SEMANTIC_FEATURE_GROUP_COUNT;
}

/**
 * Minimum semantic evidence: the observation must carry usable control text or
 * an accessible name. Without either, no semantic claim is defensible and the
 * correct outcome is `INSUFFICIENT_CONTEXT`.
 */
export function hasMinimumSemanticEvidence(semantics: ObservationSemantics): boolean {
  return semantics.tokens.some((t) => t.channel === "ctl" || t.channel === "acc");
}

/**
 * Counts closed-grammar categoricals that resolved to the vocabulary escape
 * hatch. Deterministic: it is a comparison against a frozen vocabulary.
 */
export function countUnknownCategoricals(semantics: ObservationSemantics): number {
  let count = 0;
  for (const value of [
    semantics.controlKind,
    semantics.controlRole,
    semantics.interactionKind,
    semantics.surfaceKind,
    semantics.formMethod,
  ]) {
    if (value === UNKNOWN_CATEGORICAL_VALUE) {
      count += 1;
    }
  }
  for (const kind of semantics.objectKindEvidence) {
    if (!SUPPORTED_OBJECT_KINDS.has(kind)) {
      count += 1;
    }
  }
  return count;
}

/** Runtime-held state the assessment needs. Never provider-supplied. */
export interface SupportAssessmentContext {
  /** Fitted vocabulary, or null until a Sprint 3 artifact is loaded. */
  readonly vocabulary: FeatureVocabulary | null;
  /** Result of the runtime's own version comparison. */
  readonly schemaVersionsMatched: boolean;
  /** Result of the runtime's own tuple resolution. */
  readonly supportedTupleResolved: boolean;
}

/**
 * Produces the frozen support diagnostics for one observation.
 *
 * Pure: it reads only Layer B semantics and runtime-held context. There is no
 * parameter through which a provider could contribute a value.
 */
export function assessSupport(
  semantics: ObservationSemantics,
  context: SupportAssessmentContext,
): RuntimeSupportDiagnostics {
  const present = representedRequiredGroups(semantics).length;

  let unknownTokenRatio = 0;
  let unknownTokenRatioAvailable = false;
  if (context.vocabulary !== null) {
    const considered = semantics.tokens.length;
    if (considered > 0) {
      const { entries } = context.vocabulary;
      let unknown = 0;
      for (const token of semantics.tokens) {
        if (!entries.has(tokenFeatureName(token.channel, token.value))) {
          unknown += 1;
        }
      }
      unknownTokenRatio = unknown / considered;
    }
    unknownTokenRatioAvailable = true;
  }

  const evidencedKinds = semantics.objectKindEvidence;

  return Object.freeze({
    requiredFeatureGroupsPresent: present,
    requiredFeatureGroupsTotal: REQUIRED_SEMANTIC_FEATURE_GROUP_COUNT,
    featureCoverage: present / REQUIRED_SEMANTIC_FEATURE_GROUP_COUNT,
    unknownTokenRatio,
    unknownTokenRatioAvailable,
    unknownCategoricalCount: countUnknownCategoricals(semantics),
    supportedObjectEvidence:
      evidencedKinds.length === 0 || evidencedKinds.some((k) => SUPPORTED_OBJECT_KINDS.has(k)),
    minimumSemanticEvidence: hasMinimumSemanticEvidence(semantics),
    supportedTupleResolved: context.supportedTupleResolved,
    schemaVersionsMatched: context.schemaVersionsMatched,
  });
}

/** All six required group names, re-exported for convenience. */
export { REQUIRED_SEMANTIC_FEATURE_GROUPS };
