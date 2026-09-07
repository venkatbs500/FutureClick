/**
 * Safe factory constructors for FutureClick canonical domain models (Sprint FC-002 / FC-002A / FC-002B).
 *
 * Factories:
 * - Automatically generate cryptographically secure branded IDs where not explicitly supplied
 * - Stamp canonical schemaVersion ("1.0")
 * - Stamp canonical ISO UTC timestamps where not explicitly supplied
 * - Validate structural and semantic invariants before returning the typed instance
 * - Throw explicit, descriptive Error if invalid inputs are provided to a factory
 * - Preserve explicitly supplied optional fields using own-property semantics without truthiness coercion
 */

import { currentIsoTimestamp, generateEntityId } from "@futureclick/shared";
import {
  FUTURECLICK_SCHEMA_VERSION,
  createConfidenceScore,
  isValidConfidenceScore,
} from "./types.js";
import type {
  ActionActor,
  ActionEvaluationContext,
  ActionExecutionStatus,
  ActionId,
  ActionIntent,
  ActionTarget,
  AssessmentId,
  CanonicalEntity,
  ConfidenceScore,
  Consequence,
  ConsequenceAssessment,
  ConsequenceCategory,
  ConsequenceId,
  EntityId,
  EntityKind,
  EnvironmentDescriptor,
  EvaluationContextId,
  EvidenceRecord,
  ObservationId,
  ProposedAction,
  ProvenanceDescriptor,
  ReversibilityDescriptor,
  RiskDescriptor,
  StateChange,
  StateFact,
  StateSnapshot,
  StateSnapshotId,
  TemporalDescriptor,
} from "./types.js";
import {
  validateActionEvaluationContext,
  validateCanonicalEntity,
  validateConsequence,
  validateConsequenceAssessment,
  validateProposedAction,
  validateStateFact,
  validateStateSnapshot,
} from "./validation.js";

export interface CreateStateSnapshotParams {
  readonly id?: StateSnapshotId;
  readonly observedAt?: import("@futureclick/shared").IsoTimestamp;
  readonly environment: EnvironmentDescriptor;
  readonly entities?: readonly CanonicalEntity[];
  readonly facts?: readonly StateFact[];
  readonly provenance?: ProvenanceDescriptor;
}

export function createStateSnapshot(params: CreateStateSnapshotParams): StateSnapshot {
  const hasEntities = Object.prototype.hasOwnProperty.call(params, "entities");
  const hasFacts = Object.prototype.hasOwnProperty.call(params, "facts");
  const hasProvenance = Object.prototype.hasOwnProperty.call(params, "provenance");
  const hasObservedAt = Object.prototype.hasOwnProperty.call(params, "observedAt");

  const snapshot: StateSnapshot = {
    schemaVersion: FUTURECLICK_SCHEMA_VERSION,
    id: params.id ?? generateEntityId<"StateSnapshotId">("state"),
    observedAt: hasObservedAt
      ? (params.observedAt as import("@futureclick/shared").IsoTimestamp)
      : currentIsoTimestamp(),
    environment: params.environment,
    entities: hasEntities ? (params.entities as readonly CanonicalEntity[]) : [],
    facts: hasFacts ? (params.facts as readonly StateFact[]) : [],
    ...(hasProvenance ? { provenance: params.provenance as ProvenanceDescriptor } : {}),
  };

  const validation = validateStateSnapshot(snapshot);
  if (!validation.valid) {
    const errorMessages = validation.issues
      .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
      .join("; ");
    throw new Error(`Failed to create valid StateSnapshot: ${errorMessages}`);
  }

  return validation.value;
}

export interface CreateCanonicalEntityParams {
  readonly id?: EntityId;
  readonly kind: EntityKind;
  readonly domainKind?: string;
  readonly label?: string;
  readonly attributes?: Readonly<Record<string, import("./types.js").JsonValue>>;
}

export function createCanonicalEntity(params: CreateCanonicalEntityParams): CanonicalEntity {
  const hasDomainKind = Object.prototype.hasOwnProperty.call(params, "domainKind");
  const hasLabel = Object.prototype.hasOwnProperty.call(params, "label");
  const hasAttrs = Object.prototype.hasOwnProperty.call(params, "attributes");

  const entity: CanonicalEntity = {
    id: params.id ?? generateEntityId<"EntityId">("ent"),
    kind: params.kind,
    ...(hasDomainKind ? { domainKind: params.domainKind as string } : {}),
    ...(hasLabel ? { label: params.label as string } : {}),
    ...(hasAttrs
      ? {
          attributes: params.attributes as Readonly<Record<string, import("./types.js").JsonValue>>,
        }
      : {}),
  };

  const validation = validateCanonicalEntity(entity);
  if (!validation.valid) {
    const errorMessages = validation.issues
      .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
      .join("; ");
    throw new Error(`Failed to create valid CanonicalEntity: ${errorMessages}`);
  }

  return validation.value;
}

