/**
 * Primary feature projection (AI-15, AI-16, AI-19).
 *
 * Implements the `ProjectPrimaryFeatures` boundary declared in
 * `feature-policy.ts`. The first parameter is `ObservationSemantics` — Layer B
 * only — and that is the security property: the function cannot read site
 * identity, object names, benchmark grouping, partition identity, or oracle truth
 * because none of them is nameable from its parameters. Widening the parameter to
 * `ActionObservation` would make Layer C reachable and is rejected by the layering
 * tests.
 *
 * WHY EVERY FEATURE IS BINARY AND CATEGORICAL
 *
 * Numeric magnitudes leak. A raw heading count of 37 is a near-unique fingerprint
 * of one page layout; bucketed to "many" it is a weak structural signal. Every
 * feature emitted here is therefore presence/absence over a closed name space,
 * which also makes the vector trivially reproducible across the Python trainer and
 * the TypeScript runtime in Sprint 4.
 *
 * DETERMINISM
 *
 * Feature names are generated in a fixed family order and the vector is emitted in
 * ascending vocabulary index order, so identical semantics always produce an
 * identical vector regardless of iteration order anywhere upstream.
 */

import { FC008_SAFETY_CAPS } from "./bounds.js";
import {
  type AllowedPrimaryFeatureFamily,
  type FeaturePolicy,
  type FeatureProjectionResult,
  type FeatureVocabulary,
  type RequiredSemanticFeatureGroup,
  tokenFeatureName,
} from "./feature-policy.js";
import type { ObservationSemantics } from "./observation.js";

/** Projector identity. Participates in reproducibility checks. */
export const FC008_PROJECTOR_ID = "fc008-primary-projector";
export const FC008_PROJECTOR_VERSION = "1.0";

/**
 * Buckets a bounded count into a categorical band.
 *
 * Deliberately coarse. The point is to say "none / one / a few / many" without
 * publishing a layout-identifying magnitude.
 */
export function countBucket(value: number): "0" | "1" | "2-3" | "4-7" | "8plus" {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value === 1) {
    return "1";
  }
  if (value <= 3) {
    return "2-3";
  }
  if (value <= 7) {
    return "4-7";
  }
  return "8plus";
}

/** Canonical name for a bucketed structural count. */
export function structuralCountFeatureName(field: string, bucket: string): string {
  return `cnt:${field}:${bucket}`;
}

/** Canonical name for a categorical state token already in `property:value` form. */
export function stateFeatureName(stateToken: string): string {
  return `st:${stateToken}`;
}

/** One candidate feature plus the policy family that authorizes it. */
interface CandidateFeature {
  readonly name: string;
  readonly family: AllowedPrimaryFeatureFamily;
  readonly group: RequiredSemanticFeatureGroup | null;
}

/**
 * Enumerates every candidate feature for these semantics, in canonical order.
 *
 * Exported because the vocabulary fitter must derive candidate names from exactly
 * the same function the projector uses. Two independent name generators would
 * drift, and a vocabulary keyed on names the projector never emits is silently
 * useless.
 */
export function enumerateCandidateFeatures(
  semantics: ObservationSemantics,
): readonly CandidateFeature[] {
  const features: CandidateFeature[] = [];

  // Semantic tokens and channel identity.
  const channelsSeen = new Set<string>();
  for (const token of semantics.tokens) {
    features.push({
      name: tokenFeatureName(token.channel, token.value),
      family: "fixed-vocabulary-semantic-token",
      // Only the control-text channels evidence the control-text group; a heading
      // alone does not establish what the control is.
      group: token.channel === "ctl" || token.channel === "acc" ? "control-text" : null,
    });
    channelsSeen.add(token.channel);
  }
  for (const channel of [...channelsSeen].sort()) {
    features.push({ name: `chan:${channel}`, family: "token-channel-identity", group: null });
  }

  // Closed categorical descriptors of the control and surface.
  features.push({
    name: `ck:${semantics.controlKind}`,
    family: "control-kind",
    group: "control-role-kind",
  });
  features.push({
    name: `cr:${semantics.controlRole}`,
    family: "control-role",
    group: "control-role-kind",
  });
  features.push({
    name: `ik:${semantics.interactionKind}`,
    family: "interaction-kind",
    group: "interaction-kind",
  });
  features.push({
    name: `sk:${semantics.surfaceKind}`,
    family: "surface-kind",
    group: "surface-kind",
  });
  features.push({ name: `fm:${semantics.formMethod}`, family: "form-method", group: null });

  for (const stateToken of semantics.stateTokens) {
    features.push({
      name: stateFeatureName(stateToken),
      family: "categorical-state-token",
      group: "state-tokens",
    });
  }

  for (const kind of semantics.objectKindEvidence) {
    features.push({
      name: `obj:${kind}`,
      family: "object-kind-evidence",
      group: "object-kind-evidence",
    });
  }

  if (semantics.destructiveStyle) {
    features.push({
      name: "dstr:present",
      family: "destructive-style-weak-signal",
      group: null,
    });
  }

  // Missingness is a signal, not a silent zero: "no accessible name" is different
  // information from "an accessible name that produced no tokens".
  const missingness = semantics.missingness;
  const missingnessFields: readonly [string, boolean][] = [
    ["accessible-name", missingness.accessibleNameMissing],
    ["headings", missingness.headingsMissing],
    ["nearby-labels", missingness.nearbyLabelsMissing],
    ["state-tokens", missingness.stateTokensMissing],
    ["object-kind-evidence", missingness.objectKindEvidenceMissing],
    ["redaction-applied", missingness.redactionApplied],
  ];
  for (const [field, flag] of missingnessFields) {
    if (flag) {
      features.push({ name: `miss:${field}`, family: "missingness-indicator", group: null });
    }
  }

  const counts = semantics.structuralCounts;
  const countFields: readonly [string, number][] = [
    ["headings", counts.headingCount],
    ["nearby-labels", counts.nearbyLabelCount],
    ["state-tokens", counts.stateTokenCount],
    ["surface-depth", counts.surfaceDepth],
    ["sibling-controls", counts.siblingControlCount],
  ];
  for (const [field, value] of countFields) {
    features.push({
      name: structuralCountFeatureName(field, countBucket(value)),
      family: "bounded-structural-count",
      group: null,
    });
  }

  return features;
}

