/**
 * Dependency-free runtime validation for FutureClick canonical domain models (Sprint FC-002 / FC-002A / FC-002B).
 *
 * Implements two layers:
 * 1. Structural Validation: Exact primitive types, recognized enums, canonical timestamps,
 *    bounded confidence, dense arrays, and JSON-safe values.
 * 2. Cross-Object Semantic Validation: Environment compatibility, ID uniqueness, action-consequence
 *    correlation, evidence uniqueness, entity reference checks, and chronology invariants.
 *
 * Architectural Invariants:
 * - Validators NEVER throw on untrusted input; hostile getters, throwing prototypes, and malformed inputs
 *   fail closed and are captured as structured ValidationIssue records.
 * - Validation results are trusted immutable SNAPSHOTS of the exact validated data, completely
 *   detached from accessor getters or runtime mutations on the original input object.
 * - Properties are read at most ONCE using safe own-property inspection.
 */

import { isValidIsoTimestamp } from "@futureclick/shared";
import {
  MAX_JSON_VALUE_DEPTH,
  captureDenseArray,
  deepFreezeCanonical,
  isDenseArray,
  isPlainObject,
  validateJsonValue,
} from "./json.js";
import {
  ACTION_EXECUTION_STATUSES,
  ACTION_TARGET_ROLES,
  ACTION_VERBS,
  ACTOR_KINDS,
  ASSUMPTION_STATUSES,
  CONSEQUENCE_CATEGORIES,
  DOMAIN_KIND_REGEX,
  ENVIRONMENT_KINDS,
  EVIDENCE_MODES,
  FUTURECLICK_SCHEMA_VERSION,
  KNOWN_ENTITY_KINDS,
  PROVENANCE_SOURCES,
  REVERSIBILITY_LEVELS,
  RISK_CATEGORIES,
  RISK_SEVERITIES,
  STATE_CHANGE_OPERATIONS,
  SUPPORTED_PLATFORMS,
  TEMPORAL_FREQUENCIES,
  TEMPORAL_TIMINGS,
  isValidConfidenceScore,
} from "./types.js";
import type {
  ActionActor,
  ActionEvaluationContext,
  ActionExecutionStatus,
  ActionId,
  ActionIntent,
  ActionTarget,
  ActionTargetRole,
  ActionVerb,
  ActorKind,
  ApplicationDescriptor,
  AssessmentId,
  Assumption,
  AssumptionStatus,
  CanonicalEntity,
  ConfidenceScore,
  Consequence,
  ConsequenceAssessment,
  ConsequenceCategory,
  ConsequenceId,
  EntityId,
  EntityKind,
  EnvironmentDescriptor,
  EnvironmentKind,
  EvaluationContextId,
  EvidenceId,
  EvidenceMode,
  EvidenceRecord,
  ObservationId,
  ProposedAction,
  ProvenanceDescriptor,
  ProvenanceSourceKind,
  ReversibilityDescriptor,
  ReversibilityLevel,
  RiskCategory,
  RiskDescriptor,
  RiskSeverity,
  SchemaVersion,
  StateChange,
  StateChangeOperation,
  StateFact,
  StateSnapshot,
  StateSnapshotId,
  SupportedPlatform,
  TemporalDescriptor,
  TemporalFrequency,
  TemporalTiming,
  ValueState,
} from "./types.js";

export type ValidationIssueSeverity = "error" | "warning";

export type ValidationIssueCode =
  | "INVALID_SCHEMA_VERSION"
  | "INVALID_TYPE"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_TIMESTAMP"
  | "INVALID_CONFIDENCE"
  | "INVALID_JSON_VALUE"
  | "INVALID_ENUM_VALUE"
  | "INVALID_ID"
  | "INVALID_FACT_KEY"
  | "DUPLICATE_ENTITY_ID"
  | "DUPLICATE_FACT_ID"
  | "DUPLICATE_EVIDENCE_ID"
  | "DUPLICATE_CONSEQUENCE_ID"
  | "DUPLICATE_TARGET_PAIR"
  | "DUPLICATE_AFFECTED_ENTITY"
  | "MISSING_AFFECTED_ENTITY"
  | "UNKNOWN_ENTITY_REFERENCE"
  | "ENVIRONMENT_MISMATCH"
  | "ACTION_ID_MISMATCH"
  | "ASSESSMENT_CONTEXT_MISMATCH"
  | "CHRONOLOGY_VIOLATION"
  | "INVALID_STATE_CHANGE_TRANSITION"
  | "INVALID_REVERSIBILITY_DESCRIPTOR"
  | "INVALID_RISK_DESCRIPTOR"
  | "CYCLE_DETECTED"
  | "MAX_DEPTH_EXCEEDED"
  | "UNEXPECTED_ERROR";

export interface ValidationIssue {
  readonly code: ValidationIssueCode | string;
  readonly path: string;
  readonly message: string;
  readonly severity: ValidationIssueSeverity;
}

export type ValidationResult<T> =
  | {
      readonly valid: true;
      readonly value: T;
      readonly issues: readonly ValidationIssue[];
    }
  | {
      readonly valid: false;
      readonly issues: readonly ValidationIssue[];
    };

// ============================================================================
// SAFE PROPERTY ACCESS MODEL (FC-002B)
// ============================================================================

export type SafePropertyRead =
  | { readonly status: "absent" }
  | { readonly status: "present"; readonly value: unknown }
  | { readonly status: "error" };

/**
 * Safely inspects an own property on target and invokes its getter at most once.
 * Distinguishes absent, present, and read-error states without throwing.
 */
export function readOwnProperty(target: unknown, key: PropertyKey): SafePropertyRead {
  if (typeof target !== "object" || target === null) {
    return { status: "absent" };
  }
  try {
    const hasOwn = Object.prototype.hasOwnProperty.call(target, key);
    if (!hasOwn) {
      return { status: "absent" };
    }
    const value = (target as Record<PropertyKey, unknown>)[key];
    return { status: "present", value };
  } catch {
    return { status: "error" };
  }
}

export function safeHasOwn(target: unknown, key: PropertyKey): boolean {
  return readOwnProperty(target, key).status === "present";
}

export interface SafePropResult {
  readonly ok: boolean;
  readonly value: unknown;
}

export function safeGet(target: unknown, key: PropertyKey): SafePropResult {
  const read = readOwnProperty(target, key);
  if (read.status === "present") {
    return { ok: true, value: read.value };
  }
  return { ok: false, value: undefined };
}

function requireProperty(
  input: unknown,
  key: string,
  path: string,
  issues: ValidationIssue[],
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  const prop = readOwnProperty(input, key);
  if (prop.status === "absent") {
    issues.push({
      code: "MISSING_REQUIRED_FIELD",
      path: `${path}.${key}`,
      message: `Required field "${key}" is missing.`,
      severity: "error",
    });
    return { ok: false };
  }
  if (prop.status === "error") {
    issues.push({
      code: "INVALID_TYPE",
      path: `${path}.${key}`,
      message: `Failed to read required property "${key}".`,
      severity: "error",
    });
    return { ok: false };
  }
  return { ok: true, value: prop.value };
}

function readOptionalProperty(
  input: unknown,
  key: string,
  path: string,
  issues: ValidationIssue[],
):
  | { readonly status: "absent" }
  | { readonly status: "present"; readonly value: unknown }
  | { readonly status: "error" } {
  const prop = readOwnProperty(input, key);
  if (prop.status === "absent") {
    return { status: "absent" };
  }
  if (prop.status === "error") {
    issues.push({
      code: "INVALID_TYPE",
      path: `${path}.${key}`,
      message: `Failed to read optional property "${key}".`,
      severity: "error",
    });
    return { status: "error" };
  }
  if (prop.value === undefined) {
    issues.push({
      code: "INVALID_TYPE",
      path: `${path}.${key}`,
      message: `Optional property "${key}" is present with value undefined, which is not permitted.`,
      severity: "error",
    });
    return { status: "error" };
  }
  return { status: "present", value: prop.value };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export const FACT_KEY_REGEX = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

const VALID_PLATFORMS = new Set<string>(SUPPORTED_PLATFORMS);
const VALID_ENV_KINDS = new Set<string>(ENVIRONMENT_KINDS);
const VALID_ENTITY_KINDS = new Set<string>(KNOWN_ENTITY_KINDS);
const VALID_ACTOR_KINDS = new Set<string>(ACTOR_KINDS);
const VALID_ACTION_VERBS = new Set<string>(ACTION_VERBS);
const VALID_TARGET_ROLES = new Set<string>(ACTION_TARGET_ROLES);
const VALID_EXEC_STATUSES = new Set<string>(ACTION_EXECUTION_STATUSES);
const VALID_CONSEQUENCE_CATEGORIES = new Set<string>(CONSEQUENCE_CATEGORIES);
const VALID_STATE_CHANGE_OPS = new Set<string>(STATE_CHANGE_OPERATIONS);
const VALID_REVERSIBILITY_LEVELS = new Set<string>(REVERSIBILITY_LEVELS);
const VALID_RISK_SEVERITIES = new Set<string>(RISK_SEVERITIES);
const VALID_RISK_CATEGORIES = new Set<string>(RISK_CATEGORIES);
const VALID_EVIDENCE_MODES = new Set<string>(EVIDENCE_MODES);
const VALID_ASSUMPTION_STATUSES = new Set<string>(ASSUMPTION_STATUSES);
const VALID_PROVENANCE_SOURCES = new Set<string>(PROVENANCE_SOURCES);
const VALID_TEMPORAL_TIMINGS = new Set<string>(TEMPORAL_TIMINGS);
const VALID_TEMPORAL_FREQUENCIES = new Set<string>(TEMPORAL_FREQUENCIES);

// ============================================================================
// 1. PRIMITIVE & SCALAR VALIDATORS
// ============================================================================

export function validateSchemaVersion(
  input: unknown,
  path = "schemaVersion",
): ValidationResult<SchemaVersion> {
  if (input !== FUTURECLICK_SCHEMA_VERSION) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_SCHEMA_VERSION",
          path,
          message: `Expected schemaVersion "${FUTURECLICK_SCHEMA_VERSION}", received unsupported version.`,
          severity: "error",
        },
      ],
    };
  }
  return { valid: true, issues: [], value: FUTURECLICK_SCHEMA_VERSION };
}

export function validateId<T extends string>(
  input: unknown,
  idKind = "ID",
  path = "id",
): ValidationResult<T> {
  if (typeof input !== "string") {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_TYPE",
          path,
          message: `${idKind} must be a string.`,
          severity: "error",
        },
      ],
    };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_ID",
          path,
          message: `${idKind} must not be empty or whitespace-only.`,
          severity: "error",
        },
      ],
    };
  }
  if (trimmed.length > 128) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_ID",
          path,
          message: `${idKind} exceeds maximum length of 128 characters.`,
          severity: "error",
        },
      ],
    };
  }
  return { valid: true, issues: [], value: trimmed as T };
}

