/**
 * Canonical domain types and contracts for FutureClick (Sprint FC-002 / FC-002A).
 *
 * Epistemological & Architectural Principles:
 * 1. StateSnapshot represents a bounded, observed context at a specific point in time,
 *    not the entire operating system.
 * 2. ProposedAction is purely descriptive of intent awaiting pre-execution analysis.
 * 3. Consequence represents potential/evaluated state changes across broad categories.
 * 4. Evidence preserves the tri-modal epistemological boundary:
 *    - VERIFIED: Deterministically derived from available evidence under explicit assumptions/scope (not unconditional certainty).
 *    - SIMULATED: Observed within an isolated/controlled execution sandbox (not a live guarantee).
 *    - PREDICTED: Probabilistic projection with uncertainty (not verified fact). Future evaluators may emit calibrated confidence values; FC-002 only validates representation and numeric bounds; no calibration method or empirical calibration is implemented.
 * 5. ConfidenceScore in [0.0, 1.0] quantifies bounded uncertainty, not philosophical certainty.
 */

import type { Brand, IsoTimestamp } from "@futureclick/shared";

// ============================================================================
// 1. SCHEMA VERSION
// ============================================================================

export const FUTURECLICK_SCHEMA_VERSION = "1.0" as const;
export type SchemaVersion = typeof FUTURECLICK_SCHEMA_VERSION;

// ============================================================================
// 2. CANONICAL BRANDED IDENTIFIERS
// ============================================================================

export type StateSnapshotId = Brand<string, "StateSnapshotId">;
export type EntityId = Brand<string, "EntityId">;
export type ActionId = Brand<string, "ActionId">;
export type ConsequenceId = Brand<string, "ConsequenceId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type ObservationId = Brand<string, "ObservationId">;
export type EvaluationContextId = Brand<string, "EvaluationContextId">;
export type AssessmentId = Brand<string, "AssessmentId">;

// ============================================================================
// 3. JSON-SAFE VALUE MODEL
// ============================================================================

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * Explicit value state representation for entity properties.
 * Distinguishes known values from absent properties and unknown states.
 */
export type ValueState =
  | { readonly status: "known"; readonly value: JsonValue }
  | { readonly status: "absent" }
  | { readonly status: "unknown" };

// ============================================================================
// 4. ENVIRONMENT DESCRIPTOR
// ============================================================================

export const ENVIRONMENT_KINDS = [
  "browser",
  "desktop",
  "terminal",
  "filesystem",
  "application",
  "service",
  "unknown",
] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const SUPPORTED_PLATFORMS = ["macos", "windows", "linux", "web", "unknown"] as const;
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export interface ApplicationDescriptor {
  readonly id?: string;
  readonly name: string;
  readonly version?: string;
}

export interface EnvironmentDescriptor {
  readonly environmentId: string;
  readonly kind: EnvironmentKind;
  readonly platform: SupportedPlatform;
  readonly application: ApplicationDescriptor;
  readonly sessionId?: string;
}

// ============================================================================
// 5. CANONICAL ENTITY & FACT MODEL
// ============================================================================

export const KNOWN_ENTITY_KINDS = [
  "file",
  "folder",
  "ui_control",
  "document",
  "repository",
  "message",
  "account",
  "permission",
  "application",
  "process",
  "subscription",
  "form",
  "resource",
  "other",
] as const;
export type KnownEntityKind = (typeof KNOWN_ENTITY_KINDS)[number];
export type EntityKind = KnownEntityKind;

export const DOMAIN_KIND_REGEX = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

export interface CanonicalEntity {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly domainKind?: string;
  readonly label?: string;
  readonly attributes?: Readonly<Record<string, JsonValue>>;
}

export interface StateFact {
  readonly id: ObservationId;
  readonly subjectEntityId: EntityId;
  readonly key: string;
  readonly value: JsonValue;
  readonly observedAt?: IsoTimestamp;
  readonly evidence?: readonly EvidenceRecord[];
}

export interface StateSnapshot {
  readonly schemaVersion: SchemaVersion;
  readonly id: StateSnapshotId;
  readonly observedAt: IsoTimestamp;
  readonly environment: EnvironmentDescriptor;
  readonly entities: readonly CanonicalEntity[];
  readonly facts: readonly StateFact[];
  readonly provenance?: ProvenanceDescriptor;
}

