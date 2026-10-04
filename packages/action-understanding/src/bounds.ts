/**
 * FC-008 Sprint 1 — frozen hard safety caps.
 *
 * Two distinct categories exist and must never be conflated:
 *
 * 1. ABSOLUTE SAFETY CAPS (this module). Frozen before any implementation path
 *    consumes them. They bound memory, traversal, and allocation so that a
 *    hostile or degenerate surface cannot cause unbounded work. They are not
 *    performance targets and are deliberately generous.
 *
 * 2. MEASURE-THEN-FREEZE RELEASED TARGETS (not in this module). The normal
 *    released artifact-size target, the operational inference timeout, and the
 *    Python/TypeScript float parity tolerance are measured during Sprints 3-4
 *    and frozen below the corresponding absolute ceiling here. Sprint 1 must
 *    not invent those values.
 */

export const FC008_BOUNDS_VERSION = "1.0" as const;
export type Fc008BoundsVersion = typeof FC008_BOUNDS_VERSION;

/**
 * Absolute safety caps. Frozen at Sprint 1. Any value exceeding a cap is a
 * validation failure, never a truncation performed silently by a model
 * component.
 */
export const FC008_SAFETY_CAPS = Object.freeze({
  /** Maximum UTF-8 byte length of any single extracted string. */
  maxStringUtf8Bytes: 512,
  /** Maximum UTF-16 code-unit length of a label after normalization. */
  maxLabelChars: 256,
  /** Maximum heading labels captured per surface. */
  maxHeadingsPerSurface: 8,
  /** Maximum nearby labels captured per candidate control. */
  maxNearbyLabels: 12,
  /** Maximum normalized tokens retained per token channel. */
  maxTokensPerChannel: 64,
  /** Maximum normalized tokens retained across all channels combined. */
  maxTotalTokens: 192,
  /** Maximum categorical state tokens. */
  maxStateTokens: 24,
  /** Maximum weak object-kind evidence entries. */
  maxObjectKindEvidence: 4,
  /** Maximum candidate controls enumerated during one surface scan. */
  maxCandidateControlsPerScan: 32,
  /** Maximum ancestor hops / traversal depth during extraction. */
  maxTraversalDepth: 8,
  /** Maximum alternatives carried on an accepted hypothesis. */
  maxAlternatives: 3,
  /** Maximum total feature vocabulary indices (F). */
  maxFeatureVocabulary: 4096,
  /** Maximum non-zero features in one projected vector. */
  maxActiveFeatures: 256,
  /** Joint model class count. Exactly the supported tuple count. */
  jointModelClasses: 13,
  /** Factorized verb-head row count. */
  factorizedVerbRows: 10,
  /** Factorized object-head row count. */
  factorizedObjectRows: 9,
  /** Factorized transition-head row count. */
  factorizedTransitionRows: 10,
  /** Concurrent inferences permitted. In-flight work is superseded, not queued. */
  maxConcurrentInference: 1,
  /** Maximum canonical-JSON byte size of one benchmark record. */
  maxBenchmarkRecordBytes: 16_384,
  /** Absolute ceiling on released model artifact size. */
  absoluteArtifactCeilingBytes: 2_097_152,
  /** Absolute ceiling on any operational inference timeout. */
  absoluteInferenceTimeoutCeilingMs: 250,
  /**
   * Maximum acceptable absolute probability divergence between the Python
   * trainer and the TypeScript runtime. The operational tolerance is measured
   * in Sprint 4 and frozen at or below this ceiling.
   */
  maxAcceptableProbabilityParityCeiling: 1e-6,
} as const);

export type Fc008SafetyCaps = typeof FC008_SAFETY_CAPS;

/**
 * Identifies the three values that Sprint 1 deliberately does not fix, together
 * with the absolute cap each must respect and the point at which it is frozen.
 * Exported so documentation and later sprints cannot drift from this list.
 */
export const FC008_MEASURE_THEN_FREEZE_TARGETS = Object.freeze([
  Object.freeze({
    target: "releasedArtifactSizeBytes",
    measuredIn: "sprint-3",
    frozenBefore: "sprint-3-exit",
    boundedBy: "absoluteArtifactCeilingBytes",
  }),
  Object.freeze({
    target: "operationalInferenceTimeoutMs",
    measuredIn: "sprint-4-parity",
    frozenBefore: "sprint-5",
    boundedBy: "absoluteInferenceTimeoutCeilingMs",
  }),
  Object.freeze({
    target: "probabilityParityTolerance",
    measuredIn: "sprint-4-parity",
    frozenBefore: "sprint-4-final-experiments",
    boundedBy: "maxAcceptableProbabilityParityCeiling",
  }),
] as const);

/** Returns the UTF-8 byte length of a string without allocating a Buffer. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
        continue;
      }
      bytes += 3;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** True when a string respects both the byte cap and the character cap. */
export function isWithinStringCaps(value: string): boolean {
  return (
    value.length <= FC008_SAFETY_CAPS.maxLabelChars &&
    utf8ByteLength(value) <= FC008_SAFETY_CAPS.maxStringUtf8Bytes
  );
}