export function validateIsoTimestamp(
  input: unknown,
  path = "timestamp",
): ValidationResult<import("@futureclick/shared").IsoTimestamp> {
  if (typeof input !== "string") {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_TYPE",
          path,
          message: "Timestamp must be a string.",
          severity: "error",
        },
      ],
    };
  }
  if (!isValidIsoTimestamp(input)) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_TIMESTAMP",
          path,
          message: "Timestamp must be a valid ISO 8601 UTC string (YYYY-MM-DDTHH:mm:ss.sssZ).",
          severity: "error",
        },
      ],
    };
  }
  return {
    valid: true,
    issues: [],
    value: input as import("@futureclick/shared").IsoTimestamp,
  };
}

export function validateConfidenceScore(
  input: unknown,
  path = "confidence",
): ValidationResult<ConfidenceScore> {
  if (typeof input !== "number") {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_TYPE",
          path,
          message: "Confidence must be a finite number.",
          severity: "error",
        },
      ],
    };
  }
  if (!isValidConfidenceScore(input)) {
    return {
      valid: false,
      issues: [
        {
          code: "INVALID_CONFIDENCE",
          path,
          message: "Confidence score must be a finite number between 0.0 and 1.0 inclusive.",
          severity: "error",
        },
      ],
    };
  }
  return { valid: true, issues: [], value: input as ConfidenceScore };
}

export const validateConfidence = validateConfidenceScore;

// ============================================================================
// 2. ENVIRONMENT MODEL
// ============================================================================