export interface CreateStateFactParams {
  readonly id?: ObservationId;
  readonly subjectEntityId: EntityId;
  readonly key: string;
  readonly value: import("./types.js").JsonValue;
  readonly observedAt?: import("@futureclick/shared").IsoTimestamp;
  readonly evidence?: readonly EvidenceRecord[];
}

export function createStateFact(params: CreateStateFactParams): StateFact {
  const hasObservedAt = Object.prototype.hasOwnProperty.call(params, "observedAt");
  const hasEvidence = Object.prototype.hasOwnProperty.call(params, "evidence");

  const fact: StateFact = {
    id: params.id ?? generateEntityId<"ObservationId">("fact"),
    subjectEntityId: params.subjectEntityId,
    key: params.key,
    value: params.value,
    ...(hasObservedAt
      ? { observedAt: params.observedAt as import("@futureclick/shared").IsoTimestamp }
      : {}),
    ...(hasEvidence ? { evidence: params.evidence as readonly EvidenceRecord[] } : {}),
  };

  const validation = validateStateFact(fact);
  if (!validation.valid) {
    const errorMessages = validation.issues
      .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
      .join("; ");
    throw new Error(`Failed to create valid StateFact: ${errorMessages}`);
  }

  return validation.value;
}

export interface CreateProposedActionParams {
  readonly id?: ActionId;
  readonly proposedAt?: import("@futureclick/shared").IsoTimestamp;
  readonly environment: EnvironmentDescriptor;
  readonly actor: ActionActor;
  readonly intent: ActionIntent;
  readonly targets?: readonly ActionTarget[];
  readonly parameters?: Readonly<Record<string, import("./types.js").JsonValue>>;
  readonly executionStatus?: ActionExecutionStatus;
  readonly provenance?: ProvenanceDescriptor;
}

export function createProposedAction(params: CreateProposedActionParams): ProposedAction {
  const hasProposedAt = Object.prototype.hasOwnProperty.call(params, "proposedAt");
  const hasTargets = Object.prototype.hasOwnProperty.call(params, "targets");
  const hasParameters = Object.prototype.hasOwnProperty.call(params, "parameters");
  const hasStatus = Object.prototype.hasOwnProperty.call(params, "executionStatus");
  const hasProvenance = Object.prototype.hasOwnProperty.call(params, "provenance");

  const action: ProposedAction = {
    schemaVersion: FUTURECLICK_SCHEMA_VERSION,
    id: params.id ?? generateEntityId<"ActionId">("act"),
    proposedAt: hasProposedAt
      ? (params.proposedAt as import("@futureclick/shared").IsoTimestamp)
      : currentIsoTimestamp(),
    environment: params.environment,
    actor: params.actor,
    intent: params.intent,
    targets: hasTargets ? (params.targets as readonly ActionTarget[]) : [],
    parameters: hasParameters
      ? (params.parameters as Readonly<Record<string, import("./types.js").JsonValue>>)
      : {},
    executionStatus: hasStatus ? (params.executionStatus as ActionExecutionStatus) : "proposed",
    ...(hasProvenance ? { provenance: params.provenance as ProvenanceDescriptor } : {}),
  };

  const validation = validateProposedAction(action);
  if (!validation.valid) {
    const errorMessages = validation.issues
      .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
      .join("; ");
    throw new Error(`Failed to create valid ProposedAction: ${errorMessages}`);
  }

  return validation.value;
}

export interface CreateConsequenceParams {
  readonly id?: ConsequenceId;
  readonly actionId: ActionId;
  readonly kind: ConsequenceCategory;
  readonly summary: string;
  readonly affectedEntities?: readonly EntityId[];
  readonly stateChanges?: readonly StateChange[];
  readonly evidence?: readonly EvidenceRecord[];
  readonly confidence: number | ConfidenceScore;
  readonly reversibility: ReversibilityDescriptor;
  readonly risk: RiskDescriptor;
  readonly temporal?: TemporalDescriptor;
  readonly provenance?: ProvenanceDescriptor;
}

