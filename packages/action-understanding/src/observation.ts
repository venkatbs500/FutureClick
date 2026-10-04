/**
 * FC-008 Sprint 1 — platform-neutral `ActionObservation` with four
 * non-blurred layers.
 *
 * LAYER A  `acquisition`  Runtime and product context. Actor, platform,
 *                         environment kind, locale, frame position, acquisition
 *                         authorisation. NEVER a model feature.
 *
 * LAYER B  `semantics`    The ONLY structure the primary feature projector is
 *                         permitted to receive. Bounded, sanitized, closed-
 *                         vocabulary semantic material.
 *
 * LAYER C  `benchmark`    Opaque research grouping identifiers. Used for
 *                         partitioning, leakage audits, and the preregistered
 *                         site-identity ablation. NEVER a model feature. The
 *                         resolved oracle class deliberately does NOT appear
 *                         here; it belongs to the separate FutureBench record
 *                         contract introduced in Sprint 2.
 *
 * LAYER D  (absent here)  Ephemeral display-only labels. Memory-only, never
 *                         projected, never fingerprinted, never serialized,
 *                         never persisted. Defined in `display.ts` and
 *                         deliberately NOT a field of `ActionObservation`,
 *                         because this type is the serializable contract.
 *
 * The layering is enforced by function signature rather than convention: see
 * `PrimaryFeatureProjector` in `feature-policy.ts`, which accepts
 * `ObservationSemantics` and therefore cannot reach the other three layers.
 */

import {
  ACTOR_KINDS,
  type ActorKind,
  ENVIRONMENT_KINDS,
  type EnvironmentKind,
  type EntityKind,
  KNOWN_ENTITY_KINDS,
  SUPPORTED_PLATFORMS,
  type SupportedPlatform,
} from "@futureclick/action-schema";
import type { Brand } from "@futureclick/shared";
import { FC008_SAFETY_CAPS, isWithinStringCaps } from "./bounds.js";
import { computeObservationInputFingerprint } from "./fingerprint.js";
import { type FreshnessBinding, validateFreshnessBinding } from "./freshness.js";
import { SUPPORTED_TRANSITION_PROPERTIES } from "./support-matrix.js";
import {
  FC008_VALIDATION_CODES,
  type ValidationIssue,
  type ValidationResult,
  captureBoundedArray,
  inspectClosedObject,
  invalid,
  issue,
  readBoolean,
  readBoundedInteger,
  readBoundedNumber,
  readEnum,
  readString,
  safeFormatValue,
  valid,
} from "./validation.js";

export type ActionObservationId = Brand<string, "ActionObservationId">;

export const ACTION_OBSERVATION_SCHEMA_VERSION = "1.0" as const;
export const OBSERVATION_SEMANTICS_VERSION = "1.0" as const;