export function validateApplicationDescriptor(
  input: unknown,
  path = "application",
): ValidationResult<ApplicationDescriptor> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "ApplicationDescriptor must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const nameProp = requireProperty(input, "name", path, issues);
    let validName: string | undefined;
    if (nameProp.ok) {
      if (typeof nameProp.value !== "string" || nameProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.name`,
          message: "Application name must be a non-empty string.",
          severity: "error",
        });
      } else {
        validName = nameProp.value.trim();
      }
    }

    let validId: string | undefined;
    const idProp = readOptionalProperty(input, "id", path, issues);
    if (idProp.status === "present") {
      if (typeof idProp.value !== "string" || idProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_ID",
          path: `${path}.id`,
          message: "Application ID must be a non-empty, non-whitespace string.",
          severity: "error",
        });
      } else {
        validId = idProp.value.trim();
      }
    }

    let validVersion: string | undefined;
    const verProp = readOptionalProperty(input, "version", path, issues);
    if (verProp.status === "present") {
      if (typeof verProp.value !== "string" || verProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.version`,
          message: "Application version must be a non-empty, non-whitespace string.",
          severity: "error",
        });
      } else {
        validVersion = verProp.value.trim();
      }
    }

    if (issues.length > 0 || validName === undefined) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        name: validName,
        ...(validId !== undefined ? { id: validId } : {}),
        ...(validVersion !== undefined ? { version: validVersion } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "Application validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateEnvironmentDescriptor(
  input: unknown,
  path = "environment",
): ValidationResult<EnvironmentDescriptor> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "Environment descriptor must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const envIdProp = requireProperty(input, "environmentId", path, issues);
    let validEnvId: string | undefined;
    if (envIdProp.ok) {
      if (typeof envIdProp.value !== "string" || envIdProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_ID",
          path: `${path}.environmentId`,
          message: "Environment ID must be a non-empty, non-whitespace string.",
          severity: "error",
        });
      } else {
        validEnvId = envIdProp.value.trim();
      }
    }

    const kindProp = requireProperty(input, "kind", path, issues);
    let validKind: EnvironmentKind | undefined;
    if (kindProp.ok) {
      if (typeof kindProp.value !== "string" || !VALID_ENV_KINDS.has(kindProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.kind`,
          message:
            "Environment kind must be one of: 'browser', 'desktop', 'terminal', 'filesystem', 'application', 'service', 'unknown'.",
          severity: "error",
        });
      } else {
        validKind = kindProp.value as EnvironmentKind;
      }
    }

    const platProp = requireProperty(input, "platform", path, issues);
    let validPlatform: SupportedPlatform | undefined;
    if (platProp.ok) {
      if (typeof platProp.value !== "string" || !VALID_PLATFORMS.has(platProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.platform`,
          message:
            "Environment platform must be one of: 'macos', 'windows', 'linux', 'web', 'unknown'.",
          severity: "error",
        });
      } else {
        validPlatform = platProp.value as SupportedPlatform;
      }
    }

    const appProp = requireProperty(input, "application", path, issues);
    let validApp: ApplicationDescriptor | undefined;
    if (appProp.ok) {
      const appRes = validateApplicationDescriptor(appProp.value, `${path}.application`);
      if (!appRes.valid) {
        issues.push(...appRes.issues);
      } else {
        validApp = appRes.value;
      }
    }

    let validSessionId: string | undefined;
    const sessProp = readOptionalProperty(input, "sessionId", path, issues);
    if (sessProp.status === "present") {
      if (typeof sessProp.value !== "string" || sessProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_ID",
          path: `${path}.sessionId`,
          message: "Session ID must be a non-empty, non-whitespace string.",
          severity: "error",
        });
      } else {
        validSessionId = sessProp.value.trim();
      }
    }

    if (
      issues.length > 0 ||
      validEnvId === undefined ||
      validKind === undefined ||
      validPlatform === undefined ||
      validApp === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        environmentId: validEnvId,
        kind: validKind,
        platform: validPlatform,
        application: validApp,
        ...(validSessionId !== undefined ? { sessionId: validSessionId } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "Environment descriptor validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

// ============================================================================
// 3. CANONICAL ENTITY & FACT MODEL
// ============================================================================

export function validateCanonicalEntity(
  input: unknown,
  path = "entity",
): ValidationResult<CanonicalEntity> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "Canonical entity must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const idProp = requireProperty(input, "id", path, issues);
    let validId: EntityId | undefined;
    if (idProp.ok) {
      const idRes = validateId<EntityId>(idProp.value, "Entity", `${path}.id`);
      if (!idRes.valid) {
        issues.push(...idRes.issues);
      } else {
        validId = idRes.value;
      }
    }

    const kindProp = requireProperty(input, "kind", path, issues);
    let validKind: EntityKind | undefined;
    if (kindProp.ok) {
      if (typeof kindProp.value !== "string" || !VALID_ENTITY_KINDS.has(kindProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.kind`,
          message:
            "Entity kind must be one of: 'file', 'folder', 'ui_control', 'document', 'repository', 'message', 'account', 'permission', 'application', 'process', 'subscription', 'form', 'resource', 'other'.",
          severity: "error",
        });
      } else {
        validKind = kindProp.value as EntityKind;
      }
    }

    let validDomainKind: string | undefined;
    const domainKindProp = readOptionalProperty(input, "domainKind", path, issues);
    if (validKind === "other") {
      if (domainKindProp.status === "absent") {
        issues.push({
          code: "MISSING_REQUIRED_FIELD",
          path: `${path}.domainKind`,
          message:
            "CanonicalEntity with kind 'other' requires a namespaced domainKind (e.g. 'custom.resource').",
          severity: "error",
        });
      } else if (domainKindProp.status === "present") {
        if (
          typeof domainKindProp.value !== "string" ||
          !DOMAIN_KIND_REGEX.test(domainKindProp.value)
        ) {
          issues.push({
            code: "INVALID_TYPE",
            path: `${path}.domainKind`,
            message:
              "domainKind must follow namespaced convention 'domain.specialization' (e.g. 'vendor.resource').",
            severity: "error",
          });
        } else {
          validDomainKind = domainKindProp.value;
        }
      }
    } else if (domainKindProp.status === "present") {
      issues.push({
        code: "INVALID_TYPE",
        path: `${path}.domainKind`,
        message: `domainKind is not allowed when entity kind is '${validKind ?? "non-other"}'; domainKind is only permitted when kind is 'other'.`,
        severity: "error",
      });
    }

    let validLabel: string | undefined;
    const labelProp = readOptionalProperty(input, "label", path, issues);
    if (labelProp.status === "present") {
      if (typeof labelProp.value !== "string" || labelProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.label`,
          message: "Entity label must be a non-empty string.",
          severity: "error",
        });
      } else {
        validLabel = labelProp.value.trim();
      }
    }

    let validAttrs: Readonly<Record<string, import("./types.js").JsonValue>> | undefined;
    const attrProp = readOptionalProperty(input, "attributes", path, issues);
    if (attrProp.status === "present") {
      const jsonRes = validateJsonValue(attrProp.value, {
        requireObject: true,
        maxDepth: MAX_JSON_VALUE_DEPTH,
        path: `${path}.attributes`,
      });
      if (!jsonRes.valid) {
        issues.push(
          ...jsonRes.issues.map((i) => ({
            code: i.code,
            path: i.path,
            message: i.message,
            severity: "error" as const,
          })),
        );
      } else {
        validAttrs = jsonRes.value as Readonly<Record<string, import("./types.js").JsonValue>>;
      }
    }

    if (issues.length > 0 || validId === undefined || validKind === undefined) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        id: validId,
        kind: validKind,
        ...(validDomainKind !== undefined ? { domainKind: validDomainKind } : {}),
        ...(validLabel !== undefined ? { label: validLabel } : {}),
        ...(validAttrs !== undefined ? { attributes: validAttrs } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "Canonical entity validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateStateFact(input: unknown, path = "fact"): ValidationResult<StateFact> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "State fact must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const idProp = requireProperty(input, "id", path, issues);
    let validId: ObservationId | undefined;
    if (idProp.ok) {
      const idRes = validateId<ObservationId>(idProp.value, "Observation", `${path}.id`);
      if (!idRes.valid) {
        issues.push(...idRes.issues);
      } else {
        validId = idRes.value;
      }
    }

    const subjProp = requireProperty(input, "subjectEntityId", path, issues);
    let validSubj: EntityId | undefined;
    if (subjProp.ok) {
      const subjRes = validateId<EntityId>(
        subjProp.value,
        "SubjectEntity",
        `${path}.subjectEntityId`,
      );
      if (!subjRes.valid) {
        issues.push(...subjRes.issues);
      } else {
        validSubj = subjRes.value;
      }
    }

    const keyProp = requireProperty(input, "key", path, issues);
    let validKey: string | undefined;
    if (keyProp.ok) {
      if (typeof keyProp.value !== "string") {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.key`,
          message: "State fact key must be a string.",
          severity: "error",
        });
      } else if (!FACT_KEY_REGEX.test(keyProp.value)) {
        issues.push({
          code: "INVALID_FACT_KEY",
          path: `${path}.key`,
          message:
            "State fact key must follow namespaced convention 'namespace.property' (e.g. 'file.size').",
          severity: "error",
        });
      } else {
        validKey = keyProp.value;
      }
    }

    const valProp = requireProperty(input, "value", path, issues);
    let validVal: import("./types.js").JsonValue | undefined;
    if (valProp.ok) {
      const jsonRes = validateJsonValue(valProp.value, {
        path: `${path}.value`,
        maxDepth: MAX_JSON_VALUE_DEPTH,
      });
      if (!jsonRes.valid) {
        issues.push(
          ...jsonRes.issues.map((i) => ({
            code: i.code,
            path: i.path,
            message: i.message,
            severity: "error" as const,
          })),
        );
      } else {
        validVal = jsonRes.value;
      }
    }

    let validObservedAt: import("@futureclick/shared").IsoTimestamp | undefined;
    const obsProp = readOptionalProperty(input, "observedAt", path, issues);
    if (obsProp.status === "present") {
      const tsRes = validateIsoTimestamp(obsProp.value, `${path}.observedAt`);
      if (!tsRes.valid) {
        issues.push(...tsRes.issues);
      } else {
        validObservedAt = tsRes.value;
      }
    }

    let validEvidence: EvidenceRecord[] | undefined;
    const evProp = readOptionalProperty(input, "evidence", path, issues);
    if (evProp.status === "present") {
      const evCapture = captureDenseArray(evProp.value);
      if (!evCapture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.evidence`,
          message: "Fact evidence must be a dense array of EvidenceRecord objects.",
          severity: "error",
        });
      } else {
        const rawEvList = evCapture.values;
        const evList: EvidenceRecord[] = [];
        const seenEvIds = new Set<string>();
        for (let i = 0; i < rawEvList.length; i++) {
          const evItem = rawEvList[i];
          const evRes = validateEvidenceRecord(evItem, `${path}.evidence[${i}]`);
          if (!evRes.valid) {
            issues.push(...evRes.issues);
          } else if (seenEvIds.has(evRes.value.id)) {
            issues.push({
              code: "DUPLICATE_EVIDENCE_ID",
              path: `${path}.evidence[${i}].id`,
              message: `Duplicate evidence ID "${evRes.value.id}" within fact evidence.`,
              severity: "error",
            });
          } else {
            seenEvIds.add(evRes.value.id);
            evList.push(evRes.value);
          }
        }
        validEvidence = evList;
      }
    }

    if (
      issues.length > 0 ||
      validId === undefined ||
      validSubj === undefined ||
      validKey === undefined ||
      validVal === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        id: validId,
        subjectEntityId: validSubj,
        key: validKey,
        value: validVal,
        ...(validObservedAt !== undefined ? { observedAt: validObservedAt } : {}),
        ...(validEvidence !== undefined ? { evidence: validEvidence } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "State fact validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateStateSnapshot(
  input: unknown,
  path = "state",
): ValidationResult<StateSnapshot> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "State snapshot must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const versionProp = requireProperty(input, "schemaVersion", path, issues);
    let validVersion: SchemaVersion | undefined;
    if (versionProp.ok) {
      const versionRes = validateSchemaVersion(versionProp.value, `${path}.schemaVersion`);
      if (!versionRes.valid) {
        issues.push(...versionRes.issues);
      } else {
        validVersion = versionRes.value;
      }
    }

    const idProp = requireProperty(input, "id", path, issues);
    let validId: StateSnapshotId | undefined;
    if (idProp.ok) {
      const idRes = validateId<StateSnapshotId>(idProp.value, "StateSnapshot", `${path}.id`);
      if (!idRes.valid) {
        issues.push(...idRes.issues);
      } else {
        validId = idRes.value;
      }
    }

    const obsProp = requireProperty(input, "observedAt", path, issues);
    let validObservedAt: import("@futureclick/shared").IsoTimestamp | undefined;
    if (obsProp.ok) {
      const tsRes = validateIsoTimestamp(obsProp.value, `${path}.observedAt`);
      if (!tsRes.valid) {
        issues.push(...tsRes.issues);
      } else {
        validObservedAt = tsRes.value;
      }
    }

    const envProp = requireProperty(input, "environment", path, issues);
    let validEnv: EnvironmentDescriptor | undefined;
    if (envProp.ok) {
      const envRes = validateEnvironmentDescriptor(envProp.value, `${path}.environment`);
      if (!envRes.valid) {
        issues.push(...envRes.issues);
      } else {
        validEnv = envRes.value;
      }
    }

    const entities: CanonicalEntity[] = [];
    const entityIds = new Set<string>();
    const entProp = requireProperty(input, "entities", path, issues);
    if (entProp.ok) {
      const entCapture = captureDenseArray(entProp.value);
      if (!entCapture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.entities`,
          message: "State snapshot entities must be a dense array.",
          severity: "error",
        });
      } else {
        const rawEntities = entCapture.values;
        for (let i = 0; i < rawEntities.length; i++) {
          const entItem = rawEntities[i];
          const entRes = validateCanonicalEntity(entItem, `${path}.entities[${i}]`);
          if (!entRes.valid) {
            issues.push(...entRes.issues);
          } else if (entityIds.has(entRes.value.id)) {
            issues.push({
              code: "DUPLICATE_ENTITY_ID",
              path: `${path}.entities[${i}].id`,
              message: `Duplicate entity ID "${entRes.value.id}" in state snapshot.`,
              severity: "error",
            });
          } else {
            entityIds.add(entRes.value.id);
            entities.push(entRes.value);
          }
        }
      }
    }

    const facts: StateFact[] = [];
    const factIds = new Set<string>();
    const factEvidenceIds = new Set<string>();
    const factsProp = requireProperty(input, "facts", path, issues);
    if (factsProp.ok) {
      const factsCapture = captureDenseArray(factsProp.value);
      if (!factsCapture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.facts`,
          message: "State snapshot facts must be a dense array.",
          severity: "error",
        });
      } else {
        const rawFacts = factsCapture.values;
        for (let i = 0; i < rawFacts.length; i++) {
          const factItem = rawFacts[i];
          const factRes = validateStateFact(factItem, `${path}.facts[${i}]`);
          if (!factRes.valid) {
            issues.push(...factRes.issues);
          } else {
            // Check duplicate fact ID
            if (factIds.has(factRes.value.id)) {
              issues.push({
                code: "DUPLICATE_FACT_ID",
                path: `${path}.facts[${i}].id`,
                message: `Duplicate fact ID "${factRes.value.id}" in state snapshot.`,
                severity: "error",
              });
            } else {
              factIds.add(factRes.value.id);
            }

            // Check fact subject entity exists in snapshot entities (enforced unconditionally, including zero-entity snapshots)
            if (!entityIds.has(factRes.value.subjectEntityId)) {
              issues.push({
                code: "UNKNOWN_ENTITY_REFERENCE",
                path: `${path}.facts[${i}].subjectEntityId`,
                message: `Fact references unknown entity ID "${factRes.value.subjectEntityId}" not found in snapshot entities.`,
                severity: "error",
              });
            }

            // Standalone Check: Check duplicate EvidenceId across ALL facts in this snapshot (M1 / 23)
            if (factRes.value.evidence) {
              for (let j = 0; j < factRes.value.evidence.length; j++) {
                const ev = factRes.value.evidence[j];
                if (ev && factEvidenceIds.has(ev.id)) {
                  issues.push({
                    code: "DUPLICATE_EVIDENCE_ID",
                    path: `${path}.facts[${i}].evidence[${j}].id`,
                    message: `Duplicate evidence ID "${ev.id}" across state facts in snapshot.`,
                    severity: "error",
                  });
                } else if (ev) {
                  factEvidenceIds.add(ev.id);
                }
              }
            }

            facts.push(factRes.value);
          }
        }
      }
    }

    let validProvenance: ProvenanceDescriptor | undefined;
    const provProp = readOptionalProperty(input, "provenance", path, issues);
    if (provProp.status === "present") {
      const provRes = validateProvenanceDescriptor(provProp.value, `${path}.provenance`);
      if (!provRes.valid) {
        issues.push(...provRes.issues);
      } else {
        validProvenance = provRes.value;
      }
    }

    if (
      issues.length > 0 ||
      validVersion === undefined ||
      validId === undefined ||
      validObservedAt === undefined ||
      validEnv === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        schemaVersion: validVersion,
        id: validId,
        observedAt: validObservedAt,
        environment: validEnv,
        entities,
        facts,
        ...(validProvenance !== undefined ? { provenance: validProvenance } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "State snapshot validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

// ============================================================================
// 4. ACTION MODEL
// ============================================================================

export function validateActionActor(input: unknown, path = "actor"): ValidationResult<ActionActor> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "ActionActor must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const kindProp = requireProperty(input, "kind", path, issues);
    let validKind: ActorKind | undefined;
    if (kindProp.ok) {
      if (typeof kindProp.value !== "string" || !VALID_ACTOR_KINDS.has(kindProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.kind`,
          message: "Actor kind must be one of: 'human', 'system', 'agent', 'unknown'.",
          severity: "error",
        });
      } else {
        validKind = kindProp.value as ActorKind;
      }
    }

    let validId: string | undefined;
    const idProp = readOptionalProperty(input, "id", path, issues);
    if (idProp.status === "present") {
      if (typeof idProp.value !== "string" || idProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_ID",
          path: `${path}.id`,
          message: "Actor ID must be a non-empty, non-whitespace string.",
          severity: "error",
        });
      } else {
        validId = idProp.value.trim();
      }
    }

    if (issues.length > 0 || validKind === undefined) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        kind: validKind,
        ...(validId !== undefined ? { id: validId } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "ActionActor validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateActionIntent(
  input: unknown,
  path = "intent",
): ValidationResult<ActionIntent> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "ActionIntent must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const verbProp = requireProperty(input, "verb", path, issues);
    let validVerb: ActionVerb | undefined;
    if (verbProp.ok) {
      if (typeof verbProp.value !== "string" || !VALID_ACTION_VERBS.has(verbProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.verb`,
          message: `Invalid action verb: ${typeof verbProp.value === "string" ? verbProp.value : "non-string"}.`,
          severity: "error",
        });
      } else {
        validVerb = verbProp.value as ActionVerb;
      }
    }

    let validDomain: string | undefined;
    const domainProp = readOptionalProperty(input, "domain", path, issues);
    if (domainProp.status === "present") {
      if (typeof domainProp.value !== "string" || domainProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.domain`,
          message: "Action domain must be a non-empty string.",
          severity: "error",
        });
      } else {
        validDomain = domainProp.value.trim();
      }
    }

    if (issues.length > 0 || validVerb === undefined) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        verb: validVerb,
        ...(validDomain !== undefined ? { domain: validDomain } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "ActionIntent validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateActionTarget(
  input: unknown,
  path = "target",
): ValidationResult<ActionTarget> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "ActionTarget must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const entProp = requireProperty(input, "entityId", path, issues);
    let validEntityId: EntityId | undefined;
    if (entProp.ok) {
      const idRes = validateId<EntityId>(entProp.value, "TargetEntity", `${path}.entityId`);
      if (!idRes.valid) {
        issues.push(...idRes.issues);
      } else {
        validEntityId = idRes.value;
      }
    }

    const roleProp = requireProperty(input, "role", path, issues);
    let validRole: ActionTargetRole | undefined;
    if (roleProp.ok) {
      if (typeof roleProp.value !== "string" || !VALID_TARGET_ROLES.has(roleProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.role`,
          message:
            "Target role must be one of: 'primary', 'source', 'destination', 'recipient', 'container', 'account', 'resource', 'subject', 'other'.",
          severity: "error",
        });
      } else {
        validRole = roleProp.value as ActionTargetRole;
      }
    }

    if (issues.length > 0 || validEntityId === undefined || validRole === undefined) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        entityId: validEntityId,
        role: validRole,
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "ActionTarget validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateProposedAction(
  input: unknown,
  path = "action",
): ValidationResult<ProposedAction> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "Proposed action must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const versionProp = requireProperty(input, "schemaVersion", path, issues);
    let validVersion: SchemaVersion | undefined;
    if (versionProp.ok) {
      const versionRes = validateSchemaVersion(versionProp.value, `${path}.schemaVersion`);
      if (!versionRes.valid) {
        issues.push(...versionRes.issues);
      } else {
        validVersion = versionRes.value;
      }
    }

    const idProp = requireProperty(input, "id", path, issues);
    let validId: ActionId | undefined;
    if (idProp.ok) {
      const idRes = validateId<ActionId>(idProp.value, "Action", `${path}.id`);
      if (!idRes.valid) {
        issues.push(...idRes.issues);
      } else {
        validId = idRes.value;
      }
    }

    const propProp = requireProperty(input, "proposedAt", path, issues);
    let validProposedAt: import("@futureclick/shared").IsoTimestamp | undefined;
    if (propProp.ok) {
      const tsRes = validateIsoTimestamp(propProp.value, `${path}.proposedAt`);
      if (!tsRes.valid) {
        issues.push(...tsRes.issues);
      } else {
        validProposedAt = tsRes.value;
      }
    }

    const envProp = requireProperty(input, "environment", path, issues);
    let validEnv: EnvironmentDescriptor | undefined;
    if (envProp.ok) {
      const envRes = validateEnvironmentDescriptor(envProp.value, `${path}.environment`);
      if (!envRes.valid) {
        issues.push(...envRes.issues);
      } else {
        validEnv = envRes.value;
      }
    }

    const actorProp = requireProperty(input, "actor", path, issues);
    let validActor: ActionActor | undefined;
    if (actorProp.ok) {
      const actorRes = validateActionActor(actorProp.value, `${path}.actor`);
      if (!actorRes.valid) {
        issues.push(...actorRes.issues);
      } else {
        validActor = actorRes.value;
      }
    }

    const intentProp = requireProperty(input, "intent", path, issues);
    let validIntent: ActionIntent | undefined;
    if (intentProp.ok) {
      const intentRes = validateActionIntent(intentProp.value, `${path}.intent`);
      if (!intentRes.valid) {
        issues.push(...intentRes.issues);
      } else {
        validIntent = intentRes.value;
      }
    }

    const targets: ActionTarget[] = [];
    const tgtsProp = requireProperty(input, "targets", path, issues);
    if (tgtsProp.ok) {
      const tgtsCapture = captureDenseArray(tgtsProp.value);
      if (!tgtsCapture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.targets`,
          message: "Action targets must be a dense array of ActionTarget objects.",
          severity: "error",
        });
      } else {
        const rawTgts = tgtsCapture.values;
        const targetPairs = new Set<string>();
        for (let i = 0; i < rawTgts.length; i++) {
          const tgtItem = rawTgts[i];
          const tgtRes = validateActionTarget(tgtItem, `${path}.targets[${i}]`);
          if (!tgtRes.valid) {
            issues.push(...tgtRes.issues);
          } else {
            const pairKey = `${tgtRes.value.entityId}::${tgtRes.value.role}`;
            if (targetPairs.has(pairKey)) {
              issues.push({
                code: "DUPLICATE_TARGET_PAIR",
                path: `${path}.targets[${i}]`,
                message: `Duplicate action target (entityId: "${tgtRes.value.entityId}", role: "${tgtRes.value.role}").`,
                severity: "error",
              });
            } else {
              targetPairs.add(pairKey);
              targets.push(tgtRes.value);
            }
          }
        }
      }
    }

    let validParams: Readonly<Record<string, import("./types.js").JsonValue>> | undefined;
    const paramsProp = requireProperty(input, "parameters", path, issues);
    if (paramsProp.ok) {
      const jsonRes = validateJsonValue(paramsProp.value, {
        requireObject: true,
        maxDepth: MAX_JSON_VALUE_DEPTH,
        path: `${path}.parameters`,
      });
      if (!jsonRes.valid) {
        issues.push(
          ...jsonRes.issues.map((i) => ({
            code: i.code,
            path: i.path,
            message: i.message,
            severity: "error" as const,
          })),
        );
      } else {
        validParams = jsonRes.value as Readonly<Record<string, import("./types.js").JsonValue>>;
      }
    }

    const statusProp = requireProperty(input, "executionStatus", path, issues);
    let validStatus: ActionExecutionStatus | undefined;
    if (statusProp.ok) {
      if (typeof statusProp.value !== "string" || !VALID_EXEC_STATUSES.has(statusProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.executionStatus`,
          message:
            "Action execution status must be one of: 'proposed', 'approved', 'rejected', 'executing', 'executed', 'failed', 'cancelled'.",
          severity: "error",
        });
      } else {
        validStatus = statusProp.value as ActionExecutionStatus;
      }
    }

    let validProvenance: ProvenanceDescriptor | undefined;
    const provProp = readOptionalProperty(input, "provenance", path, issues);
    if (provProp.status === "present") {
      const provRes = validateProvenanceDescriptor(provProp.value, `${path}.provenance`);
      if (!provRes.valid) {
        issues.push(...provRes.issues);
      } else {
        validProvenance = provRes.value;
      }
    }

    if (
      issues.length > 0 ||
      validVersion === undefined ||
      validId === undefined ||
      validProposedAt === undefined ||
      validEnv === undefined ||
      validActor === undefined ||
      validIntent === undefined ||
      validParams === undefined ||
      validStatus === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        schemaVersion: validVersion,
        id: validId,
        proposedAt: validProposedAt,
        environment: validEnv,
        actor: validActor,
        intent: validIntent,
        targets,
        parameters: validParams,
        executionStatus: validStatus,
        ...(validProvenance !== undefined ? { provenance: validProvenance } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "Proposed action validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

// ============================================================================
// 5. STATE CHANGE & VALUE STATE
// ============================================================================

export function validateValueState(
  input: unknown,
  path = "valueState",
): ValidationResult<ValueState> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "ValueState must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const statusProp = requireProperty(input, "status", path, issues);
    if (!statusProp.ok) {
      return { valid: false, issues };
    }

    if (
      typeof statusProp.value !== "string" ||
      (statusProp.value !== "known" &&
        statusProp.value !== "absent" &&
        statusProp.value !== "unknown")
    ) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_ENUM_VALUE",
            path: `${path}.status`,
            message: "ValueState status must be 'known', 'absent', or 'unknown'.",
            severity: "error",
          },
        ],
      };
    }

    if (statusProp.value === "known") {
      const valProp = requireProperty(input, "value", path, issues);
      if (!valProp.ok) {
        return { valid: false, issues };
      }
      const jsonRes = validateJsonValue(valProp.value, {
        path: `${path}.value`,
        maxDepth: MAX_JSON_VALUE_DEPTH,
      });
      if (!jsonRes.valid) {
        return {
          valid: false,
          issues: jsonRes.issues.map((i) => ({
            code: i.code,
            path: i.path,
            message: i.message,
            severity: "error" as const,
          })),
        };
      }
      // Detached snapshot: directly using validated jsonRes.value without rereading input.value
      return {
        valid: true,
        issues: [],
        value: {
          status: "known",
          value: jsonRes.value,
        },
      };
    }

    if (statusProp.value === "absent") {
      return {
        valid: true,
        issues: [],
        value: { status: "absent" },
      };
    }

    return {
      valid: true,
      issues: [],
      value: { status: "unknown" },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "ValueState validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateStateChange(
  input: unknown,
  path = "stateChange",
): ValidationResult<StateChange> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "StateChange must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const entProp = requireProperty(input, "entityId", path, issues);
    let validEntityId: EntityId | undefined;
    if (entProp.ok) {
      const idRes = validateId<EntityId>(entProp.value, "Entity", `${path}.entityId`);
      if (!idRes.valid) {
        issues.push(...idRes.issues);
      } else {
        validEntityId = idRes.value;
      }
    }

    const propProp = requireProperty(input, "property", path, issues);
    let validProperty: string | undefined;
    if (propProp.ok) {
      if (typeof propProp.value !== "string" || propProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.property`,
          message: "StateChange property must be a non-empty string.",
          severity: "error",
        });
      } else {
        validProperty = propProp.value.trim();
      }
    }

    const opProp = requireProperty(input, "operation", path, issues);
    let validOp: StateChangeOperation | undefined;
    if (opProp.ok) {
      if (typeof opProp.value !== "string" || !VALID_STATE_CHANGE_OPS.has(opProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.operation`,
          message: "StateChange operation must be 'add', 'remove', 'replace', or 'unknown'.",
          severity: "error",
        });
      } else {
        validOp = opProp.value as StateChangeOperation;
      }
    }

    const beforeProp = requireProperty(input, "before", path, issues);
    let validBefore: ValueState | undefined;
    if (beforeProp.ok) {
      const beforeRes = validateValueState(beforeProp.value, `${path}.before`);
      if (!beforeRes.valid) {
        issues.push(...beforeRes.issues);
      } else {
        validBefore = beforeRes.value;
      }
    }

    const afterProp = requireProperty(input, "after", path, issues);
    let validAfter: ValueState | undefined;
    if (afterProp.ok) {
      const afterRes = validateValueState(afterProp.value, `${path}.after`);
      if (!afterRes.valid) {
        issues.push(...afterRes.issues);
      } else {
        validAfter = afterRes.value;
      }
    }

    // Operation transition invariants
    if (validOp && validBefore && validAfter) {
      if (validOp === "add") {
        if (validBefore.status !== "absent" && validBefore.status !== "unknown") {
          issues.push({
            code: "INVALID_STATE_CHANGE_TRANSITION",
            path: `${path}.before`,
            message:
              "StateChange 'add' operation requires 'before' to be 'absent' or 'unknown' (cannot add already-present property).",
            severity: "error",
          });
        }
        if (validAfter.status === "absent") {
          issues.push({
            code: "INVALID_STATE_CHANGE_TRANSITION",
            path: `${path}.after`,
            message: "StateChange 'add' operation requires 'after' to not be 'absent'.",
            severity: "error",
          });
        }
      } else if (validOp === "remove") {
        if (validBefore.status === "absent") {
          issues.push({
            code: "INVALID_STATE_CHANGE_TRANSITION",
            path: `${path}.before`,
            message:
              "StateChange 'remove' operation requires 'before' to not be 'absent' (cannot remove absent property).",
            severity: "error",
          });
        }
        if (validAfter.status !== "absent" && validAfter.status !== "unknown") {
          issues.push({
            code: "INVALID_STATE_CHANGE_TRANSITION",
            path: `${path}.after`,
            message: "StateChange 'remove' operation requires 'after' to be 'absent' or 'unknown'.",
            severity: "error",
          });
        }
      } else if (validOp === "replace") {
        if (validBefore.status === "absent") {
          issues.push({
            code: "INVALID_STATE_CHANGE_TRANSITION",
            path: `${path}.before`,
            message:
              "StateChange 'replace' operation requires 'before' to not be 'absent' (cannot replace absent property).",
            severity: "error",
          });
        }
        if (validAfter.status === "absent") {
          issues.push({
            code: "INVALID_STATE_CHANGE_TRANSITION",
            path: `${path}.after`,
            message: "StateChange 'replace' operation requires 'after' to not be 'absent'.",
            severity: "error",
          });
        }
      }
    }

    if (
      issues.length > 0 ||
      validEntityId === undefined ||
      validProperty === undefined ||
      validOp === undefined ||
      validBefore === undefined ||
      validAfter === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        entityId: validEntityId,
        property: validProperty,
        operation: validOp,
        before: validBefore,
        after: validAfter,
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "StateChange validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

// ============================================================================
// 6. EVIDENCE, PROVENANCE, RISK, REVERSIBILITY, TEMPORAL
// ============================================================================

export function validateAssumption(
  input: unknown,
  path = "assumption",
): ValidationResult<Assumption> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "Assumption must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const idProp = requireProperty(input, "id", path, issues);
    let validId: string | undefined;
    if (idProp.ok) {
      if (typeof idProp.value !== "string" || idProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_ID",
          path: `${path}.id`,
          message: "Assumption ID must be a non-empty string.",
          severity: "error",
        });
      } else {
        validId = idProp.value.trim();
      }
    }

    const stmtProp = requireProperty(input, "statement", path, issues);
    let validStatement: string | undefined;
    if (stmtProp.ok) {
      if (typeof stmtProp.value !== "string" || stmtProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.statement`,
          message: "Assumption statement must be a non-empty string.",
          severity: "error",
        });
      } else {
        validStatement = stmtProp.value.trim();
      }
    }

    const statusProp = requireProperty(input, "status", path, issues);
    let validStatus: AssumptionStatus | undefined;
    if (statusProp.ok) {
      if (
        typeof statusProp.value !== "string" ||
        !VALID_ASSUMPTION_STATUSES.has(statusProp.value)
      ) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.status`,
          message: "Assumption status must be 'assumed', 'verified', 'violated', or 'unknown'.",
          severity: "error",
        });
      } else {
        validStatus = statusProp.value as AssumptionStatus;
      }
    }

    if (
      issues.length > 0 ||
      validId === undefined ||
      validStatement === undefined ||
      validStatus === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        id: validId,
        statement: validStatement,
        status: validStatus,
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "Assumption validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateProvenanceDescriptor(
  input: unknown,
  path = "provenance",
): ValidationResult<ProvenanceDescriptor> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "Provenance descriptor must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const srcProp = requireProperty(input, "source", path, issues);
    let validSource: ProvenanceSourceKind | undefined;
    if (srcProp.ok) {
      if (typeof srcProp.value !== "string" || !VALID_PROVENANCE_SOURCES.has(srcProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.source`,
          message: `Invalid provenance source: ${typeof srcProp.value === "string" ? srcProp.value : "non-string"}.`,
          severity: "error",
        });
      } else {
        validSource = srcProp.value as ProvenanceSourceKind;
      }
    }

    const tsProp = requireProperty(input, "timestamp", path, issues);
    let validTs: import("@futureclick/shared").IsoTimestamp | undefined;
    if (tsProp.ok) {
      const tsRes = validateIsoTimestamp(tsProp.value, `${path}.timestamp`);
      if (!tsRes.valid) {
        issues.push(...tsRes.issues);
      } else {
        validTs = tsRes.value;
      }
    }

    let validEngineVersion: string | undefined;
    const evProp = readOptionalProperty(input, "engineVersion", path, issues);
    if (evProp.status === "present") {
      if (typeof evProp.value !== "string" || evProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.engineVersion`,
          message: "Provenance engineVersion must be a non-empty string.",
          severity: "error",
        });
      } else {
        validEngineVersion = evProp.value.trim();
      }
    }

    let validRuleId: string | undefined;
    const ruleProp = readOptionalProperty(input, "ruleId", path, issues);
    if (ruleProp.status === "present") {
      if (typeof ruleProp.value !== "string" || ruleProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.ruleId`,
          message: "Provenance ruleId must be a non-empty string.",
          severity: "error",
        });
      } else {
        validRuleId = ruleProp.value.trim();
      }
    }

    let validDetails: Readonly<Record<string, import("./types.js").JsonValue>> | undefined;
    const detailsProp = readOptionalProperty(input, "details", path, issues);
    if (detailsProp.status === "present") {
      const jsonRes = validateJsonValue(detailsProp.value, {
        requireObject: true,
        maxDepth: MAX_JSON_VALUE_DEPTH,
        path: `${path}.details`,
      });
      if (!jsonRes.valid) {
        issues.push(
          ...jsonRes.issues.map((i) => ({
            code: i.code,
            path: i.path,
            message: i.message,
            severity: "error" as const,
          })),
        );
      } else {
        validDetails = jsonRes.value as Readonly<Record<string, import("./types.js").JsonValue>>;
      }
    }

    if (issues.length > 0 || validSource === undefined || validTs === undefined) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        source: validSource,
        timestamp: validTs,
        ...(validEngineVersion !== undefined ? { engineVersion: validEngineVersion } : {}),
        ...(validRuleId !== undefined ? { ruleId: validRuleId } : {}),
        ...(validDetails !== undefined ? { details: validDetails } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "Provenance descriptor validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateEvidenceRecord(
  input: unknown,
  path = "evidence",
): ValidationResult<EvidenceRecord> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "EvidenceRecord must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const idProp = requireProperty(input, "id", path, issues);
    let validId: EvidenceId | undefined;
    if (idProp.ok) {
      const idRes = validateId<EvidenceId>(idProp.value, "Evidence", `${path}.id`);
      if (!idRes.valid) {
        issues.push(...idRes.issues);
      } else {
        validId = idRes.value;
      }
    }

    const modeProp = requireProperty(input, "mode", path, issues);
    let validMode: EvidenceMode | undefined;
    if (modeProp.ok) {
      if (typeof modeProp.value !== "string" || !VALID_EVIDENCE_MODES.has(modeProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.mode`,
          message: "Evidence mode must be one of: 'verified', 'simulated', 'predicted'.",
          severity: "error",
        });
      } else {
        validMode = modeProp.value as EvidenceMode;
      }
    }

    const srcProp = requireProperty(input, "source", path, issues);
    let validSource: ProvenanceSourceKind | undefined;
    if (srcProp.ok) {
      if (typeof srcProp.value !== "string" || !VALID_PROVENANCE_SOURCES.has(srcProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.source`,
          message: "Evidence source is invalid.",
          severity: "error",
        });
      } else {
        validSource = srcProp.value as ProvenanceSourceKind;
      }
    }

    const obsProp = requireProperty(input, "observedAt", path, issues);
    let validObservedAt: import("@futureclick/shared").IsoTimestamp | undefined;
    if (obsProp.ok) {
      const tsRes = validateIsoTimestamp(obsProp.value, `${path}.observedAt`);
      if (!tsRes.valid) {
        issues.push(...tsRes.issues);
      } else {
        validObservedAt = tsRes.value;
      }
    }

    const scopeProp = requireProperty(input, "scope", path, issues);
    let validScope: string | undefined;
    if (scopeProp.ok) {
      if (typeof scopeProp.value !== "string" || scopeProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.scope`,
          message: "Evidence scope must be a non-empty string defining its validity boundary.",
          severity: "error",
        });
      } else {
        validScope = scopeProp.value.trim();
      }
    }

    const assumptions: Assumption[] = [];
    const asmProp = requireProperty(input, "assumptions", path, issues);
    if (asmProp.ok) {
      const asmCapture = captureDenseArray(asmProp.value);
      if (!asmCapture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.assumptions`,
          message: "Evidence assumptions must be a dense array.",
          severity: "error",
        });
      } else {
        const rawAsm = asmCapture.values;
        for (let i = 0; i < rawAsm.length; i++) {
          const asmItem = rawAsm[i];
          const asmRes = validateAssumption(asmItem, `${path}.assumptions[${i}]`);
          if (!asmRes.valid) {
            issues.push(...asmRes.issues);
          } else {
            assumptions.push(asmRes.value);
          }
        }
      }
    }

    let validConfidence: ConfidenceScore | undefined;
    if (validMode === "predicted") {
      const confProp = requireProperty(input, "confidence", path, issues);
      if (confProp.ok) {
        const confRes = validateConfidenceScore(confProp.value, `${path}.confidence`);
        if (!confRes.valid) {
          issues.push(...confRes.issues);
        } else {
          validConfidence = confRes.value;
        }
      }
    } else {
      const confProp = readOptionalProperty(input, "confidence", path, issues);
      if (confProp.status === "present") {
        const confRes = validateConfidenceScore(confProp.value, `${path}.confidence`);
        if (!confRes.valid) {
          issues.push(...confRes.issues);
        } else {
          validConfidence = confRes.value;
        }
      }
    }

    const sumProp = requireProperty(input, "summary", path, issues);
    let validSummary: string | undefined;
    if (sumProp.ok) {
      if (typeof sumProp.value !== "string" || sumProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.summary`,
          message: "Evidence summary must be a non-empty string.",
          severity: "error",
        });
      } else {
        validSummary = sumProp.value.trim();
      }
    }

    let validDetails: Readonly<Record<string, import("./types.js").JsonValue>> | undefined;
    const detailsProp = readOptionalProperty(input, "details", path, issues);
    if (detailsProp.status === "present") {
      const jsonRes = validateJsonValue(detailsProp.value, {
        requireObject: true,
        maxDepth: MAX_JSON_VALUE_DEPTH,
        path: `${path}.details`,
      });
      if (!jsonRes.valid) {
        issues.push(
          ...jsonRes.issues.map((i) => ({
            code: i.code,
            path: i.path,
            message: i.message,
            severity: "error" as const,
          })),
        );
      } else {
        validDetails = jsonRes.value as Readonly<Record<string, import("./types.js").JsonValue>>;
      }
    }

    if (
      issues.length > 0 ||
      validId === undefined ||
      validMode === undefined ||
      validSource === undefined ||
      validObservedAt === undefined ||
      validScope === undefined ||
      validSummary === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        id: validId,
        mode: validMode,
        source: validSource,
        observedAt: validObservedAt,
        scope: validScope,
        assumptions,
        summary: validSummary,
        ...(validConfidence !== undefined ? { confidence: validConfidence } : {}),
        ...(validDetails !== undefined ? { details: validDetails } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "EvidenceRecord validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateTemporalDescriptor(
  input: unknown,
  path = "temporal",
): ValidationResult<TemporalDescriptor> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "TemporalDescriptor must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const timingProp = requireProperty(input, "timing", path, issues);
    let validTiming: TemporalTiming | undefined;
    if (timingProp.ok) {
      if (typeof timingProp.value !== "string" || !VALID_TEMPORAL_TIMINGS.has(timingProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.timing`,
          message: "Temporal timing must be 'immediate', 'near-term', 'long-term', or 'unknown'.",
          severity: "error",
        });
      } else {
        validTiming = timingProp.value as TemporalTiming;
      }
    }

    const freqProp = requireProperty(input, "frequency", path, issues);
    let validFreq: TemporalFrequency | undefined;
    if (freqProp.ok) {
      if (typeof freqProp.value !== "string" || !VALID_TEMPORAL_FREQUENCIES.has(freqProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.frequency`,
          message: "Temporal frequency must be 'once', 'recurring', 'continuous', or 'unknown'.",
          severity: "error",
        });
      } else {
        validFreq = freqProp.value as TemporalFrequency;
      }
    }

    if (issues.length > 0 || validTiming === undefined || validFreq === undefined) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        timing: validTiming,
        frequency: validFreq,
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "TemporalDescriptor validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateReversibilityDescriptor(
  input: unknown,
  path = "reversibility",
): ValidationResult<ReversibilityDescriptor> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "ReversibilityDescriptor must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const lvlProp = requireProperty(input, "level", path, issues);
    let validLevel: ReversibilityLevel | undefined;
    if (lvlProp.ok) {
      if (typeof lvlProp.value !== "string" || !VALID_REVERSIBILITY_LEVELS.has(lvlProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.level`,
          message:
            "Reversibility level must be 'reversible', 'partially_reversible', 'irreversible', or 'unknown'.",
          severity: "error",
        });
      } else {
        validLevel = lvlProp.value as ReversibilityLevel;
      }
    }

    let validMethod: string | undefined;
    const methodProp = readOptionalProperty(input, "method", path, issues);
    if (methodProp.status === "present") {
      if (typeof methodProp.value !== "string" || methodProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.method`,
          message: "Reversibility method must be a non-empty string.",
          severity: "error",
        });
      } else {
        validMethod = methodProp.value.trim();
      }
    }

    let validWindow: string | undefined;
    const windowProp = readOptionalProperty(input, "timeWindow", path, issues);
    if (windowProp.status === "present") {
      if (typeof windowProp.value !== "string" || windowProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.timeWindow`,
          message: "Reversibility timeWindow must be a non-empty string.",
          severity: "error",
        });
      } else {
        validWindow = windowProp.value.trim();
      }
    }

    let validReqs: string[] | undefined;
    const reqsProp = readOptionalProperty(input, "requirements", path, issues);
    if (reqsProp.status === "present") {
      const reqsCapture = captureDenseArray(reqsProp.value);
      if (!reqsCapture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.requirements`,
          message: "Reversibility requirements must be a dense array of strings.",
          severity: "error",
        });
      } else {
        const rawReqs = reqsCapture.values;
        const reqList: string[] = [];
        for (let i = 0; i < rawReqs.length; i++) {
          const item = rawReqs[i];
          if (typeof item !== "string" || item.trim().length === 0) {
            issues.push({
              code: "INVALID_TYPE",
              path: `${path}.requirements[${i}]`,
              message: "Each reversibility requirement must be a non-empty string.",
              severity: "error",
            });
          } else {
            reqList.push(item.trim());
          }
        }
        validReqs = reqList;
      }
    }

    // Semantic consistency rules
    if (validLevel === "irreversible" && validMethod !== undefined) {
      issues.push({
        code: "INVALID_REVERSIBILITY_DESCRIPTOR",
        path: `${path}.method`,
        message: "An irreversible consequence cannot specify a recovery method.",
        severity: "error",
      });
    }

    if (validLevel === "unknown") {
      if (validMethod !== undefined) {
        issues.push({
          code: "INVALID_REVERSIBILITY_DESCRIPTOR",
          path: `${path}.method`,
          message: "An unknown reversibility consequence cannot specify a recovery method.",
          severity: "error",
        });
      }
      if (validWindow !== undefined) {
        issues.push({
          code: "INVALID_REVERSIBILITY_DESCRIPTOR",
          path: `${path}.timeWindow`,
          message: "An unknown reversibility consequence cannot specify a recovery timeWindow.",
          severity: "error",
        });
      }
    }

    if (issues.length > 0 || validLevel === undefined) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        level: validLevel,
        ...(validMethod !== undefined ? { method: validMethod } : {}),
        ...(validWindow !== undefined ? { timeWindow: validWindow } : {}),
        ...(validReqs !== undefined ? { requirements: validReqs } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "ReversibilityDescriptor validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

export function validateRiskDescriptor(
  input: unknown,
  path = "risk",
): ValidationResult<RiskDescriptor> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "RiskDescriptor must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const sevProp = requireProperty(input, "severity", path, issues);
    let validSeverity: RiskSeverity | undefined;
    if (sevProp.ok) {
      if (typeof sevProp.value !== "string" || !VALID_RISK_SEVERITIES.has(sevProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.severity`,
          message:
            "Risk severity must be one of: 'none', 'low', 'medium', 'high', 'critical', 'unknown'.",
          severity: "error",
        });
      } else {
        validSeverity = sevProp.value as RiskSeverity;
      }
    }

    const categories: RiskCategory[] = [];
    const catProp = requireProperty(input, "categories", path, issues);
    if (catProp.ok) {
      const catCapture = captureDenseArray(catProp.value);
      if (!catCapture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.categories`,
          message: "Risk categories must be a dense array.",
          severity: "error",
        });
      } else {
        const rawCats = catCapture.values;
        const seenCats = new Set<string>();
        for (let i = 0; i < rawCats.length; i++) {
          const item = rawCats[i];
          if (typeof item !== "string" || !VALID_RISK_CATEGORIES.has(item)) {
            issues.push({
              code: "INVALID_ENUM_VALUE",
              path: `${path}.categories[${i}]`,
              message: `Invalid risk category: ${typeof item === "string" ? item : "non-string"}.`,
              severity: "error",
            });
          } else if (seenCats.has(item)) {
            issues.push({
              code: "INVALID_RISK_DESCRIPTOR",
              path: `${path}.categories[${i}]`,
              message: `Duplicate risk category "${item}".`,
              severity: "error",
            });
          } else {
            seenCats.add(item);
            categories.push(item as RiskCategory);
          }
        }
      }
    }

    let validDesc: string | undefined;
    const descProp = readOptionalProperty(input, "description", path, issues);
    if (descProp.status === "present") {
      if (typeof descProp.value !== "string" || descProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.description`,
          message: "Risk description must be a non-empty string.",
          severity: "error",
        });
      } else {
        validDesc = descProp.value.trim();
      }
    }

    // Invariant: severity 'none' requires empty categories
    // Invariant: non-none, non-unknown severity requires at least one category
    // Invariant: unknown severity may have zero or more categories
    if (validSeverity === "none") {
      if (categories.length > 0) {
        issues.push({
          code: "INVALID_RISK_DESCRIPTOR",
          path: `${path}.categories`,
          message: "Risk severity 'none' must have an empty categories array.",
          severity: "error",
        });
      }
    } else if (
      validSeverity !== undefined &&
      validSeverity !== "unknown" &&
      categories.length === 0
    ) {
      issues.push({
        code: "INVALID_RISK_DESCRIPTOR",
        path: `${path}.categories`,
        message: `Risk severity '${validSeverity}' must specify at least one category.`,
        severity: "error",
      });
    }

    if (issues.length > 0 || validSeverity === undefined) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        severity: validSeverity,
        categories,
        ...(validDesc !== undefined ? { description: validDesc } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "RiskDescriptor validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

// ============================================================================
// 7. CONSEQUENCE MODEL
// ============================================================================

export function validateConsequence(
  input: unknown,
  path = "consequence",
): ValidationResult<Consequence> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "Consequence must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const versionProp = requireProperty(input, "schemaVersion", path, issues);
    let validVersion: SchemaVersion | undefined;
    if (versionProp.ok) {
      const versionRes = validateSchemaVersion(versionProp.value, `${path}.schemaVersion`);
      if (!versionRes.valid) {
        issues.push(...versionRes.issues);
      } else {
        validVersion = versionRes.value;
      }
    }

    const idProp = requireProperty(input, "id", path, issues);
    let validId: ConsequenceId | undefined;
    if (idProp.ok) {
      const idRes = validateId<ConsequenceId>(idProp.value, "Consequence", `${path}.id`);
      if (!idRes.valid) {
        issues.push(...idRes.issues);
      } else {
        validId = idRes.value;
      }
    }

    const actIdProp = requireProperty(input, "actionId", path, issues);
    let validActionId: ActionId | undefined;
    if (actIdProp.ok) {
      const actIdRes = validateId<ActionId>(actIdProp.value, "Action", `${path}.actionId`);
      if (!actIdRes.valid) {
        issues.push(...actIdRes.issues);
      } else {
        validActionId = actIdRes.value;
      }
    }

    const kindProp = requireProperty(input, "kind", path, issues);
    let validKind: ConsequenceCategory | undefined;
    if (kindProp.ok) {
      if (typeof kindProp.value !== "string" || !VALID_CONSEQUENCE_CATEGORIES.has(kindProp.value)) {
        issues.push({
          code: "INVALID_ENUM_VALUE",
          path: `${path}.kind`,
          message: "Consequence category is invalid.",
          severity: "error",
        });
      } else {
        validKind = kindProp.value as ConsequenceCategory;
      }
    }

    const sumProp = requireProperty(input, "summary", path, issues);
    let validSummary: string | undefined;
    if (sumProp.ok) {
      if (typeof sumProp.value !== "string" || sumProp.value.trim().length === 0) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.summary`,
          message: "Consequence summary must be a non-empty string.",
          severity: "error",
        });
      } else {
        validSummary = sumProp.value.trim();
      }
    }

    const affectedEntities: EntityId[] = [];
    const affectedSet = new Set<string>();
    const affProp = requireProperty(input, "affectedEntities", path, issues);
    if (affProp.ok) {
      const affCapture = captureDenseArray(affProp.value);
      if (!affCapture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.affectedEntities`,
          message: "Affected entities must be a dense array.",
          severity: "error",
        });
      } else {
        const rawAff = affCapture.values;
        for (let i = 0; i < rawAff.length; i++) {
          const item = rawAff[i];
          const idRes = validateId<EntityId>(
            item,
            "AffectedEntity",
            `${path}.affectedEntities[${i}]`,
          );
          if (!idRes.valid) {
            issues.push(...idRes.issues);
          } else if (affectedSet.has(idRes.value)) {
            issues.push({
              code: "DUPLICATE_AFFECTED_ENTITY",
              path: `${path}.affectedEntities[${i}]`,
              message: `Duplicate affected entity ID "${idRes.value}".`,
              severity: "error",
            });
          } else {
            affectedSet.add(idRes.value);
            affectedEntities.push(idRes.value);
          }
        }
      }
    }

    const stateChanges: StateChange[] = [];
    const scProp = requireProperty(input, "stateChanges", path, issues);
    if (scProp.ok) {
      const scCapture = captureDenseArray(scProp.value);
      if (!scCapture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.stateChanges`,
          message: "State changes must be a dense array.",
          severity: "error",
        });
      } else {
        const rawSc = scCapture.values;
        for (let i = 0; i < rawSc.length; i++) {
          const scItem = rawSc[i];
          const scRes = validateStateChange(scItem, `${path}.stateChanges[${i}]`);
          if (!scRes.valid) {
            issues.push(...scRes.issues);
          } else {
            stateChanges.push(scRes.value);
            if (!affectedSet.has(scRes.value.entityId)) {
              issues.push({
                code: "MISSING_AFFECTED_ENTITY",
                path: `${path}.stateChanges[${i}].entityId`,
                message: `State change target entity "${scRes.value.entityId}" must be declared in affectedEntities.`,
                severity: "error",
              });
            }
          }
        }
      }
    }

    const evidence: EvidenceRecord[] = [];
    const evProp = requireProperty(input, "evidence", path, issues);
    if (evProp.ok) {
      const evCapture = captureDenseArray(evProp.value);
      if (!evCapture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.evidence`,
          message: "Consequence evidence must be a dense array.",
          severity: "error",
        });
      } else {
        const rawEv = evCapture.values;
        const seenEvIds = new Set<string>();
        for (let i = 0; i < rawEv.length; i++) {
          const evItem = rawEv[i];
          const evRes = validateEvidenceRecord(evItem, `${path}.evidence[${i}]`);
          if (!evRes.valid) {
            issues.push(...evRes.issues);
          } else if (seenEvIds.has(evRes.value.id)) {
            issues.push({
              code: "DUPLICATE_EVIDENCE_ID",
              path: `${path}.evidence[${i}].id`,
              message: `Duplicate evidence ID "${evRes.value.id}" within consequence.`,
              severity: "error",
            });
          } else {
            seenEvIds.add(evRes.value.id);
            evidence.push(evRes.value);
          }
        }
      }
    }

    const confProp = requireProperty(input, "confidence", path, issues);
    let validConfidence: ConfidenceScore | undefined;
    if (confProp.ok) {
      const confRes = validateConfidenceScore(confProp.value, `${path}.confidence`);
      if (!confRes.valid) {
        issues.push(...confRes.issues);
      } else {
        validConfidence = confRes.value;
      }
    }

    const revProp = requireProperty(input, "reversibility", path, issues);
    let validRev: ReversibilityDescriptor | undefined;
    if (revProp.ok) {
      const revRes = validateReversibilityDescriptor(revProp.value, `${path}.reversibility`);
      if (!revRes.valid) {
        issues.push(...revRes.issues);
      } else {
        validRev = revRes.value;
      }
    }

    const riskProp = requireProperty(input, "risk", path, issues);
    let validRisk: RiskDescriptor | undefined;
    if (riskProp.ok) {
      const riskRes = validateRiskDescriptor(riskProp.value, `${path}.risk`);
      if (!riskRes.valid) {
        issues.push(...riskRes.issues);
      } else {
        validRisk = riskRes.value;
      }
    }

    let validTemporal: TemporalDescriptor | undefined;
    const tempProp = readOptionalProperty(input, "temporal", path, issues);
    if (tempProp.status === "present") {
      const tempRes = validateTemporalDescriptor(tempProp.value, `${path}.temporal`);
      if (!tempRes.valid) {
        issues.push(...tempRes.issues);
      } else {
        validTemporal = tempRes.value;
      }
    }

    let validProvenance: ProvenanceDescriptor | undefined;
    const provProp = readOptionalProperty(input, "provenance", path, issues);
    if (provProp.status === "present") {
      const provRes = validateProvenanceDescriptor(provProp.value, `${path}.provenance`);
      if (!provRes.valid) {
        issues.push(...provRes.issues);
      } else {
        validProvenance = provRes.value;
      }
    }

    if (
      issues.length > 0 ||
      validVersion === undefined ||
      validId === undefined ||
      validActionId === undefined ||
      validKind === undefined ||
      validSummary === undefined ||
      validConfidence === undefined ||
      validRev === undefined ||
      validRisk === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        schemaVersion: validVersion,
        id: validId,
        actionId: validActionId,
        kind: validKind,
        summary: validSummary,
        affectedEntities,
        stateChanges,
        evidence,
        confidence: validConfidence,
        reversibility: validRev,
        risk: validRisk,
        ...(validTemporal !== undefined ? { temporal: validTemporal } : {}),
        ...(validProvenance !== undefined ? { provenance: validProvenance } : {}),
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "Consequence validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

// ============================================================================
// 8. CANONICAL ENVELOPES & AUTHORITATIVE VALIDATION
// ============================================================================

export function validateActionEvaluationContextStructure(
  input: unknown,
  path = "evaluationContext",
): ValidationResult<ActionEvaluationContext> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "ActionEvaluationContext must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const versionProp = requireProperty(input, "schemaVersion", path, issues);
    let validVersion: SchemaVersion | undefined;
    if (versionProp.ok) {
      const versionRes = validateSchemaVersion(versionProp.value, `${path}.schemaVersion`);
      if (!versionRes.valid) {
        issues.push(...versionRes.issues);
      } else {
        validVersion = versionRes.value;
      }
    }

    const idProp = requireProperty(input, "id", path, issues);
    let validId: EvaluationContextId | undefined;
    if (idProp.ok) {
      const idRes = validateId<EvaluationContextId>(
        idProp.value,
        "EvaluationContext",
        `${path}.id`,
      );
      if (!idRes.valid) {
        issues.push(...idRes.issues);
      } else {
        validId = idRes.value;
      }
    }

    const stateProp = requireProperty(input, "state", path, issues);
    let validState: StateSnapshot | undefined;
    if (stateProp.ok) {
      const stateRes = validateStateSnapshot(stateProp.value, `${path}.state`);
      if (!stateRes.valid) {
        issues.push(...stateRes.issues);
      } else {
        validState = stateRes.value;
      }
    }

    const actionProp = requireProperty(input, "action", path, issues);
    let validAction: ProposedAction | undefined;
    if (actionProp.ok) {
      const actionRes = validateProposedAction(actionProp.value, `${path}.action`);
      if (!actionRes.valid) {
        issues.push(...actionRes.issues);
      } else {
        validAction = actionRes.value;
      }
    }

    const createdProp = requireProperty(input, "createdAt", path, issues);
    let validCreatedAt: import("@futureclick/shared").IsoTimestamp | undefined;
    if (createdProp.ok) {
      const tsRes = validateIsoTimestamp(createdProp.value, `${path}.createdAt`);
      if (!tsRes.valid) {
        issues.push(...tsRes.issues);
      } else {
        validCreatedAt = tsRes.value;
      }
    }

    if (
      issues.length > 0 ||
      validVersion === undefined ||
      validId === undefined ||
      validState === undefined ||
      validAction === undefined ||
      validCreatedAt === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        schemaVersion: validVersion,
        id: validId,
        state: validState,
        action: validAction,
        createdAt: validCreatedAt,
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "ActionEvaluationContext structure validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

function collectEvaluationContextSemanticIssues(
  context: ActionEvaluationContext,
  issues: ValidationIssue[],
  _path = "evaluationContext",
): void {
  try {
    const entityIds = new Set<string>(context.state.entities.map((e) => e.id));

    // 1. Environment identity compatibility
    const stateEnv = context.state.environment;
    const actionEnv = context.action.environment;

    if (stateEnv.environmentId !== actionEnv.environmentId) {
      issues.push({
        code: "ENVIRONMENT_MISMATCH",
        path: "action.environment.environmentId",
        message: `Action environmentId "${actionEnv.environmentId}" does not match state environmentId "${stateEnv.environmentId}".`,
        severity: "error",
      });
    }

    if (
      stateEnv.platform !== "unknown" &&
      actionEnv.platform !== "unknown" &&
      stateEnv.platform !== actionEnv.platform
    ) {
      issues.push({
        code: "ENVIRONMENT_MISMATCH",
        path: "action.environment.platform",
        message: `Action platform "${actionEnv.platform}" does not match state platform "${stateEnv.platform}".`,
        severity: "error",
      });
    }

    if (
      stateEnv.kind !== "unknown" &&
      actionEnv.kind !== "unknown" &&
      stateEnv.kind !== actionEnv.kind
    ) {
      issues.push({
        code: "ENVIRONMENT_MISMATCH",
        path: "action.environment.kind",
        message: `Action environment kind "${actionEnv.kind}" does not match state environment kind "${stateEnv.kind}".`,
        severity: "error",
      });
    }

    // Application identity check:
    // If both define id, they must match.
    // If only one defines id, or neither defines id, the name must match.
    if (stateEnv.application.id !== undefined && actionEnv.application.id !== undefined) {
      if (stateEnv.application.id !== actionEnv.application.id) {
        issues.push({
          code: "ENVIRONMENT_MISMATCH",
          path: "action.environment.application.id",
          message: `Action application ID "${actionEnv.application.id}" does not match state application ID "${stateEnv.application.id}".`,
          severity: "error",
        });
      }
    } else if (stateEnv.application.name !== actionEnv.application.name) {
      issues.push({
        code: "ENVIRONMENT_MISMATCH",
        path: "action.environment.application.name",
        message: `Action application name "${actionEnv.application.name}" does not match state application name "${stateEnv.application.name}".`,
        severity: "error",
      });
    }

    // Session identity check: if both define sessionId, they must match
    if (
      stateEnv.sessionId !== undefined &&
      actionEnv.sessionId !== undefined &&
      stateEnv.sessionId !== actionEnv.sessionId
    ) {
      issues.push({
        code: "ENVIRONMENT_MISMATCH",
        path: "action.environment.sessionId",
        message: `Action sessionId "${actionEnv.sessionId}" does not match state sessionId "${stateEnv.sessionId}".`,
        severity: "error",
      });
    }

    // 2. Chronology invariant (pre-execution action proposal must not precede state observation)
    const stateTime = Date.parse(context.state.observedAt);
    const actionTime = Date.parse(context.action.proposedAt);
    if (!Number.isNaN(stateTime) && !Number.isNaN(actionTime)) {
      if (actionTime < stateTime) {
        issues.push({
          code: "CHRONOLOGY_VIOLATION",
          path: "action.proposedAt",
          message: `Proposed action timestamp (${context.action.proposedAt}) cannot precede state observation timestamp (${context.state.observedAt}).`,
          severity: "error",
        });
      }
    }

    // 3. Action targets resolution check (warning if target entity is not declared in snapshot)
    for (let i = 0; i < context.action.targets.length; i++) {
      const tgt = context.action.targets[i];
      if (!tgt) continue;
      if (!entityIds.has(tgt.entityId)) {
        issues.push({
          code: "UNKNOWN_ENTITY_REFERENCE",
          path: `action.targets[${i}].entityId`,
          message: `Action target entity "${tgt.entityId}" is not present in state snapshot (may represent a prospective or external target).`,
          severity: "warning",
        });
      }
    }
  } catch {
    issues.push({
      code: "UNEXPECTED_ERROR",
      path: _path,
      message: "Evaluation context semantic validation encountered an unexpected error.",
      severity: "error",
    });
  }
}

/**
 * Authoritative validator for ActionEvaluationContext.
 * Performs structural validation to produce a detached snapshot,
 * then validates cross-object semantic invariants on that validated snapshot.
 * Guaranteed to return an immutable, validated snapshot without dynamic getters.
 * Never returns unchecked raw input.
 */
export function validateActionEvaluationContext(
  input: unknown,
): ValidationResult<ActionEvaluationContext> {
  const structRes = validateActionEvaluationContextStructure(input);
  if (!structRes.valid) {
    return structRes;
  }
  const issues: ValidationIssue[] = [...structRes.issues];
  collectEvaluationContextSemanticIssues(structRes.value, issues);
  const hasErrors = issues.some((i) => i.severity === "error");
  if (hasErrors) {
    return {
      valid: false,
      issues,
    };
  }
  return {
    valid: true,
    value: structRes.value,
    issues,
  };
}

export function validateConsequenceAssessmentStructure(
  input: unknown,
  path = "assessment",
): ValidationResult<ConsequenceAssessment> {
  try {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(input)) {
      return {
        valid: false,
        issues: [
          {
            code: "INVALID_TYPE",
            path,
            message: "ConsequenceAssessment must be a non-null object.",
            severity: "error",
          },
        ],
      };
    }

    const versionProp = requireProperty(input, "schemaVersion", path, issues);
    let validVersion: SchemaVersion | undefined;
    if (versionProp.ok) {
      const versionRes = validateSchemaVersion(versionProp.value, `${path}.schemaVersion`);
      if (!versionRes.valid) {
        issues.push(...versionRes.issues);
      } else {
        validVersion = versionRes.value;
      }
    }

    const idProp = requireProperty(input, "id", path, issues);
    let validId: AssessmentId | undefined;
    if (idProp.ok) {
      const idRes = validateId<AssessmentId>(idProp.value, "Assessment", `${path}.id`);
      if (!idRes.valid) {
        issues.push(...idRes.issues);
      } else {
        validId = idRes.value;
      }
    }

    const ctxIdProp = requireProperty(input, "evaluationContextId", path, issues);
    let validCtxId: EvaluationContextId | undefined;
    if (ctxIdProp.ok) {
      const ctxIdRes = validateId<EvaluationContextId>(
        ctxIdProp.value,
        "EvaluationContextId",
        `${path}.evaluationContextId`,
      );
      if (!ctxIdRes.valid) {
        issues.push(...ctxIdRes.issues);
      } else {
        validCtxId = ctxIdRes.value;
      }
    }

    const actIdProp = requireProperty(input, "actionId", path, issues);
    let validActionId: ActionId | undefined;
    if (actIdProp.ok) {
      const actIdRes = validateId<ActionId>(actIdProp.value, "ActionId", `${path}.actionId`);
      if (!actIdRes.valid) {
        issues.push(...actIdRes.issues);
      } else {
        validActionId = actIdRes.value;
      }
    }

    const consequences: Consequence[] = [];
    const csqProp = requireProperty(input, "consequences", path, issues);
    if (csqProp.ok) {
      const csqCapture = captureDenseArray(csqProp.value);
      if (!csqCapture.valid) {
        issues.push({
          code: "INVALID_TYPE",
          path: `${path}.consequences`,
          message: "Assessment consequences must be a dense array.",
          severity: "error",
        });
      } else {
        const rawCsq = csqCapture.values;
        for (let i = 0; i < rawCsq.length; i++) {
          const csqItem = rawCsq[i];
          const csqRes = validateConsequence(csqItem, `${path}.consequences[${i}]`);
          if (!csqRes.valid) {
            issues.push(...csqRes.issues);
          } else {
            consequences.push(csqRes.value);
          }
        }
      }
    }

    const genProp = requireProperty(input, "generatedAt", path, issues);
    let validGeneratedAt: import("@futureclick/shared").IsoTimestamp | undefined;
    if (genProp.ok) {
      const tsRes = validateIsoTimestamp(genProp.value, `${path}.generatedAt`);
      if (!tsRes.valid) {
        issues.push(...tsRes.issues);
      } else {
        validGeneratedAt = tsRes.value;
      }
    }

    const provProp = requireProperty(input, "provenance", path, issues);
    let validProv: ProvenanceDescriptor | undefined;
    if (provProp.ok) {
      const provRes = validateProvenanceDescriptor(provProp.value, `${path}.provenance`);
      if (!provRes.valid) {
        issues.push(...provRes.issues);
      } else {
        validProv = provRes.value;
      }
    }

    if (
      issues.length > 0 ||
      validVersion === undefined ||
      validId === undefined ||
      validCtxId === undefined ||
      validActionId === undefined ||
      validGeneratedAt === undefined ||
      validProv === undefined
    ) {
      return { valid: false, issues };
    }

    return {
      valid: true,
      issues: [],
      value: {
        schemaVersion: validVersion,
        id: validId,
        evaluationContextId: validCtxId,
        actionId: validActionId,
        consequences,
        generatedAt: validGeneratedAt,
        provenance: validProv,
      },
    };
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "UNEXPECTED_ERROR",
          path,
          message: "ConsequenceAssessment structure validation failed unexpectedly.",
          severity: "error",
        },
      ],
    };
  }
}

function collectAssessmentSemanticIssues(
  assessment: ConsequenceAssessment,
  expectedContext: ActionEvaluationContext | undefined,
  issues: ValidationIssue[],
  _path = "assessment",
): void {
  try {
    // 1. Assessment binding to evaluation context
    if (expectedContext) {
      if (assessment.evaluationContextId !== expectedContext.id) {
        issues.push({
          code: "ASSESSMENT_CONTEXT_MISMATCH",
          path: "assessment.evaluationContextId",
          message: `Assessment evaluationContextId "${assessment.evaluationContextId}" does not match context ID "${expectedContext.id}".`,
          severity: "error",
        });
      }
      if (assessment.actionId !== expectedContext.action.id) {
        issues.push({
          code: "ACTION_ID_MISMATCH",
          path: "assessment.actionId",
          message: `Assessment actionId "${assessment.actionId}" does not match expected actionId "${expectedContext.action.id}".`,
          severity: "error",
        });
      }
    }

    // 2. Consequence ID uniqueness, consequence actionId binding, and evidence ID uniqueness
    const csqIds = new Set<string>();
    const assessmentEvidenceIds = new Set<string>();

    for (let i = 0; i < assessment.consequences.length; i++) {
      const csq = assessment.consequences[i];
      if (!csq) continue;
      if (csqIds.has(csq.id)) {
        issues.push({
          code: "DUPLICATE_CONSEQUENCE_ID",
          path: `assessment.consequences[${i}].id`,
          message: `Duplicate consequence ID "${csq.id}" in assessment.`,
          severity: "error",
        });
      } else {
        csqIds.add(csq.id);
      }

      if (csq.actionId !== assessment.actionId) {
        issues.push({
          code: "ACTION_ID_MISMATCH",
          path: `assessment.consequences[${i}].actionId`,
          message: `Consequence actionId "${csq.actionId}" does not match assessment actionId "${assessment.actionId}".`,
          severity: "error",
        });
      }

      for (let j = 0; j < csq.evidence.length; j++) {
        const ev = csq.evidence[j];
        if (!ev) continue;
        if (assessmentEvidenceIds.has(ev.id)) {
          issues.push({
            code: "DUPLICATE_EVIDENCE_ID",
            path: `assessment.consequences[${i}].evidence[${j}].id`,
            message: `Duplicate evidence ID "${ev.id}" across consequences in assessment.`,
            severity: "error",
          });
        } else {
          assessmentEvidenceIds.add(ev.id);
        }
      }
    }
  } catch {
    issues.push({
      code: "UNEXPECTED_ERROR",
      path: _path,
      message: "Assessment semantic validation encountered an unexpected error.",
      severity: "error",
    });
  }
}

/**
 * Authoritative validator for ConsequenceAssessment.
 * Performs structural validation to produce a detached assessment snapshot,
 * authoritatively validates expectedContext (if supplied), and verifies
 * cross-object lineage and consequence semantic invariants.
 * Never returns unchecked raw input.
 */
export function validateConsequenceAssessment(
  input: unknown,
  expectedContext?: unknown,
): ValidationResult<ConsequenceAssessment> {
  const structRes = validateConsequenceAssessmentStructure(input);
  if (!structRes.valid) {
    return structRes;
  }

  const issues: ValidationIssue[] = [...structRes.issues];

  let validExpectedContext: ActionEvaluationContext | undefined;
  if (expectedContext !== undefined) {
    const expectedRes = validateActionEvaluationContext(expectedContext);
    if (!expectedRes.valid) {
      issues.push({
        code: "ASSESSMENT_CONTEXT_MISMATCH",
        path: "assessment.evaluationContextId",
        message:
          "Expected ActionEvaluationContext supplied for assessment lineage validation is invalid.",
        severity: "error",
      });
      for (const expIssue of expectedRes.issues) {
        issues.push({
          ...expIssue,
          path: `expectedContext.${expIssue.path}`,
        });
      }
      return { valid: false, issues };
    }
    validExpectedContext = expectedRes.value;
  }

  collectAssessmentSemanticIssues(structRes.value, validExpectedContext, issues);
  const hasErrors = issues.some((i) => i.severity === "error");
  if (hasErrors) {
    return {
      valid: false,
      issues,
    };
  }
  return {
    valid: true,
    value: structRes.value,
    issues,
  };
}
