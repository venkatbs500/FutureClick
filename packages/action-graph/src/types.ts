/**
 * ActionGraph Canonical Structural Model (Sprint FC-003)
 *
 * This module defines the relational graph schema representing relationships
 * between canonical FutureClick evaluation records (ActionEvaluationContext,
 * StateSnapshot, CanonicalEntity, StateFact, ProposedAction, ConsequenceAssessment,
 * Consequence, EvidenceRecord).
 *
 * Epistemological Boundary:
 * ActionGraph represents DIRECT STRUCTURAL RELATIONSHIPS derived deterministically
 * from canonical domain records. It does NOT assert causal inference, downstream
 * prediction, automated recommendation, or simulation logic.
 */

import type { Brand, IsoTimestamp } from "@futureclick/shared";
import type {
  ActionEvaluationContext,
  ActionId,
  ActionTargetRole,
  AssessmentId,
  ConsequenceAssessment,
  ConsequenceId,
  EntityId,
  EvaluationContextId,
  EvidenceId,
  ObservationId,
  StateSnapshotId,
} from "@futureclick/action-schema";

// ============================================================================
// 1. ACTIONGRAPH SCHEMA VERSION
// ============================================================================

export const ACTION_GRAPH_SCHEMA_VERSION = "1.0" as const;
export type ActionGraphSchemaVersion = typeof ACTION_GRAPH_SCHEMA_VERSION;

// ============================================================================
// 2. BRANDED GRAPH IDENTIFIERS
// ============================================================================

export type ActionGraphId = Brand<string, "ActionGraphId">;
export type ActionGraphNodeId = Brand<string, "ActionGraphNodeId">;
export type ActionGraphEdgeId = Brand<string, "ActionGraphEdgeId">;

// ============================================================================
// 3. NODE KINDS & CANONICAL SUBJECT REFERENCES
// ============================================================================

export const ACTION_GRAPH_NODE_KINDS = [
  "evaluation-context",
  "state-snapshot",
  "entity",
  "fact",
  "proposed-action",
  "assessment",
  "consequence",
  "evidence",
] as const;
export type ActionGraphNodeKind = (typeof ACTION_GRAPH_NODE_KINDS)[number];

export type ActionGraphEvidenceOwner =
  | { readonly kind: "fact"; readonly factId: ObservationId }
  | { readonly kind: "consequence"; readonly consequenceId: ConsequenceId };

export interface ActionGraphEvidenceSubject {
  readonly kind: "evidence";
  readonly evidenceId: EvidenceId;
  readonly owner: ActionGraphEvidenceOwner;
}

export type ActionGraphSubjectRef =
  | { readonly kind: "evaluation-context"; readonly contextId: EvaluationContextId }
  | { readonly kind: "state-snapshot"; readonly stateId: StateSnapshotId }
  | { readonly kind: "entity"; readonly entityId: EntityId }
  | { readonly kind: "fact"; readonly factId: ObservationId }
  | { readonly kind: "proposed-action"; readonly actionId: ActionId }
  | { readonly kind: "assessment"; readonly assessmentId: AssessmentId }
  | { readonly kind: "consequence"; readonly consequenceId: ConsequenceId }
  | ActionGraphEvidenceSubject;

export interface ActionGraphNode {
  readonly id: ActionGraphNodeId;
  readonly kind: ActionGraphNodeKind;
  readonly subject: ActionGraphSubjectRef;
  readonly label?: string;
}

// ============================================================================
// 4. STRUCTURAL RELATIONS & EDGES
// ============================================================================

export const ACTION_GRAPH_RELATIONS = [
  "context-has-state",
  "context-has-action",
  "state-has-entity",
  "state-has-fact",
  "fact-describes-entity",
  "action-targets-entity",
  "assessment-for-context",
  "assessment-has-consequence",
  "consequence-affects-entity",
  "fact-supported-by-evidence",
  "consequence-supported-by-evidence",
] as const;
export type ActionGraphRelation = (typeof ACTION_GRAPH_RELATIONS)[number];

export interface ActionGraphEdge {
  readonly id: ActionGraphEdgeId;
  readonly relation: ActionGraphRelation;
  readonly sourceNodeId: ActionGraphNodeId;
  readonly targetNodeId: ActionGraphNodeId;
  readonly targetRole?: ActionTargetRole;
}