/** Opaque bounded identifier grammar. No whitespace, no control characters. */
export const FC008_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Normalized token grammar. Lowercase alphanumeric segments joined by a single
 * hyphen or underscore.
 *
 * This grammar is itself a privacy control: it structurally excludes `/`, `.`,
 * `:`, `@`, `?`, `=`, `#`, `\`, whitespace, and uppercase, so no URL, path,
 * email address, selector, CSS path, XPath, host name, or raw title fragment can
 * ever be represented as a semantic token.
 */
export const NORMALIZED_TOKEN_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** Supplementary structural cap on one normalized token. */
export const MAX_NORMALIZED_TOKEN_CHARS = 64;

/**
 * Structural cap on one segment between separators.
 *
 * A normalized token is word-shaped, and no natural UI word approaches this
 * length, so the cap rejects long opaque alphanumeric runs such as hashes,
 * identifiers, and bearer tokens. It is a WORD-SHAPE constraint, not secret
 * detection: deciding what is a secret remains the exclusive responsibility of
 * the Sprint 2 sanitizer, which runs before these semantics are constructed.
 * This cap is defence in depth behind that sanitizer, not a replacement for it.
 */
export const MAX_TOKEN_SEGMENT_CHARS = 24;

/** Locale tag grammar, bounded well below the string cap. */
export const LOCALE_TAG_REGEX = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** Opaque benchmark identifier grammar. Deliberately non-semantic. */
export const OPAQUE_ID_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
export const MAX_OPAQUE_ID_CHARS = 64;

// ============================================================================
// LAYER B CATEGORICAL VOCABULARIES (closed)
// ============================================================================

export const TOKEN_CHANNELS = Object.freeze(["ctl", "acc", "hd", "nb", "st"] as const);
export type TokenChannel = (typeof TOKEN_CHANNELS)[number];

export const CONTROL_KINDS = Object.freeze([
  "button",
  "link",
  "menuitem",
  "input-button",
  "other",
] as const);
export type ControlKind = (typeof CONTROL_KINDS)[number];

export const CONTROL_ROLES = Object.freeze([
  "button",
  "link",
  "menuitem",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "none",
  "other",
] as const);
export type ControlRole = (typeof CONTROL_ROLES)[number];

export const INTERACTION_KINDS = Object.freeze([
  "activate",
  "submit",
  "toggle",
  "select",
  "confirm",
  "dismiss",
  "other",
] as const);
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

export const SURFACE_KINDS = Object.freeze([
  "page",
  "modal-dialog",
  "non-modal-dialog",
  "panel",
  "menu",
  "inline",
  "other",
] as const);
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export const FORM_METHODS = Object.freeze(["get", "post", "none", "other"] as const);
export type FormMethod = (typeof FORM_METHODS)[number];

/**
 * Closed state-token grammar: `<transition-property>:<normalized-value>`.
 * The namespace is restricted to the frozen transition properties so that the
 * state channel cannot grow uncontrolled free text.
 */
export const STATE_TOKEN_REGEX = /^([a-z-]+):([a-z0-9]+(?:[-_][a-z0-9]+)*)$/;

// ============================================================================
// LAYER B — OBSERVATION SEMANTICS
// ============================================================================

/**
 * One normalized token on one channel.
 *
 * The payload field is named `value`, not `token`. `token` appears in
 * `PROHIBITED_PRIMARY_FEATURE_INPUTS` with its credential meaning, and Layer B
 * must contain no field name that an auditor could read as a credential.
 */
export interface SemanticToken {
  readonly channel: TokenChannel;
  readonly value: string;
}

/** Explicit missingness so absence is a signal rather than a silent zero. */
export interface ObservationMissingness {
  readonly accessibleNameMissing: boolean;
  readonly headingsMissing: boolean;
  readonly nearbyLabelsMissing: boolean;
  readonly stateTokensMissing: boolean;
  readonly objectKindEvidenceMissing: boolean;
  readonly redactionApplied: boolean;
}

export interface ObservationStructuralCounts {
  readonly headingCount: number;
  readonly nearbyLabelCount: number;
  readonly stateTokenCount: number;
  readonly surfaceDepth: number;
  readonly siblingControlCount: number;
}

/**
 * The sole input to primary feature projection.
 *
 * Contains no identity, no names, no routes, no timestamps, no provenance, no
 * benchmark grouping, no display labels, and no capability of any kind.
 */
export interface ObservationSemantics {
  readonly semanticsVersion: typeof OBSERVATION_SEMANTICS_VERSION;
  readonly tokens: readonly SemanticToken[];
  readonly controlKind: ControlKind;
  readonly controlRole: ControlRole;
  readonly interactionKind: InteractionKind;
  readonly surfaceKind: SurfaceKind;
  readonly formMethod: FormMethod;
  readonly stateTokens: readonly string[];
  readonly objectKindEvidence: readonly EntityKind[];
  readonly destructiveStyle: boolean;
  readonly missingness: ObservationMissingness;
  readonly structuralCounts: ObservationStructuralCounts;
}

// ============================================================================
// LAYER A — ACQUISITION CONTEXT
// ============================================================================

export interface ObservationActor {
  readonly kind: ActorKind;
}

export interface AcquisitionContext {
  /** Inherited into the hypothesis. Never predicted. */
  readonly actor: ObservationActor;
  readonly platform: SupportedPlatform;
  readonly environmentKind: EnvironmentKind;
  readonly localeTag: string;
  readonly topFrame: boolean;
  readonly acquisitionAuthorized: boolean;
}

// ============================================================================
// LAYER C — BENCHMARK METADATA
// ============================================================================

/**
 * Opaque research grouping. Structurally unreachable from the projector.
 *
 * `applicationFamilyId` and `templateLineageId` are distinct by contract:
 * an application family is a synthetic application environment with its own UI
 * structure, navigation conventions, terminology, and component composition; a
 * template lineage is an independently authored scenario implementation within
 * one application family. A wording variant, layout variant, theme, identifier
 * change, DOM reorder, or deterministic augmentation creates neither.
 */
export interface BenchmarkMetadata {
  readonly applicationFamilyId: string;
  readonly templateLineageId: string;
  readonly wordingVariantId: string;
  readonly layoutVariantId: string;
  readonly scenarioId: string;
  readonly generatorVersion: string;
}

// ============================================================================
// LAYER D — DELIBERATELY ABSENT FROM THIS MODULE
// ============================================================================
//
// Layer D (ephemeral display context) lives in `display.ts` and is NOT a field
// of `ActionObservation`. `ActionObservation` is the serializable inference
// contract; embedding memory-only display labels in it would mean that
// `JSON.stringify(observation)` emits private object names. See `display.ts`.

// ============================================================================
// SUPPORTING RECORDS
// ============================================================================

export interface RedactionReport {
  readonly redactedTokenCount: number;
  readonly droppedTokenCount: number;
  readonly truncatedStringCount: number;
  readonly credentialPatternDetected: boolean;
  readonly nameLikePatternDropped: number;
  /** Share of extracted material retained after sanitization, in [0, 1]. */
  readonly retainedRatio: number;
  readonly sanitizerVersion: string;
}

export interface ObservationProvenance {
  readonly extractorId: string;
  readonly extractorVersion: string;
  readonly sanitizerVersion: string;
  readonly source: "adapter";
  readonly synthetic: boolean;
}

// ============================================================================
// ROOT
// ============================================================================

/**
 * The serializable FC-008 inference contract.
 *
 * Carries Layers A, B, and C plus the supporting durable records. It carries NO
 * Layer D: there is no `display`, `objectLabel`, or `surfaceTitle` field, so
 * serializing an observation cannot emit a human-readable private label.
 */
export interface ActionObservation {
  readonly schemaVersion: typeof ACTION_OBSERVATION_SCHEMA_VERSION;
  readonly id: ActionObservationId;
  readonly semantics: ObservationSemantics;
  readonly acquisition: AcquisitionContext;
  readonly benchmark: BenchmarkMetadata | null;
  readonly redaction: RedactionReport;
  readonly freshness: FreshnessBinding;
  readonly provenance: ObservationProvenance;
  /** Canonical typed encoding of Layer B plus Layer A. Excludes Layers C and D. */
  readonly inputFingerprint: string;
}

// ============================================================================
// VALIDATION
// ============================================================================

const SEMANTICS_KEYS = [
  "semanticsVersion",
  "tokens",
  "controlKind",
  "controlRole",
  "interactionKind",
  "surfaceKind",
  "formMethod",
  "stateTokens",
  "objectKindEvidence",
  "destructiveStyle",
  "missingness",
  "structuralCounts",
] as const;

const MISSINGNESS_KEYS = [
  "accessibleNameMissing",
  "headingsMissing",
  "nearbyLabelsMissing",
  "stateTokensMissing",
  "objectKindEvidenceMissing",
  "redactionApplied",
] as const;

const STRUCTURAL_COUNT_KEYS = [
  "headingCount",
  "nearbyLabelCount",
  "stateTokenCount",
  "surfaceDepth",
  "siblingControlCount",
] as const;

const ACQUISITION_KEYS = [
  "actor",
  "platform",
  "environmentKind",
  "localeTag",
  "topFrame",
  "acquisitionAuthorized",
] as const;

const BENCHMARK_KEYS = [
  "applicationFamilyId",
  "templateLineageId",
  "wordingVariantId",
  "layoutVariantId",
  "scenarioId",
  "generatorVersion",
] as const;

const REDACTION_KEYS = [
  "redactedTokenCount",
  "droppedTokenCount",
  "truncatedStringCount",
  "credentialPatternDetected",
  "nameLikePatternDropped",
  "retainedRatio",
  "sanitizerVersion",
] as const;

const PROVENANCE_KEYS = [
  "extractorId",
  "extractorVersion",
  "sanitizerVersion",
  "source",
  "synthetic",
] as const;

const OBSERVATION_KEYS = [
  "schemaVersion",
  "id",
  "semantics",
  "acquisition",
  "benchmark",
  "redaction",
  "freshness",
  "provenance",
  "inputFingerprint",
] as const;

const VALID_TRANSITION_PROPERTIES = new Set<string>(SUPPORTED_TRANSITION_PROPERTIES);

function validateNormalizedToken(value: unknown, path: string, issues: ValidationIssue[]): boolean {
  if (typeof value !== "string") {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.typeMismatch,
        path,
        `Token must be a string, received ${safeFormatValue(value)}.`,
      ),
    );
    return false;
  }
  if (value.length === 0 || value.length > MAX_NORMALIZED_TOKEN_CHARS) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.boundExceeded,
        path,
        `Token length must be within [1, ${MAX_NORMALIZED_TOKEN_CHARS}].`,
      ),
    );
    return false;
  }
  if (!NORMALIZED_TOKEN_REGEX.test(value)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.patternViolation,
        path,
        "Token must match the normalized token grammar (lowercase alphanumeric segments joined by - or _).",
      ),
    );
    return false;
  }
  for (const segment of value.split(/[-_]/)) {
    if (segment.length > MAX_TOKEN_SEGMENT_CHARS) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.boundExceeded,
          path,
          `Token segment length must be at most ${MAX_TOKEN_SEGMENT_CHARS}; longer opaque runs are not word-shaped.`,
        ),
      );
      return false;
    }
  }
  return true;
}

function validateSemantics(input: unknown, path: string): ValidationResult<ObservationSemantics> {
  const inspection = inspectClosedObject(input, SEMANTICS_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const fields = inspection.fields;
  const issues: ValidationIssue[] = [];

  const semanticsVersion = readString(fields, "semanticsVersion", path, issues);
  if (semanticsVersion !== undefined && semanticsVersion !== OBSERVATION_SEMANTICS_VERSION) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        `${path}.semanticsVersion`,
        `Unsupported semanticsVersion "${safeFormatValue(semanticsVersion)}".`,
      ),
    );
  }

  const controlKind = readEnum(fields, "controlKind", CONTROL_KINDS, path, issues);
  const controlRole = readEnum(fields, "controlRole", CONTROL_ROLES, path, issues);
  const interactionKind = readEnum(fields, "interactionKind", INTERACTION_KINDS, path, issues);
  const surfaceKind = readEnum(fields, "surfaceKind", SURFACE_KINDS, path, issues);
  const formMethod = readEnum(fields, "formMethod", FORM_METHODS, path, issues);
  const destructiveStyle = readBoolean(fields, "destructiveStyle", path, issues);

  // --- tokens -------------------------------------------------------------
  const tokens: SemanticToken[] = [];
  const tokenCapture = captureBoundedArray(
    fields.get("tokens"),
    FC008_SAFETY_CAPS.maxTotalTokens,
    `${path}.tokens`,
  );
  if (!tokenCapture.ok) {
    issues.push(...tokenCapture.issues);
  } else {
    const perChannel = new Map<TokenChannel, number>();
    const seen = new Set<string>();
    for (let i = 0; i < tokenCapture.values.length; i++) {
      const tokenPath = `${path}.tokens[${i}]`;
      const tokenInspection = inspectClosedObject(
        tokenCapture.values[i],
        ["channel", "value"],
        [],
        tokenPath,
      );
      if (!tokenInspection.ok) {
        issues.push(...tokenInspection.issues);
        continue;
      }
      const channel = readEnum(
        tokenInspection.fields,
        "channel",
        TOKEN_CHANNELS,
        tokenPath,
        issues,
      );
      const rawToken = tokenInspection.fields.get("value");
      if (
        !validateNormalizedToken(rawToken, `${tokenPath}.value`, issues) ||
        channel === undefined
      ) {
        continue;
      }
      const value = rawToken as string;
      const dedupeKey = `${channel}:${value}`;
      if (seen.has(dedupeKey)) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.duplicateValue,
            tokenPath,
            `Duplicate token "${dedupeKey}". Tokens must be unique per channel.`,
          ),
        );
        continue;
      }
      seen.add(dedupeKey);
      const count = (perChannel.get(channel) ?? 0) + 1;
      perChannel.set(channel, count);
      if (count > FC008_SAFETY_CAPS.maxTokensPerChannel) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.boundExceeded,
            tokenPath,
            `Channel "${channel}" exceeds the frozen cap of ${FC008_SAFETY_CAPS.maxTokensPerChannel} tokens.`,
          ),
        );
        continue;
      }
      tokens.push(Object.freeze({ channel, value }));
    }
  }

  // --- state tokens -------------------------------------------------------
  const stateTokens: string[] = [];
  const stateCapture = captureBoundedArray(
    fields.get("stateTokens"),
    FC008_SAFETY_CAPS.maxStateTokens,
    `${path}.stateTokens`,
  );
  if (!stateCapture.ok) {
    issues.push(...stateCapture.issues);
  } else {
    const seenState = new Set<string>();
    for (let i = 0; i < stateCapture.values.length; i++) {
      const statePath = `${path}.stateTokens[${i}]`;
      const raw = stateCapture.values[i];
      if (typeof raw !== "string") {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.typeMismatch,
            statePath,
            `State token must be a string, received ${safeFormatValue(raw)}.`,
          ),
        );
        continue;
      }
      const match = STATE_TOKEN_REGEX.exec(raw);
      if (match === null) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.patternViolation,
            statePath,
            'State token must match "<transition-property>:<normalized-value>".',
          ),
        );
        continue;
      }
      const namespace = match[1] as string;
      if (!VALID_TRANSITION_PROPERTIES.has(namespace)) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.enumViolation,
            statePath,
            `State token namespace "${namespace}" is not a declared transition property.`,
          ),
        );
        continue;
      }
      if (raw.length > MAX_NORMALIZED_TOKEN_CHARS) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.boundExceeded,
            statePath,
            `State token length must be at most ${MAX_NORMALIZED_TOKEN_CHARS}.`,
          ),
        );
        continue;
      }
      if (seenState.has(raw)) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.duplicateValue,
            statePath,
            `Duplicate state token "${raw}".`,
          ),
        );
        continue;
      }
      seenState.add(raw);
      stateTokens.push(raw);
    }
  }

  // --- object-kind evidence ----------------------------------------------
  const objectKindEvidence: EntityKind[] = [];
  const evidenceCapture = captureBoundedArray(
    fields.get("objectKindEvidence"),
    FC008_SAFETY_CAPS.maxObjectKindEvidence,
    `${path}.objectKindEvidence`,
  );
  if (!evidenceCapture.ok) {
    issues.push(...evidenceCapture.issues);
  } else {
    const validKinds = new Set<string>(KNOWN_ENTITY_KINDS);
    const seenKinds = new Set<string>();
    for (let i = 0; i < evidenceCapture.values.length; i++) {
      const evidencePath = `${path}.objectKindEvidence[${i}]`;
      const raw = evidenceCapture.values[i];
      if (typeof raw !== "string" || !validKinds.has(raw)) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.enumViolation,
            evidencePath,
            `Object-kind evidence must be a canonical KnownEntityKind, received ${safeFormatValue(raw)}.`,
          ),
        );
        continue;
      }
      if (seenKinds.has(raw)) {
        issues.push(
          issue(
            FC008_VALIDATION_CODES.duplicateValue,
            evidencePath,
            `Duplicate object-kind evidence "${raw}".`,
          ),
        );
        continue;
      }
      seenKinds.add(raw);
      objectKindEvidence.push(raw as EntityKind);
    }
  }

  // --- missingness --------------------------------------------------------
  let missingness: ObservationMissingness | undefined;
  const missingnessInspection = inspectClosedObject(
    fields.get("missingness"),
    MISSINGNESS_KEYS,
    [],
    `${path}.missingness`,
  );
  if (!missingnessInspection.ok) {
    issues.push(...missingnessInspection.issues);
  } else {
    const m: Record<string, boolean> = {};
    let ok = true;
    for (const key of MISSINGNESS_KEYS) {
      const value = readBoolean(missingnessInspection.fields, key, `${path}.missingness`, issues);
      if (value === undefined) {
        ok = false;
      } else {
        m[key] = value;
      }
    }
    if (ok) {
      missingness = Object.freeze({
        accessibleNameMissing: m.accessibleNameMissing as boolean,
        headingsMissing: m.headingsMissing as boolean,
        nearbyLabelsMissing: m.nearbyLabelsMissing as boolean,
        stateTokensMissing: m.stateTokensMissing as boolean,
        objectKindEvidenceMissing: m.objectKindEvidenceMissing as boolean,
        redactionApplied: m.redactionApplied as boolean,
      });
    }
  }

  // --- structural counts --------------------------------------------------
  let structuralCounts: ObservationStructuralCounts | undefined;
  const countsInspection = inspectClosedObject(
    fields.get("structuralCounts"),
    STRUCTURAL_COUNT_KEYS,
    [],
    `${path}.structuralCounts`,
  );
  if (!countsInspection.ok) {
    issues.push(...countsInspection.issues);
  } else {
    const countPath = `${path}.structuralCounts`;
    const headingCount = readBoundedInteger(
      countsInspection.fields,
      "headingCount",
      FC008_SAFETY_CAPS.maxHeadingsPerSurface,
      countPath,
      issues,
    );
    const nearbyLabelCount = readBoundedInteger(
      countsInspection.fields,
      "nearbyLabelCount",
      FC008_SAFETY_CAPS.maxNearbyLabels,
      countPath,
      issues,
    );
    const stateTokenCount = readBoundedInteger(
      countsInspection.fields,
      "stateTokenCount",
      FC008_SAFETY_CAPS.maxStateTokens,
      countPath,
      issues,
    );
    const surfaceDepth = readBoundedInteger(
      countsInspection.fields,
      "surfaceDepth",
      FC008_SAFETY_CAPS.maxTraversalDepth,
      countPath,
      issues,
    );
    const siblingControlCount = readBoundedInteger(
      countsInspection.fields,
      "siblingControlCount",
      FC008_SAFETY_CAPS.maxCandidateControlsPerScan,
      countPath,
      issues,
    );
    if (
      headingCount !== undefined &&
      nearbyLabelCount !== undefined &&
      stateTokenCount !== undefined &&
      surfaceDepth !== undefined &&
      siblingControlCount !== undefined
    ) {
      structuralCounts = Object.freeze({
        headingCount,
        nearbyLabelCount,
        stateTokenCount,
        surfaceDepth,
        siblingControlCount,
      });
    }
  }

  // --- cross-field invariants --------------------------------------------
  if (missingness !== undefined && structuralCounts !== undefined) {
    if (structuralCounts.stateTokenCount !== stateTokens.length) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.invariantViolation,
          `${path}.structuralCounts.stateTokenCount`,
          `stateTokenCount ${structuralCounts.stateTokenCount} must equal stateTokens length ${stateTokens.length}.`,
        ),
      );
    }
    if (missingness.stateTokensMissing !== (stateTokens.length === 0)) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.invariantViolation,
          `${path}.missingness.stateTokensMissing`,
          "stateTokensMissing must be true exactly when stateTokens is empty.",
        ),
      );
    }
    if (missingness.objectKindEvidenceMissing !== (objectKindEvidence.length === 0)) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.invariantViolation,
          `${path}.missingness.objectKindEvidenceMissing`,
          "objectKindEvidenceMissing must be true exactly when objectKindEvidence is empty.",
        ),
      );
    }
    if (missingness.headingsMissing !== (structuralCounts.headingCount === 0)) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.invariantViolation,
          `${path}.missingness.headingsMissing`,
          "headingsMissing must be true exactly when headingCount is zero.",
        ),
      );
    }
    if (missingness.nearbyLabelsMissing !== (structuralCounts.nearbyLabelCount === 0)) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.invariantViolation,
          `${path}.missingness.nearbyLabelsMissing`,
          "nearbyLabelsMissing must be true exactly when nearbyLabelCount is zero.",
        ),
      );
    }
    const hasAccessibleName = tokens.some((t) => t.channel === "acc");
    if (missingness.accessibleNameMissing === hasAccessibleName) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.invariantViolation,
          `${path}.missingness.accessibleNameMissing`,
          'accessibleNameMissing must be true exactly when no token uses channel "acc".',
        ),
      );
    }
  }

  if (
    issues.length > 0 ||
    controlKind === undefined ||
    controlRole === undefined ||
    interactionKind === undefined ||
    surfaceKind === undefined ||
    formMethod === undefined ||
    destructiveStyle === undefined ||
    missingness === undefined ||
    structuralCounts === undefined
  ) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({
      semanticsVersion: OBSERVATION_SEMANTICS_VERSION,
      tokens: Object.freeze(tokens),
      controlKind,
      controlRole,
      interactionKind,
      surfaceKind,
      formMethod,
      stateTokens: Object.freeze(stateTokens),
      objectKindEvidence: Object.freeze(objectKindEvidence),
      destructiveStyle,
      missingness,
      structuralCounts,
    }),
  );
}

function validateAcquisition(input: unknown, path: string): ValidationResult<AcquisitionContext> {
  const inspection = inspectClosedObject(input, ACQUISITION_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const issues: ValidationIssue[] = [];
  const fields = inspection.fields;

  let actorKind: ActorKind | undefined;
  const actorInspection = inspectClosedObject(fields.get("actor"), ["kind"], [], `${path}.actor`);
  if (!actorInspection.ok) {
    issues.push(...actorInspection.issues);
  } else {
    actorKind = readEnum(actorInspection.fields, "kind", ACTOR_KINDS, `${path}.actor`, issues);
  }

  const platform = readEnum(fields, "platform", SUPPORTED_PLATFORMS, path, issues);
  const environmentKind = readEnum(fields, "environmentKind", ENVIRONMENT_KINDS, path, issues);
  const localeTag = readString(fields, "localeTag", path, issues);
  const topFrame = readBoolean(fields, "topFrame", path, issues);
  const acquisitionAuthorized = readBoolean(fields, "acquisitionAuthorized", path, issues);

  if (localeTag !== undefined && (localeTag.length > 35 || !LOCALE_TAG_REGEX.test(localeTag))) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.patternViolation,
        `${path}.localeTag`,
        "localeTag must be a bounded BCP-47-style language tag.",
      ),
    );
  }

  if (
    issues.length > 0 ||
    actorKind === undefined ||
    platform === undefined ||
    environmentKind === undefined ||
    localeTag === undefined ||
    topFrame === undefined ||
    acquisitionAuthorized === undefined
  ) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({
      actor: Object.freeze({ kind: actorKind }),
      platform,
      environmentKind,
      localeTag,
      topFrame,
      acquisitionAuthorized,
    }),
  );
}

function validateBenchmark(input: unknown, path: string): ValidationResult<BenchmarkMetadata> {
  const inspection = inspectClosedObject(input, BENCHMARK_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const issues: ValidationIssue[] = [];
  const resolved: Record<string, string> = {};

  for (const key of BENCHMARK_KEYS) {
    const value = readString(inspection.fields, key, path, issues);
    if (value === undefined) {
      continue;
    }
    if (value.length === 0 || value.length > MAX_OPAQUE_ID_CHARS || !OPAQUE_ID_REGEX.test(value)) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.patternViolation,
          `${path}.${key}`,
          `${key} must be an opaque bounded identifier matching the opaque id grammar.`,
        ),
      );
      continue;
    }
    resolved[key] = value;
  }

  if (issues.length > 0) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({
      applicationFamilyId: resolved.applicationFamilyId as string,
      templateLineageId: resolved.templateLineageId as string,
      wordingVariantId: resolved.wordingVariantId as string,
      layoutVariantId: resolved.layoutVariantId as string,
      scenarioId: resolved.scenarioId as string,
      generatorVersion: resolved.generatorVersion as string,
    }),
  );
}

function validateRedaction(input: unknown, path: string): ValidationResult<RedactionReport> {
  const inspection = inspectClosedObject(input, REDACTION_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const issues: ValidationIssue[] = [];
  const fields = inspection.fields;

  const redactedTokenCount = readBoundedInteger(
    fields,
    "redactedTokenCount",
    FC008_SAFETY_CAPS.maxTotalTokens,
    path,
    issues,
  );
  const droppedTokenCount = readBoundedInteger(
    fields,
    "droppedTokenCount",
    FC008_SAFETY_CAPS.maxTotalTokens,
    path,
    issues,
  );
  const truncatedStringCount = readBoundedInteger(
    fields,
    "truncatedStringCount",
    FC008_SAFETY_CAPS.maxTotalTokens,
    path,
    issues,
  );
  const nameLikePatternDropped = readBoundedInteger(
    fields,
    "nameLikePatternDropped",
    FC008_SAFETY_CAPS.maxTotalTokens,
    path,
    issues,
  );
  const credentialPatternDetected = readBoolean(fields, "credentialPatternDetected", path, issues);
  const retainedRatio = readBoundedNumber(fields, "retainedRatio", 0, 1, path, issues);
  const sanitizerVersion = readString(fields, "sanitizerVersion", path, issues);

  if (
    sanitizerVersion !== undefined &&
    (sanitizerVersion.length === 0 || sanitizerVersion.length > 64)
  ) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.boundExceeded,
        `${path}.sanitizerVersion`,
        "sanitizerVersion must be a non-empty string of at most 64 characters.",
      ),
    );
  }

  if (
    issues.length > 0 ||
    redactedTokenCount === undefined ||
    droppedTokenCount === undefined ||
    truncatedStringCount === undefined ||
    nameLikePatternDropped === undefined ||
    credentialPatternDetected === undefined ||
    retainedRatio === undefined ||
    sanitizerVersion === undefined
  ) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({
      redactedTokenCount,
      droppedTokenCount,
      truncatedStringCount,
      credentialPatternDetected,
      nameLikePatternDropped,
      retainedRatio,
      sanitizerVersion,
    }),
  );
}

function validateObservationProvenance(
  input: unknown,
  path: string,
): ValidationResult<ObservationProvenance> {
  const inspection = inspectClosedObject(input, PROVENANCE_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const issues: ValidationIssue[] = [];
  const fields = inspection.fields;

  const extractorId = readString(fields, "extractorId", path, issues);
  const extractorVersion = readString(fields, "extractorVersion", path, issues);
  const sanitizerVersion = readString(fields, "sanitizerVersion", path, issues);
  const source = readEnum(fields, "source", ["adapter"] as const, path, issues);
  const synthetic = readBoolean(fields, "synthetic", path, issues);

  for (const [key, value] of [
    ["extractorId", extractorId],
    ["extractorVersion", extractorVersion],
    ["sanitizerVersion", sanitizerVersion],
  ] as const) {
    if (value !== undefined && (value.length === 0 || value.length > 64)) {
      issues.push(
        issue(
          FC008_VALIDATION_CODES.boundExceeded,
          `${path}.${key}`,
          `${key} must be a non-empty string of at most 64 characters.`,
        ),
      );
    }
  }

  if (
    issues.length > 0 ||
    extractorId === undefined ||
    extractorVersion === undefined ||
    sanitizerVersion === undefined ||
    source === undefined ||
    synthetic === undefined
  ) {
    return invalid(issues);
  }

  return valid(
    Object.freeze({ extractorId, extractorVersion, sanitizerVersion, source, synthetic }),
  );
}

/**
 * Validates an untrusted value as an `ActionObservation`.
 *
 * Fails closed. Returns a detached, deeply frozen canonical observation whose
 * `inputFingerprint` has been recomputed from the validated Layer A and Layer B
 * content; a declared fingerprint that does not match is rejected rather than
 * silently corrected.
 */
export function validateActionObservation(
  input: unknown,
  path = "observation",
): ValidationResult<ActionObservation> {
  try {
    return validateActionObservationInternal(input, path);
  } catch {
    return invalid([
      issue(
        FC008_VALIDATION_CODES.readError,
        path,
        "ActionObservation validation failed closed on an unhandled runtime exception.",
      ),
    ]);
  }
}

function validateActionObservationInternal(
  input: unknown,
  path: string,
): ValidationResult<ActionObservation> {
  const inspection = inspectClosedObject(input, OBSERVATION_KEYS, [], path);
  if (!inspection.ok) {
    return invalid(inspection.issues);
  }
  const fields = inspection.fields;
  const issues: ValidationIssue[] = [];

  const schemaVersion = readString(fields, "schemaVersion", path, issues);
  if (schemaVersion !== undefined && schemaVersion !== ACTION_OBSERVATION_SCHEMA_VERSION) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.enumViolation,
        `${path}.schemaVersion`,
        `Unsupported ActionObservation schemaVersion "${safeFormatValue(schemaVersion)}".`,
      ),
    );
  }

  const id = readString(fields, "id", path, issues);
  if (id !== undefined && !FC008_ID_REGEX.test(id)) {
    issues.push(
      issue(
        FC008_VALIDATION_CODES.patternViolation,
        `${path}.id`,
        "id must be an opaque bounded identifier.",
      ),
    );
  }

  const declaredFingerprint = readString(fields, "inputFingerprint", path, issues);

  const semanticsResult = validateSemantics(fields.get("semantics"), `${path}.semantics`);
  if (!semanticsResult.valid) {
    issues.push(...semanticsResult.issues);
  }

  const acquisitionResult = validateAcquisition(fields.get("acquisition"), `${path}.acquisition`);
  if (!acquisitionResult.valid) {
    issues.push(...acquisitionResult.issues);
  }

  const redactionResult = validateRedaction(fields.get("redaction"), `${path}.redaction`);
  if (!redactionResult.valid) {
    issues.push(...redactionResult.issues);
  }

  const freshnessResult = validateFreshnessBinding(fields.get("freshness"), `${path}.freshness`);
  if (!freshnessResult.valid) {
    issues.push(...freshnessResult.issues);
  }

  const provenanceResult = validateObservationProvenance(
    fields.get("provenance"),
    `${path}.provenance`,
  );
  if (!provenanceResult.valid) {
    issues.push(...provenanceResult.issues);
  }

  let benchmark: BenchmarkMetadata | null = null;
  const rawBenchmark = fields.get("benchmark");
  if (rawBenchmark !== null) {
    const benchmarkResult = validateBenchmark(rawBenchmark, `${path}.benchmark`);
    if (!benchmarkResult.valid) {
      issues.push(...benchmarkResult.issues);
    } else {
      benchmark = benchmarkResult.value;
    }
  }

  if (
    issues.length > 0 ||
    id === undefined ||
    declaredFingerprint === undefined ||
    !semanticsResult.valid ||
    !acquisitionResult.valid ||
    !redactionResult.valid ||
    !freshnessResult.valid ||
    !provenanceResult.valid
  ) {
    return invalid(issues);
  }

  const recomputed = computeObservationInputFingerprint(
    semanticsResult.value,
    acquisitionResult.value,
  );
  if (!recomputed.ok) {
    return invalid([
      issue(
        FC008_VALIDATION_CODES.invariantViolation,
        `${path}.inputFingerprint`,
        `Fingerprint could not be computed (${recomputed.error}).`,
      ),
    ]);
  }
  if (recomputed.fingerprint !== declaredFingerprint) {
    return invalid([
      issue(
        FC008_VALIDATION_CODES.invariantViolation,
        `${path}.inputFingerprint`,
        "Declared inputFingerprint does not match the canonical encoding of the validated observation.",
      ),
    ]);
  }

  const observation: ActionObservation = {
    schemaVersion: ACTION_OBSERVATION_SCHEMA_VERSION,
    id: id as ActionObservationId,
    semantics: semanticsResult.value,
    acquisition: acquisitionResult.value,
    benchmark,
    redaction: redactionResult.value,
    freshness: freshnessResult.value,
    provenance: provenanceResult.value,
    inputFingerprint: recomputed.fingerprint,
  };

  return valid(Object.freeze(observation));
}

/**
 * Layer property names that actually appear on `ActionObservation`.
 *
 * Layer D is absent by design, so this list has three entries, not four. The
 * layering tests assert both that exactly one of these is reachable from the
 * projector signature and that no display key appears here at all.
 */
export const OBSERVATION_LAYER_KEYS = Object.freeze({
  acquisition: "acquisition",
  semantics: "semantics",
  benchmark: "benchmark",
} as const);

/** Keys that must never appear on `ActionObservation`. Asserted by test. */
export const OBSERVATION_FORBIDDEN_KEYS = Object.freeze([
  "display",
  "objectLabel",
  "surfaceTitle",
  "retentionPolicy",
  "oracleClass",
  "resolvedOracleClass",
  "groundTruthClass",
] as const);
