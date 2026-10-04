/**
 * FC-008 Sprint 1 — privacy-safe feature policy and projector boundary.
 *
 * Sprint 1 defines the CONTRACT only. The real extraction and projection
 * pipeline lands in Sprint 2; the fitted vocabulary lands in Sprint 3.
 *
 * The central structural control is the projector signature:
 *
 *   project(semantics: ObservationSemantics, vocabulary, policy): FeatureProjection
 *
 * and NOT:
 *
 *   project(observation: ActionObservation): FeatureProjection
 *
 * Because `ObservationSemantics` does not contain the acquisition, benchmark, or
 * display layers, a projector cannot read site identity, application name,
 * route, object label, oracle metadata, timestamps, or provenance even if its
 * implementation tried to. Prohibition is a type property, not a review note.
 */

import type { ObservationSemantics } from "./observation.js";

export const FC008_FEATURE_POLICY_VERSION = "1.0" as const;
export type Fc008FeaturePolicyVersion = typeof FC008_FEATURE_POLICY_VERSION;

/**
 * The twelve permitted primary feature families. A projector that emits a
 * feature outside these families violates the policy.
 */
export const ALLOWED_PRIMARY_FEATURE_FAMILIES = Object.freeze([
  "fixed-vocabulary-semantic-token",
  "token-channel-identity",
  "control-kind",
  "control-role",
  "interaction-kind",
  "surface-kind",
  "form-method",
  "categorical-state-token",
  "object-kind-evidence",
  "destructive-style-weak-signal",
  "missingness-indicator",
  "bounded-structural-count",
] as const);
export type AllowedPrimaryFeatureFamily = (typeof ALLOWED_PRIMARY_FEATURE_FAMILIES)[number];

/**
 * Inputs the PRIMARY learned model must never receive.
 *
 * Most are already unreachable because they are absent from
 * `ObservationSemantics`. This list exists so that the prohibition is explicit,
 * greppable, and directly testable: the layering tests assert that no name here
 * appears as a property key anywhere reachable from the projector input, and the
 * Sprint 3 vocabulary audit asserts that no feature name derives from one.
 */
export const PROHIBITED_PRIMARY_FEATURE_INPUTS = Object.freeze([
  "hostname",
  "siteIdentity",
  "origin",
  "rawOrigin",
  "url",
  "urlPath",
  "pathname",
  "search",
  "query",
  "fragment",
  "hash",
  "credentials",
  "referrer",
  "applicationName",
  "appName",
  "routeId",
  "routeIdentifier",
  "fixtureId",
  "generatorId",
  "templateId",
  "splitId",
  "partitionId",
  "oracleClass",
  "resolvedOracleClass",
  "groundTruthClass",
  "deterministicRuleOutcome",
  "ruleDecision",
  "repositoryName",
  "fileName",
  "folderName",
  "documentName",
  "accountName",
  "personName",
  "projectName",
  "organizationName",
  "objectLabel",
  "surfaceTitle",
  "domId",
  "elementId",
  "entityId",
  "timestamp",
  "capturedAt",
  "observedAt",
  "pageTitle",
  "rawTitle",
  "rawHtml",
  "outerHtml",
  "innerHtml",
  "domSnapshot",
  "selector",
  "cssPath",
  "xpath",
  "shadowRoot",
  "element",
  "node",
  "event",
  "callback",
  "handler",
  "formValues",
  "hiddenValues",
  "editableContent",
  "password",
  "token",
  "cookie",
  "cookies",
  "storage",
  "localStorage",
  "consequenceLabel",
  "riskLabel",
  "riskSeverity",
  "evaluationTrace",
  "modelProvenance",
  "artifactSha256",
  "screenshot",
  "image",
  "clipboard",
  "keystrokes",
  "accessibilityTree",
  "axTree",
] as const);

/**
 * The six REQUIRED semantic feature groups. `featureCoverage` is the count of
 * represented required groups divided by six. It is an input-quality
 * diagnostic, not a probability.
 */
export const REQUIRED_SEMANTIC_FEATURE_GROUPS = Object.freeze([
  "control-text",
  "control-role-kind",
  "interaction-kind",
  "surface-kind",
  "object-kind-evidence",
  "state-tokens",
] as const);
export type RequiredSemanticFeatureGroup = (typeof REQUIRED_SEMANTIC_FEATURE_GROUPS)[number];