export interface RelationEndpointKinds {
  readonly sourceKind: ActionGraphNodeKind;
  readonly targetKind: ActionGraphNodeKind;
}

export const RELATION_ENDPOINT_KINDS: Readonly<Record<ActionGraphRelation, RelationEndpointKinds>> =
  {
    "context-has-state": {
      sourceKind: "evaluation-context",
      targetKind: "state-snapshot",
    },
    "context-has-action": {
      sourceKind: "evaluation-context",
      targetKind: "proposed-action",
    },
    "state-has-entity": {
      sourceKind: "state-snapshot",
      targetKind: "entity",
    },
    "state-has-fact": {
      sourceKind: "state-snapshot",
      targetKind: "fact",
    },
    "fact-describes-entity": {
      sourceKind: "fact",
      targetKind: "entity",
    },
    "action-targets-entity": {
      sourceKind: "proposed-action",
      targetKind: "entity",
    },
    "assessment-for-context": {
      sourceKind: "assessment",
      targetKind: "evaluation-context",
    },
    "assessment-has-consequence": {
      sourceKind: "assessment",
      targetKind: "consequence",
    },
    "consequence-affects-entity": {
      sourceKind: "consequence",
      targetKind: "entity",
    },
    "fact-supported-by-evidence": {
      sourceKind: "fact",
      targetKind: "evidence",
    },
    "consequence-supported-by-evidence": {
      sourceKind: "consequence",
      targetKind: "evidence",
    },
  };

// ============================================================================
// 5. ACTIONGRAPH ROOT & SOURCE
// ============================================================================

export interface ActionGraphSource {
  readonly context: ActionEvaluationContext;
  readonly assessment?: ConsequenceAssessment;
}

export interface ActionGraph {
  readonly schemaVersion: ActionGraphSchemaVersion;
  readonly id: ActionGraphId;
  readonly generatedAt: IsoTimestamp;
  readonly source: ActionGraphSource;
  readonly nodes: readonly ActionGraphNode[];
  readonly edges: readonly ActionGraphEdge[];
}

// ============================================================================
// 6. SUBJECT & STRUCTURAL EDGE KEY HELPERS (INJECTIVE TUPLE ENCODING)
// ============================================================================

/**
 * Computes an injective canonical string key for an ActionGraphSubjectRef
 * using structured tuple serialization (JSON.stringify) to preserve element
 * boundaries and eliminate delimiter collision vulnerabilities (Findings H1, FC-003A).
 *
 * Preserves evidence owner qualification so that fact-owned and consequence-owned
 * evidence records sharing the same EvidenceId remain strictly distinct.
 */
export function getSubjectKey(subject: ActionGraphSubjectRef): string {
  switch (subject.kind) {
    case "evaluation-context":
      return JSON.stringify(["evaluation-context", subject.contextId]);
    case "state-snapshot":
      return JSON.stringify(["state-snapshot", subject.stateId]);
    case "entity":
      return JSON.stringify(["entity", subject.entityId]);
    case "fact":
      return JSON.stringify(["fact", subject.factId]);
    case "proposed-action":
      return JSON.stringify(["proposed-action", subject.actionId]);
    case "assessment":
      return JSON.stringify(["assessment", subject.assessmentId]);
    case "consequence":
      return JSON.stringify(["consequence", subject.consequenceId]);
    case "evidence":
      if (subject.owner.kind === "fact") {
        return JSON.stringify(["evidence", "fact", subject.owner.factId, subject.evidenceId]);
      }
      return JSON.stringify([
        "evidence",
        "consequence",
        subject.owner.consequenceId,
        subject.evidenceId,
      ]);
  }
}

/**
 * Computes an injective structural identity key for an ActionGraphEdge
 * using structured tuple serialization (JSON.stringify) with explicit null
 * for absent targetRole (Findings H2, FC-003A).
 */
export function getStructuralEdgeKey(edge: {
  readonly sourceNodeId: ActionGraphNodeId;
  readonly relation: ActionGraphRelation;
  readonly targetNodeId: ActionGraphNodeId;
  readonly targetRole?: ActionTargetRole;
}): string {
  return JSON.stringify([
    edge.sourceNodeId,
    edge.relation,
    edge.targetNodeId,
    edge.targetRole ?? null,
  ]);
}