/**
 * Projects Layer B semantics into a sparse binary feature vector.
 *
 * Refuses rather than truncates when a cap is exceeded. A silently truncated
 * vector is a different input than the one the model was fitted on, and the
 * resulting probability would be meaningless while looking entirely normal.
 */
export function projectPrimaryFeatures(
  semantics: ObservationSemantics,
  vocabulary: FeatureVocabulary,
  policy: FeaturePolicy,
): FeatureProjectionResult {
  if (vocabulary.featurePolicyVersion !== policy.version) {
    return { ok: false, reason: "feature-policy-version-mismatch" };
  }
  if (vocabulary.size !== vocabulary.entries.size) {
    return { ok: false, reason: "vocabulary-size-inconsistent" };
  }
  if (vocabulary.size > policy.maxFeatureVocabulary) {
    return { ok: false, reason: "vocabulary-exceeds-policy-maximum" };
  }
  if (policy.maxFeatureVocabulary > FC008_SAFETY_CAPS.maxFeatureVocabulary) {
    return { ok: false, reason: "policy-exceeds-absolute-vocabulary-cap" };
  }
  if (policy.maxActiveFeatures > FC008_SAFETY_CAPS.maxActiveFeatures) {
    return { ok: false, reason: "policy-exceeds-absolute-active-cap" };
  }

  const allowedFamilies = new Set<string>(policy.allowedFamilies);
  const candidates = enumerateCandidateFeatures(semantics);

  const indexSet = new Set<number>();
  const representedGroups = new Set<RequiredSemanticFeatureGroup>();
  let unknownTokenCount = 0;
  let consideredTokenCount = 0;
  let unknownCategoricalCount = 0;

  for (const candidate of candidates) {
    if (!allowedFamilies.has(candidate.family)) {
      // A family the policy does not authorize is not merely skipped: a projector
      // emitting an unauthorized family would be a policy violation, so refuse.
      return { ok: false, reason: "feature-family-not-permitted-by-policy" };
    }
    const isToken = candidate.family === "fixed-vocabulary-semantic-token";
    if (isToken) {
      consideredTokenCount += 1;
    }
    const index = vocabulary.entries.get(candidate.name);
    if (index === undefined) {
      if (isToken) {
        unknownTokenCount += 1;
      } else {
        unknownCategoricalCount += 1;
      }
      continue;
    }
    if (!Number.isInteger(index) || index < 0 || index >= vocabulary.size) {
      return { ok: false, reason: "vocabulary-index-out-of-range" };
    }
    indexSet.add(index);
    if (candidate.group !== null) {
      representedGroups.add(candidate.group);
    }
  }

  const indices = [...indexSet].sort((a, b) => a - b);
  if (indices.length > policy.maxActiveFeatures) {
    return { ok: false, reason: "active-feature-count-exceeds-policy-maximum" };
  }

  return {
    ok: true,
    projection: {
      vector: {
        indices: Object.freeze(indices),
        // Binary presence. Declared explicitly rather than implied, so a future
        // weighted encoding is a visible change to this line.
        values: Object.freeze(indices.map(() => 1)),
        activeCount: indices.length,
      },
      representedRequiredGroups: Object.freeze(
        policy.requiredGroups.filter((group) => representedGroups.has(group)),
      ),
      unknownTokenCount,
      consideredTokenCount,
      unknownCategoricalCount,
    },
  };
}