// ============================================================================
// 6. PROPOSED ACTION MODEL
// ============================================================================

export const ACTOR_KINDS = ["human", "system", "agent", "unknown"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface ActionActor {
  readonly kind: ActorKind;
  readonly id?: string;
}

export const ACTION_VERBS = [
  "create",
  "read",
  "update",
  "delete",
  "move",
  "rename",
  "copy",
  "share",
  "send",
  "submit",
  "publish",
  "execute",
  "install",
  "uninstall",
  "grant",
  "revoke",
  "purchase",
  "subscribe",
  "cancel",
  "upload",
  "download",
  "change-access",
  "authenticate",
  "unknown",
] as const;
export type ActionVerb = (typeof ACTION_VERBS)[number];

export interface ActionIntent {
  readonly verb: ActionVerb;
  readonly domain?: string;
}

export const ACTION_TARGET_ROLES = [
  "primary",
  "source",
  "destination",
  "recipient",
  "container",
  "account",
  "resource",
  "subject",
  "other",
] as const;
export type ActionTargetRole = (typeof ACTION_TARGET_ROLES)[number];

export interface ActionTarget {
  readonly entityId: EntityId;
  readonly role: ActionTargetRole;
}

export const ACTION_EXECUTION_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "executing",
  "executed",
  "failed",
  "cancelled",
] as const;
export type ActionExecutionStatus = (typeof ACTION_EXECUTION_STATUSES)[number];

export interface ProposedAction {
  readonly schemaVersion: SchemaVersion;
  readonly id: ActionId;
  readonly proposedAt: IsoTimestamp;
  readonly environment: EnvironmentDescriptor;
  readonly actor: ActionActor;
  readonly intent: ActionIntent;
  readonly targets: readonly ActionTarget[];
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly provenance?: ProvenanceDescriptor;
  readonly executionStatus: ActionExecutionStatus;
}

// ============================================================================
// 7. CONSEQUENCE & STATE CHANGE MODEL
// ============================================================================

export const CONSEQUENCE_CATEGORIES = [
  "state-change",
  "data-loss",
  "data-exposure",
  "permission-change",
  "financial",
  "communication",
  "execution",
  "availability",
  "security",
  "privacy",
  "dependency-impact",
  "unknown",
] as const;
export type ConsequenceCategory = (typeof CONSEQUENCE_CATEGORIES)[number];

export const STATE_CHANGE_OPERATIONS = ["add", "remove", "replace", "unknown"] as const;
export type StateChangeOperation = (typeof STATE_CHANGE_OPERATIONS)[number];

export interface StateChange {
  readonly entityId: EntityId;
  readonly property: string;
  readonly operation: StateChangeOperation;
  readonly before: ValueState;
  readonly after: ValueState;
}

export const REVERSIBILITY_LEVELS = [
  "reversible",
  "partially_reversible",
  "irreversible",
  "unknown",
] as const;
export type ReversibilityLevel = (typeof REVERSIBILITY_LEVELS)[number];

export interface ReversibilityDescriptor {
  readonly level: ReversibilityLevel;
  readonly method?: string;
  readonly timeWindow?: string;
  readonly requirements?: readonly string[];
}