export function createConsequence(params: CreateConsequenceParams): Consequence {
  const score = isValidConfidenceScore(params.confidence)
    ? (params.confidence as ConfidenceScore)
    : createConfidenceScore(params.confidence);

  const hasAffected = Object.prototype.hasOwnProperty.call(params, "affectedEntities");
  const hasStateChanges = Object.prototype.hasOwnProperty.call(params, "stateChanges");
  const hasEvidence = Object.prototype.hasOwnProperty.call(params, "evidence");
  const hasTemporal = Object.prototype.hasOwnProperty.call(params, "temporal");
  const hasProvenance = Object.prototype.hasOwnProperty.call(params, "provenance");

  const consequence: Consequence = {
    schemaVersion: FUTURECLICK_SCHEMA_VERSION,
    id: params.id ?? generateEntityId<"ConsequenceId">("csq"),
    actionId: params.actionId,
    kind: params.kind,
    summary: params.summary,
    affectedEntities: hasAffected ? (params.affectedEntities as readonly EntityId[]) : [],
    stateChanges: hasStateChanges ? (params.stateChanges as readonly StateChange[]) : [],
    evidence: hasEvidence ? (params.evidence as readonly EvidenceRecord[]) : [],
    confidence: score,
    reversibility: params.reversibility,
    risk: params.risk,
    ...(hasTemporal ? { temporal: params.temporal as TemporalDescriptor } : {}),
    ...(hasProvenance ? { provenance: params.provenance as ProvenanceDescriptor } : {}),
  };

  const validation = validateConsequence(consequence);
  if (!validation.valid) {
    const errorMessages = validation.issues
      .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
      .join("; ");
    throw new Error(`Failed to create valid Consequence: ${errorMessages}`);
  }

  return validation.value;
}

export interface CreateActionEvaluationContextParams {
  readonly id?: EvaluationContextId;
  readonly state: StateSnapshot;
  readonly action: ProposedAction;
  readonly createdAt?: import("@futureclick/shared").IsoTimestamp;
}

export function createActionEvaluationContext(
  params: CreateActionEvaluationContextParams,
): ActionEvaluationContext {
  const hasCreatedAt = Object.prototype.hasOwnProperty.call(params, "createdAt");

  const context: ActionEvaluationContext = {
    schemaVersion: FUTURECLICK_SCHEMA_VERSION,
    id: params.id ?? generateEntityId<"EvaluationContextId">("eval"),
    state: params.state,
    action: params.action,
    createdAt: hasCreatedAt
      ? (params.createdAt as import("@futureclick/shared").IsoTimestamp)
      : currentIsoTimestamp(),
  };

  const validation = validateActionEvaluationContext(context);
  if (!validation.valid) {
    const errorMessages = validation.issues
      .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
      .join("; ");
    throw new Error(`Failed to create valid ActionEvaluationContext: ${errorMessages}`);
  }

  return validation.value;
}

export interface CreateConsequenceAssessmentParams {
  readonly id?: AssessmentId;
  readonly evaluationContextId: EvaluationContextId;
  readonly actionId: ActionId;
  readonly consequences: readonly Consequence[];
  readonly generatedAt?: import("@futureclick/shared").IsoTimestamp;
  readonly provenance: ProvenanceDescriptor;
}

export function createConsequenceAssessment(
  params: CreateConsequenceAssessmentParams,
): ConsequenceAssessment {
  const hasGeneratedAt = Object.prototype.hasOwnProperty.call(params, "generatedAt");

  const assessment: ConsequenceAssessment = {
    schemaVersion: FUTURECLICK_SCHEMA_VERSION,
    id: params.id ?? generateEntityId<"AssessmentId">("asmt"),
    evaluationContextId: params.evaluationContextId,
    actionId: params.actionId,
    consequences: params.consequences,
    generatedAt: hasGeneratedAt
      ? (params.generatedAt as import("@futureclick/shared").IsoTimestamp)
      : currentIsoTimestamp(),
    provenance: params.provenance,
  };

  const validation = validateConsequenceAssessment(assessment);
  if (!validation.valid) {
    const errorMessages = validation.issues
      .map((i) => `[${i.code}] ${i.path}: ${i.message}`)
      .join("; ");
    throw new Error(`Failed to create valid ConsequenceAssessment: ${errorMessages}`);
  }

  return validation.value;
}