export const REQUIRED_SEMANTIC_FEATURE_GROUP_COUNT = REQUIRED_SEMANTIC_FEATURE_GROUPS.length;

export interface FeaturePolicy {
  readonly version: Fc008FeaturePolicyVersion;
  readonly allowedFamilies: readonly AllowedPrimaryFeatureFamily[];
  readonly requiredGroups: readonly RequiredSemanticFeatureGroup[];
  readonly maxFeatureVocabulary: number;
  readonly maxActiveFeatures: number;
}

/**
 * The frozen Sprint-1 feature policy. Contains no fitted vocabulary and no
 * thresholds; thresholds belong to the abstention policy and the vocabulary is
 * fit on the TRAIN partition only during Sprint 3.
 */
export const FC008_FEATURE_POLICY: FeaturePolicy = Object.freeze({
  version: FC008_FEATURE_POLICY_VERSION,
  allowedFamilies: ALLOWED_PRIMARY_FEATURE_FAMILIES,
  requiredGroups: REQUIRED_SEMANTIC_FEATURE_GROUPS,
  maxFeatureVocabulary: 4096,
  maxActiveFeatures: 256,
});

// ============================================================================
// VOCABULARY AND VECTOR CONTRACTS (definitions only; fitted in Sprint 3)
// ============================================================================

/**
 * An inspectable, versioned, explicitly enumerated sparse vocabulary.
 *
 * `entries` maps a canonical feature name to its permanent index. Index
 * assignment is part of the released artifact and must never be recomputed at
 * runtime. Fitting occurs on the TRAIN partition only.
 */
export interface FeatureVocabulary {
  readonly vocabularyVersion: string;
  readonly featurePolicyVersion: Fc008FeaturePolicyVersion;
  /** Feature name to zero-based index. Indices must be contiguous from zero. */
  readonly entries: ReadonlyMap<string, number>;
  readonly size: number;
}

/**
 * Canonical vocabulary feature name for one normalized token on one channel.
 *
 * Declared here so the projector (Sprint 3) and the runtime support assessment
 * derive the same name from the same place, rather than agreeing by accident.
 */
export function tokenFeatureName(channel: string, value: string): string {
  return `tok:${channel}:${value}`;
}

/** A sparse feature vector in ascending index order. */
export interface FeatureVector {
  readonly indices: readonly number[];
  readonly values: readonly number[];
  readonly activeCount: number;
}

export interface FeatureProjection {
  readonly vector: FeatureVector;
  /** Required groups represented by at least one active feature. */
  readonly representedRequiredGroups: readonly RequiredSemanticFeatureGroup[];
  /** Tokens present in the observation but absent from the vocabulary. */
  readonly unknownTokenCount: number;
  /** Total tokens considered, used as the denominator for the unknown ratio. */
  readonly consideredTokenCount: number;
  /** Closed-grammar categorical values that fell outside the vocabulary. */
  readonly unknownCategoricalCount: number;
}

export type FeatureProjectionResult =
  | { readonly ok: true; readonly projection: FeatureProjection }
  | { readonly ok: false; readonly reason: string };

/**
 * The projector boundary.
 *
 * The first parameter is the ONLY observation material a primary projector may
 * read. Widening it to `ActionObservation` would be a security regression and is
 * rejected by the layering tests.
 */
export interface PrimaryFeatureProjector {
  readonly projectorId: string;
  readonly featurePolicyVersion: Fc008FeaturePolicyVersion;
  project(
    semantics: ObservationSemantics,
    vocabulary: FeatureVocabulary,
    policy: FeaturePolicy,
  ): FeatureProjectionResult;
}

/**
 * Standalone functional form of the same boundary, exported so that Sprint 2 and
 * the type-level tests can both reference one authoritative signature.
 */
export type ProjectPrimaryFeatures = (
  semantics: ObservationSemantics,
  vocabulary: FeatureVocabulary,
  policy: FeaturePolicy,
) => FeatureProjectionResult;

/** The exact input type a primary projector receives. Referenced by tests. */
export type PrimaryProjectorInput = Parameters<ProjectPrimaryFeatures>[0];