export const RISK_SEVERITIES = ["none", "low", "medium", "high", "critical", "unknown"] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export const RISK_CATEGORIES = [
  "privacy",
  "security",
  "financial",
  "data-loss",
  "availability",
  "reputation",
  "other",
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export interface RiskDescriptor {
  readonly severity: RiskSeverity;
  readonly categories: readonly RiskCategory[];
  readonly description?: string;
}

export const TEMPORAL_TIMINGS = ["immediate", "near-term", "long-term", "unknown"] as const;
export type TemporalTiming = (typeof TEMPORAL_TIMINGS)[number];

export const TEMPORAL_FREQUENCIES = ["once", "recurring", "continuous", "unknown"] as const;
export type TemporalFrequency = (typeof TEMPORAL_FREQUENCIES)[number];

export interface TemporalDescriptor {
  readonly timing: TemporalTiming;
  readonly frequency: TemporalFrequency;
}

export interface Consequence {
  readonly schemaVersion: SchemaVersion;
  readonly id: ConsequenceId;
  readonly actionId: ActionId;
  readonly kind: ConsequenceCategory;
  readonly summary: string;
  readonly affectedEntities: readonly EntityId[];
  readonly stateChanges: readonly StateChange[];
  readonly evidence: readonly EvidenceRecord[];
  /**
   * Aggregate confidence that the represented consequence is a correct/likely outcome
   * given the available evidence, assumptions, and current state/action context.
   *
   * Note: FC-002 does NOT define an aggregation algorithm (e.g. not average(evidence.confidence)).
   * The evaluating engine or model is responsible for setting this value.
   * A confidence score of 1.0 does not represent philosophical certainty.
   */
  readonly confidence: ConfidenceScore;
  readonly reversibility: ReversibilityDescriptor;
  readonly risk: RiskDescriptor;
  readonly temporal?: TemporalDescriptor;
  readonly provenance?: ProvenanceDescriptor;
}

// Canonical alias
export type ActionConsequence = Consequence;

// ============================================================================
// 8. EVIDENCE, ASSUMPTIONS, AND PROVENANCE
// ============================================================================

export const EVIDENCE_MODES = ["verified", "simulated", "predicted"] as const;
export type EvidenceMode = (typeof EVIDENCE_MODES)[number];

export const ASSUMPTION_STATUSES = ["assumed", "verified", "violated", "unknown"] as const;
export type AssumptionStatus = (typeof ASSUMPTION_STATUSES)[number];

export interface Assumption {
  readonly id: string;
  readonly statement: string;
  readonly status: AssumptionStatus;
}

export const PROVENANCE_SOURCES = [
  "adapter",
  "rule",
  "simulation",
  "model",
  "user",
  "system",
  "external-service",
  "engine",
  "unknown",
] as const;
export type ProvenanceSourceKind = (typeof PROVENANCE_SOURCES)[number];

export interface ProvenanceDescriptor {
  readonly source: ProvenanceSourceKind;
  readonly ruleId?: string;
  readonly engineVersion?: string;
  readonly timestamp: IsoTimestamp;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

export interface EvidenceRecord {
  readonly id: EvidenceId;
  readonly mode: EvidenceMode;
  readonly source: ProvenanceSourceKind;
  readonly observedAt: IsoTimestamp;
  readonly scope: string;
  readonly assumptions: readonly Assumption[];
  /**
   * Confidence in the specific evidence claim under that record's evidence mode, scope, and assumptions.
   * - Mandatory for 'predicted' mode.
   * - Optional for 'verified' and 'simulated' modes.
   * A value of 1.0 never represents philosophical certainty.
   */
  readonly confidence?: ConfidenceScore;
  readonly summary: string;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

// ============================================================================
// 9. CONFIDENCE SCORE (FC-001 contract preserved)
// ============================================================================

export type ConfidenceScore = Brand<number, "ConfidenceScore">;

export function isValidConfidenceScore(score: unknown): score is ConfidenceScore {
  return typeof score === "number" && Number.isFinite(score) && score >= 0.0 && score <= 1.0;
}

export function createConfidenceScore(score: number): ConfidenceScore {
  if (!isValidConfidenceScore(score)) {
    throw new RangeError(
      `Invalid confidence score: ${score}. Confidence must be a finite number between 0.0 and 1.0 inclusive.`,
    );
  }
  return score;
}

// ============================================================================
// 10. CANONICAL ENVELOPES
// ============================================================================

export interface ActionEvaluationContext {
  readonly schemaVersion: SchemaVersion;
  readonly id: EvaluationContextId;
  readonly state: StateSnapshot;
  readonly action: ProposedAction;
  readonly createdAt: IsoTimestamp;
}

export interface ConsequenceAssessment {
  readonly schemaVersion: SchemaVersion;
  readonly id: AssessmentId;
  readonly evaluationContextId: EvaluationContextId;
  readonly actionId: ActionId;
  readonly consequences: readonly Consequence[];
  readonly generatedAt: IsoTimestamp;
  readonly provenance: ProvenanceDescriptor;
}
