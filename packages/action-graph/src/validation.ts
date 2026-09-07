/**
 * ActionGraph Comprehensive Structural & Semantic Validation (Sprint FC-003 / FC-003A)
 *
 * Implements strict, fail-closed runtime validation for untrusted ActionGraph inputs.
 *
 * Enforces:
 * - Fail-closed exception safety on hostile inputs (throwing getters, revoked proxies, sparse arrays).
 * - Safe diagnostic message formatting without attacker-controlled toString coercion.
 * - ActionGraph schema version and opaque branded identifier validity.
 * - Source context authoritative validity and assessment-context lineage matching.
 * - Node structure, kind typing, and canonical subject references.
 * - Unique ActionGraphNodeId values and unique canonical subject mapping.
 * - Injective structured subject and structural edge keying (JSON.stringify tuple encoding).
 * - Complete structural node coverage of canonical source records (including external entity references).
 * - Edge structure, relation vocabulary, and endpoint existence.
 * - Edge relation source/target node kind matrix enforcement.
 * - Duplicate structural edge rejection.
 * - Edge consistency with canonical source relationships (no phantom/untrue edges).
 * - Complete structural edge coverage of canonical source relationships.
 * - Strict optional property semantics (absent vs present vs undefined vs read-error).
 * - Qualified evidence references preserving canonical ownership scopes.
 * - Deep runtime immutability on validated output snapshots via deepFreezeActionGraphValue.
 */

import {
  ACTION_TARGET_ROLES,
  type ActionEvaluationContext,
  type ActionId,
  type ActionTargetRole,
  type AssessmentId,
  type ConsequenceAssessment,
  type ConsequenceId,
  type EntityId,
  type EvaluationContextId,
  type EvidenceId,
  type ObservationId,
  type StateSnapshotId,
  type ValidationIssue,
  type ValidationResult,
  captureDenseArray,
  isPlainObject,
  readOwnProperty,
  validateActionEvaluationContext,
  validateConsequenceAssessment,
  validateId,
  validateIsoTimestamp,
} from "@futureclick/action-schema";
import {
  ACTION_GRAPH_NODE_KINDS,
  ACTION_GRAPH_RELATIONS,
  ACTION_GRAPH_SCHEMA_VERSION,
  type ActionGraph,
  type ActionGraphEdge,
  type ActionGraphEdgeId,
  type ActionGraphEvidenceOwner,
  type ActionGraphEvidenceSubject,
  type ActionGraphId,
  type ActionGraphNode,
  type ActionGraphNodeId,
  type ActionGraphNodeKind,
  type ActionGraphRelation,
  type ActionGraphSubjectRef,
  RELATION_ENDPOINT_KINDS,
  getStructuralEdgeKey,
  getSubjectKey,
} from "./types.js";
import { deepFreezeActionGraphValue } from "./freeze.js";

export { getStructuralEdgeKey, getSubjectKey };

const VALID_NODE_KINDS = new Set<string>(ACTION_GRAPH_NODE_KINDS);
const VALID_RELATIONS = new Set<string>(ACTION_GRAPH_RELATIONS);
const VALID_ACTION_TARGET_ROLES = new Set<ActionTargetRole>(ACTION_TARGET_ROLES);

/**
 * Safely formats an untrusted value for diagnostic reporting without invoking
 * attacker-controlled toString methods or getters (Finding M4 / Section 18).
 */
function safeFormatValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 50 ? `${value.slice(0, 47)}...` : value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  return typeof value;
}

/**
 * Validates an untrusted input as a canonical ActionGraph.
 * Fails closed without throwing on malformed or hostile inputs.
 */
export function validateActionGraph(input: unknown, path = "graph"): ValidationResult<ActionGraph> {
  try {
    return validateActionGraphInternal(input, path);
  } catch {
    return {
      valid: false,
      issues: [
        {
          code: "VALIDATION_ERROR",
          path,
          message: "ActionGraph validation failed closed on unhandled runtime exception.",
          severity: "error",
        },
      ],
    };
  }
}

function validateActionGraphInternal(input: unknown, path: string): ValidationResult<ActionGraph> {
  const issues: ValidationIssue[] = [];

  // Guard: Object structure
  if (!isPlainObject(input)) {
    return {
      valid: false,
      issues: [
        {
          code: "MALFORMED_GRAPH",
          path,
          message: "ActionGraph must be a non-null plain object.",
          severity: "error",
        },
      ],
    };
  }

  // 1. Schema Version
  const schemaProp = readOwnProperty(input, "schemaVersion");
  if (schemaProp.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: `${path}.schemaVersion`,
      message: 'Failed to read property "schemaVersion".',
      severity: "error",
    });
  } else if (schemaProp.status !== "present") {
    issues.push({
      code: "MISSING_REQUIRED_PROPERTY",
      path: `${path}.schemaVersion`,
      message: 'ActionGraph requires "schemaVersion".',
      severity: "error",
    });
  } else if (schemaProp.value !== ACTION_GRAPH_SCHEMA_VERSION) {
    issues.push({
      code: "INVALID_SCHEMA_VERSION",
      path: `${path}.schemaVersion`,
      message: `Unsupported ActionGraph schemaVersion "${safeFormatValue(schemaProp.value)}". Expected "${ACTION_GRAPH_SCHEMA_VERSION}".`,
      severity: "error",
    });
  }

  // 2. Graph ID
  let graphId: ActionGraphId | undefined;
  const idProp = readOwnProperty(input, "id");
  if (idProp.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: `${path}.id`,
      message: 'Failed to read property "id".',
      severity: "error",
    });
  } else if (idProp.status !== "present") {
    issues.push({
      code: "MISSING_REQUIRED_PROPERTY",
      path: `${path}.id`,
      message: 'ActionGraph requires "id".',
      severity: "error",
    });
  } else {
    const idRes = validateId<"ActionGraphId">(idProp.value, "ActionGraphId", `${path}.id`);
    if (!idRes.valid) {
      issues.push(...idRes.issues);
    } else {
      graphId = idRes.value as ActionGraphId;
    }
  }

  // 3. Generated At timestamp
  let generatedAt: import("@futureclick/shared").IsoTimestamp | undefined;
  const genProp = readOwnProperty(input, "generatedAt");
  if (genProp.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: `${path}.generatedAt`,
      message: 'Failed to read property "generatedAt".',
      severity: "error",
    });
  } else if (genProp.status !== "present") {
    issues.push({
      code: "MISSING_REQUIRED_PROPERTY",
      path: `${path}.generatedAt`,
      message: 'ActionGraph requires "generatedAt".',
      severity: "error",
    });
  } else {
    const genRes = validateIsoTimestamp(genProp.value, `${path}.generatedAt`);
    if (!genRes.valid) {
      issues.push(...genRes.issues);
    } else {
      generatedAt = genRes.value;
    }
  }

  // 4. Source
  let validatedContext: ActionEvaluationContext | undefined;
  let validatedAssessment: ConsequenceAssessment | undefined;
  const sourceProp = readOwnProperty(input, "source");
  if (sourceProp.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: `${path}.source`,
      message: 'Failed to read property "source".',
      severity: "error",
    });
  } else if (sourceProp.status !== "present" || !isPlainObject(sourceProp.value)) {
    issues.push({
      code: "INVALID_SOURCE",
      path: `${path}.source`,
      message: 'ActionGraph requires a valid plain object "source".',
      severity: "error",
    });
  } else {
    const sourceObj = sourceProp.value;
    const ctxProp = readOwnProperty(sourceObj, "context");
    if (ctxProp.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: `${path}.source.context`,
        message: 'Failed to read property "source.context".',
        severity: "error",
      });
    } else if (ctxProp.status !== "present") {
      issues.push({
        code: "MISSING_SOURCE_CONTEXT",
        path: `${path}.source.context`,
        message: 'ActionGraph source requires "context".',
        severity: "error",
      });
    } else {
      const ctxValidation = validateActionEvaluationContext(ctxProp.value);
      if (!ctxValidation.valid) {
        issues.push(...ctxValidation.issues);
      } else {
        validatedContext = ctxValidation.value;
      }
    }

    // Optional Assessment (Finding M1 / Section 7-9)
    const asmtProp = readOwnProperty(sourceObj, "assessment");
    if (asmtProp.status === "error") {
      issues.push({
        code: "READ_ERROR",
        path: `${path}.source.assessment`,
        message: 'Failed to read optional property "assessment".',
        severity: "error",
      });
    } else if (asmtProp.status === "present") {
      if (asmtProp.value === undefined) {
        issues.push({
          code: "INVALID_PROPERTY",
          path: `${path}.source.assessment`,
          message: 'Optional property "assessment" must not be present with value undefined.',
          severity: "error",
        });
      } else if (!validatedContext) {
        issues.push({
          code: "ASSESSMENT_WITHOUT_VALID_CONTEXT",
          path: `${path}.source.assessment`,
          message: "Assessment cannot be validated without a valid source context.",
          severity: "error",
        });
      } else {
        const asmtValidation = validateConsequenceAssessment(asmtProp.value, validatedContext);
        if (!asmtValidation.valid) {
          issues.push(...asmtValidation.issues);
        } else {
          validatedAssessment = asmtValidation.value;
        }
      }
    }
  }

  // 5. Nodes array validation
  const nodesProp = readOwnProperty(input, "nodes");
  if (nodesProp.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: `${path}.nodes`,
      message: 'Failed to read property "nodes".',
      severity: "error",
    });
  }
  const nodesCapture = captureDenseArray(nodesProp.status === "present" ? nodesProp.value : null);

  if (!nodesCapture.valid) {
    issues.push({
      code: "INVALID_NODES_COLLECTION",
      path: `${path}.nodes`,
      message: `ActionGraph "nodes" must be a non-sparse array (${nodesCapture.reason}).`,
      severity: "error",
    });
  }

  const validatedNodes: ActionGraphNode[] = [];
  const nodeById = new Map<ActionGraphNodeId, ActionGraphNode>();
  const nodeBySubjectKey = new Map<string, ActionGraphNode>();

  if (nodesCapture.valid) {
    for (let i = 0; i < nodesCapture.values.length; i++) {
      const rawNode = nodesCapture.values[i];
      const nodePath = `${path}.nodes[${i}]`;

      if (!isPlainObject(rawNode)) {
        issues.push({
          code: "MALFORMED_NODE",
          path: nodePath,
          message: "Node must be a plain object.",
          severity: "error",
        });
        continue;
      }

      // Node ID
      const nIdProp = readOwnProperty(rawNode, "id");
      let nodeId: ActionGraphNodeId | undefined;
      if (nIdProp.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${nodePath}.id`,
          message: 'Failed to read property "id".',
          severity: "error",
        });
      } else if (nIdProp.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${nodePath}.id`,
          message: 'Node requires "id".',
          severity: "error",
        });
      } else {
        const nIdRes = validateId<"ActionGraphNodeId">(
          nIdProp.value,
          "ActionGraphNodeId",
          `${nodePath}.id`,
        );
        if (!nIdRes.valid) {
          issues.push(...nIdRes.issues);
        } else {
          nodeId = nIdRes.value as ActionGraphNodeId;
        }
      }

      // Node Kind
      const kindProp = readOwnProperty(rawNode, "kind");
      let nodeKind: ActionGraphNodeKind | undefined;
      if (kindProp.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${nodePath}.kind`,
          message: 'Failed to read property "kind".',
          severity: "error",
        });
      } else if (kindProp.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${nodePath}.kind`,
          message: 'Node requires "kind".',
          severity: "error",
        });
      } else if (typeof kindProp.value !== "string" || !VALID_NODE_KINDS.has(kindProp.value)) {
        issues.push({
          code: "INVALID_NODE_KIND",
          path: `${nodePath}.kind`,
          message: `Unknown node kind "${safeFormatValue(kindProp.value)}".`,
          severity: "error",
        });
      } else {
        nodeKind = kindProp.value as ActionGraphNodeKind;
      }

      // Node Subject Reference
      const subjProp = readOwnProperty(rawNode, "subject");
      let validatedSubject: ActionGraphSubjectRef | undefined;
      if (subjProp.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${nodePath}.subject`,
          message: 'Failed to read property "subject".',
          severity: "error",
        });
      } else if (subjProp.status !== "present" || !isPlainObject(subjProp.value)) {
        issues.push({
          code: "INVALID_NODE_SUBJECT",
          path: `${nodePath}.subject`,
          message: 'Node requires a plain object "subject".',
          severity: "error",
        });
      } else {
        const rawSubj = subjProp.value;
        const sKindProp = readOwnProperty(rawSubj, "kind");
        if (sKindProp.status === "error") {
          issues.push({
            code: "READ_ERROR",
            path: `${nodePath}.subject.kind`,
            message: 'Failed to read property "subject.kind".',
            severity: "error",
          });
        } else if (sKindProp.status !== "present" || sKindProp.value !== nodeKind) {
          issues.push({
            code: "SUBJECT_KIND_MISMATCH",
            path: `${nodePath}.subject.kind`,
            message: `Subject kind "${safeFormatValue(sKindProp.status === "present" ? sKindProp.value : undefined)}" must match node kind "${safeFormatValue(nodeKind)}".`,
            severity: "error",
          });
        } else if (nodeKind) {
          validatedSubject = validateSubjectRef(rawSubj, nodeKind, `${nodePath}.subject`, issues);
        }
      }

      // Optional Label (Finding M1)
      let nodeLabel: string | undefined;
      const labelProp = readOwnProperty(rawNode, "label");
      if (labelProp.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${nodePath}.label`,
          message: 'Failed to read optional property "label".',
          severity: "error",
        });
      } else if (labelProp.status === "present") {
        if (labelProp.value === undefined || typeof labelProp.value !== "string") {
          issues.push({
            code: "TYPE_MISMATCH",
            path: `${nodePath}.label`,
            message: "Node label must be a non-undefined string if provided.",
            severity: "error",
          });
        } else {
          nodeLabel = labelProp.value;
        }
      }

      if (nodeId && nodeKind && validatedSubject) {
        // Enforce Node ID uniqueness
        if (nodeById.has(nodeId)) {
          issues.push({
            code: "DUPLICATE_NODE_ID",
            path: `${nodePath}.id`,
            message: `Duplicate ActionGraphNodeId "${nodeId}".`,
            severity: "error",
          });
        }

        // Enforce Canonical Subject uniqueness (Requirement 42 / Injective tuple key)
        const subjectKey = getSubjectKey(validatedSubject);
        if (nodeBySubjectKey.has(subjectKey)) {
          issues.push({
            code: "DUPLICATE_CANONICAL_SUBJECT",
            path: `${nodePath}.subject`,
            message: `Duplicate node for canonical subject "${subjectKey}". Each canonical subject must map to exactly one node.`,
            severity: "error",
          });
        }

        const validNode: ActionGraphNode = {
          id: nodeId,
          kind: nodeKind,
          subject: validatedSubject,
          ...(nodeLabel !== undefined ? { label: nodeLabel } : {}),
        };

        validatedNodes.push(validNode);
        nodeById.set(nodeId, validNode);
        nodeBySubjectKey.set(subjectKey, validNode);
      }
    }
  }

  // 6. Edges array validation
  const edgesProp = readOwnProperty(input, "edges");
  if (edgesProp.status === "error") {
    issues.push({
      code: "READ_ERROR",
      path: `${path}.edges`,
      message: 'Failed to read property "edges".',
      severity: "error",
    });
  }
  const edgesCapture = captureDenseArray(edgesProp.status === "present" ? edgesProp.value : null);

  if (!edgesCapture.valid) {
    issues.push({
      code: "INVALID_EDGES_COLLECTION",
      path: `${path}.edges`,
      message: `ActionGraph "edges" must be a non-sparse array (${edgesCapture.reason}).`,
      severity: "error",
    });
  }

  const validatedEdges: ActionGraphEdge[] = [];
  const edgeById = new Map<ActionGraphEdgeId, ActionGraphEdge>();
  const structuralEdgeKeys = new Set<string>();

  if (edgesCapture.valid) {
    for (let i = 0; i < edgesCapture.values.length; i++) {
      const rawEdge = edgesCapture.values[i];
      const edgePath = `${path}.edges[${i}]`;

      if (!isPlainObject(rawEdge)) {
        issues.push({
          code: "MALFORMED_EDGE",
          path: edgePath,
          message: "Edge must be a plain object.",
          severity: "error",
        });
        continue;
      }

      // Edge ID
      const eIdProp = readOwnProperty(rawEdge, "id");
      let edgeId: ActionGraphEdgeId | undefined;
      if (eIdProp.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${edgePath}.id`,
          message: 'Failed to read property "id".',
          severity: "error",
        });
      } else if (eIdProp.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${edgePath}.id`,
          message: 'Edge requires "id".',
          severity: "error",
        });
      } else {
        const eIdRes = validateId<"ActionGraphEdgeId">(
          eIdProp.value,
          "ActionGraphEdgeId",
          `${edgePath}.id`,
        );
        if (!eIdRes.valid) {
          issues.push(...eIdRes.issues);
        } else {
          edgeId = eIdRes.value as ActionGraphEdgeId;
        }
      }

      // Edge Relation
      const relProp = readOwnProperty(rawEdge, "relation");
      let relation: ActionGraphRelation | undefined;
      if (relProp.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${edgePath}.relation`,
          message: 'Failed to read property "relation".',
          severity: "error",
        });
      } else if (relProp.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${edgePath}.relation`,
          message: 'Edge requires "relation".',
          severity: "error",
        });
      } else if (typeof relProp.value !== "string" || !VALID_RELATIONS.has(relProp.value)) {
        issues.push({
          code: "INVALID_EDGE_RELATION",
          path: `${edgePath}.relation`,
          message: `Unknown edge relation "${safeFormatValue(relProp.value)}".`,
          severity: "error",
        });
      } else {
        relation = relProp.value as ActionGraphRelation;
      }

      // Edge sourceNodeId
      const srcProp = readOwnProperty(rawEdge, "sourceNodeId");
      let sourceNodeId: ActionGraphNodeId | undefined;
      if (srcProp.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${edgePath}.sourceNodeId`,
          message: 'Failed to read property "sourceNodeId".',
          severity: "error",
        });
      } else if (srcProp.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${edgePath}.sourceNodeId`,
          message: 'Edge requires "sourceNodeId".',
          severity: "error",
        });
      } else {
        const srcRes = validateId<"ActionGraphNodeId">(
          srcProp.value,
          "ActionGraphNodeId",
          `${edgePath}.sourceNodeId`,
        );
        if (!srcRes.valid) {
          issues.push(...srcRes.issues);
        } else {
          sourceNodeId = srcRes.value as ActionGraphNodeId;
        }
      }

      // Edge targetNodeId
      const tgtProp = readOwnProperty(rawEdge, "targetNodeId");
      let targetNodeId: ActionGraphNodeId | undefined;
      if (tgtProp.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${edgePath}.targetNodeId`,
          message: 'Failed to read property "targetNodeId".',
          severity: "error",
        });
      } else if (tgtProp.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${edgePath}.targetNodeId`,
          message: 'Edge requires "targetNodeId".',
          severity: "error",
        });
      } else {
        const tgtRes = validateId<"ActionGraphNodeId">(
          tgtProp.value,
          "ActionGraphNodeId",
          `${edgePath}.targetNodeId`,
        );
        if (!tgtRes.valid) {
          issues.push(...tgtRes.issues);
        } else {
          targetNodeId = tgtRes.value as ActionGraphNodeId;
        }
      }

      // Edge targetRole payload (Finding M1 / Section 10)
      const roleProp = readOwnProperty(rawEdge, "targetRole");
      let targetRole: ActionTargetRole | undefined;

      if (relation === "action-targets-entity") {
        if (roleProp.status === "error") {
          issues.push({
            code: "READ_ERROR",
            path: `${edgePath}.targetRole`,
            message:
              'Failed to read required property "targetRole" for relation "action-targets-entity".',
            severity: "error",
          });
        } else if (roleProp.status === "absent") {
          issues.push({
            code: "MISSING_ACTION_TARGET_ROLE",
            path: `${edgePath}.targetRole`,
            message: 'Relation "action-targets-entity" requires "targetRole".',
            severity: "error",
          });
        } else if (
          roleProp.value === undefined ||
          typeof roleProp.value !== "string" ||
          !VALID_ACTION_TARGET_ROLES.has(roleProp.value as ActionTargetRole)
        ) {
          issues.push({
            code: "INVALID_ACTION_TARGET_ROLE",
            path: `${edgePath}.targetRole`,
            message: `Invalid targetRole "${safeFormatValue(roleProp.value)}".`,
            severity: "error",
          });
        } else {
          targetRole = roleProp.value as ActionTargetRole;
        }
      } else {
        // Unrelated relation: targetRole MUST be ABSENT
        if (roleProp.status === "error") {
          issues.push({
            code: "READ_ERROR",
            path: `${edgePath}.targetRole`,
            message: `Failed to read property "targetRole" on relation "${safeFormatValue(relation)}".`,
            severity: "error",
          });
        } else if (roleProp.status === "present") {
          issues.push({
            code: "UNEXPECTED_EDGE_PAYLOAD",
            path: `${edgePath}.targetRole`,
            message: `Relation "${relation}" must not specify "targetRole" (must be absent).`,
            severity: "error",
          });
        }
      }

      if (edgeId && relation && sourceNodeId && targetNodeId) {
        // Enforce Edge ID uniqueness
        if (edgeById.has(edgeId)) {
          issues.push({
            code: "DUPLICATE_EDGE_ID",
            path: `${edgePath}.id`,
            message: `Duplicate ActionGraphEdgeId "${edgeId}".`,
            severity: "error",
          });
        }

        // Endpoint existence (Requirement 23C, 23D)
        const sourceNode = nodeById.get(sourceNodeId);
        const targetNode = nodeById.get(targetNodeId);

        if (!sourceNode) {
          issues.push({
            code: "MISSING_EDGE_ENDPOINT",
            path: `${edgePath}.sourceNodeId`,
            message: `Edge sourceNodeId "${sourceNodeId}" does not exist in graph nodes.`,
            severity: "error",
          });
        }
        if (!targetNode) {
          issues.push({
            code: "MISSING_EDGE_ENDPOINT",
            path: `${edgePath}.targetNodeId`,
            message: `Edge targetNodeId "${targetNodeId}" does not exist in graph nodes.`,
            severity: "error",
          });
        }

        // Relation Endpoint Kind Matrix (Requirement 24)
        if (sourceNode && targetNode) {
          const expectedKinds = RELATION_ENDPOINT_KINDS[relation];
          if (
            sourceNode.kind !== expectedKinds.sourceKind ||
            targetNode.kind !== expectedKinds.targetKind
          ) {
            issues.push({
              code: "INVALID_EDGE_ENDPOINT_KIND",
              path: edgePath,
              message: `Relation "${relation}" requires ${expectedKinds.sourceKind} -> ${expectedKinds.targetKind}, but found ${sourceNode.kind} -> ${targetNode.kind}.`,
              severity: "error",
            });
          }
        }

        // Duplicate structural edge rejection (Finding H2 / Section 5)
        const structuralKey = getStructuralEdgeKey({
          sourceNodeId,
          relation,
          targetNodeId,
          ...(targetRole !== undefined ? { targetRole } : {}),
        });
        if (structuralEdgeKeys.has(structuralKey)) {
          issues.push({
            code: "DUPLICATE_STRUCTURAL_EDGE",
            path: edgePath,
            message: `Duplicate structural edge detected: "${structuralKey}".`,
            severity: "error",
          });
        }
        structuralEdgeKeys.add(structuralKey);

        const validEdge: ActionGraphEdge = {
          id: edgeId,
          relation,
          sourceNodeId,
          targetNodeId,
          ...(targetRole !== undefined ? { targetRole } : {}),
        };

        validatedEdges.push(validEdge);
        edgeById.set(edgeId, validEdge);
      }
    }
  }

  // 7. Canonical Completeness & Consistency Validation (Requirements 23F, 23G, 23H, 26, 27, 41; M5 / Sections 21-29)
  if (validatedContext) {
    verifyCanonicalSourceCompletenessAndConsistency({
      context: validatedContext,
      ...(validatedAssessment !== undefined ? { assessment: validatedAssessment } : {}),
      nodeById,
      nodeBySubjectKey,
      validatedEdges,
      structuralEdgeKeys,
      path,
      issues,
    });
  }

  if (issues.length > 0 || !graphId || !generatedAt || !validatedContext) {
    return {
      valid: false,
      issues,
    };
  }

  const validGraph: ActionGraph = {
    schemaVersion: ACTION_GRAPH_SCHEMA_VERSION,
    id: graphId,
    generatedAt,
    source: {
      context: validatedContext,
      ...(validatedAssessment ? { assessment: validatedAssessment } : {}),
    },
    nodes: Object.freeze(validatedNodes),
    edges: Object.freeze(validatedEdges),
  };

  // Deep runtime immutability (Finding M2 / Section 11, 12)
  return {
    valid: true,
    value: deepFreezeActionGraphValue(validGraph),
    issues: [],
  };
}

// ============================================================================
// INTERNAL VALIDATION HELPERS
// ============================================================================

function validateSubjectRef(
  rawSubj: Record<string, unknown>,
  kind: ActionGraphNodeKind,
  path: string,
  issues: ValidationIssue[],
): ActionGraphSubjectRef | undefined {
  switch (kind) {
    case "evaluation-context": {
      const p = readOwnProperty(rawSubj, "contextId");
      if (p.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${path}.contextId`,
          message: 'Failed to read property "contextId".',
          severity: "error",
        });
        return undefined;
      }
      if (p.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${path}.contextId`,
          message: 'Subject requires "contextId".',
          severity: "error",
        });
        return undefined;
      }
      const res = validateId<"EvaluationContextId">(
        p.value,
        "EvaluationContextId",
        `${path}.contextId`,
      );
      if (!res.valid) {
        issues.push(...res.issues);
        return undefined;
      }
      return { kind: "evaluation-context", contextId: res.value as EvaluationContextId };
    }

    case "state-snapshot": {
      const p = readOwnProperty(rawSubj, "stateId");
      if (p.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${path}.stateId`,
          message: 'Failed to read property "stateId".',
          severity: "error",
        });
        return undefined;
      }
      if (p.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${path}.stateId`,
          message: 'Subject requires "stateId".',
          severity: "error",
        });
        return undefined;
      }
      const res = validateId<"StateSnapshotId">(p.value, "StateSnapshotId", `${path}.stateId`);
      if (!res.valid) {
        issues.push(...res.issues);
        return undefined;
      }
      return { kind: "state-snapshot", stateId: res.value as StateSnapshotId };
    }

    case "entity": {
      const p = readOwnProperty(rawSubj, "entityId");
      if (p.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${path}.entityId`,
          message: 'Failed to read property "entityId".',
          severity: "error",
        });
        return undefined;
      }
      if (p.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${path}.entityId`,
          message: 'Subject requires "entityId".',
          severity: "error",
        });
        return undefined;
      }
      const res = validateId<"EntityId">(p.value, "EntityId", `${path}.entityId`);
      if (!res.valid) {
        issues.push(...res.issues);
        return undefined;
      }
      return { kind: "entity", entityId: res.value as EntityId };
    }

    case "fact": {
      const p = readOwnProperty(rawSubj, "factId");
      if (p.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${path}.factId`,
          message: 'Failed to read property "factId".',
          severity: "error",
        });
        return undefined;
      }
      if (p.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${path}.factId`,
          message: 'Subject requires "factId".',
          severity: "error",
        });
        return undefined;
      }
      const res = validateId<"ObservationId">(p.value, "ObservationId", `${path}.factId`);
      if (!res.valid) {
        issues.push(...res.issues);
        return undefined;
      }
      return { kind: "fact", factId: res.value as ObservationId };
    }

    case "proposed-action": {
      const p = readOwnProperty(rawSubj, "actionId");
      if (p.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${path}.actionId`,
          message: 'Failed to read property "actionId".',
          severity: "error",
        });
        return undefined;
      }
      if (p.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${path}.actionId`,
          message: 'Subject requires "actionId".',
          severity: "error",
        });
        return undefined;
      }
      const res = validateId<"ActionId">(p.value, "ActionId", `${path}.actionId`);
      if (!res.valid) {
        issues.push(...res.issues);
        return undefined;
      }
      return { kind: "proposed-action", actionId: res.value as ActionId };
    }

    case "assessment": {
      const p = readOwnProperty(rawSubj, "assessmentId");
      if (p.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${path}.assessmentId`,
          message: 'Failed to read property "assessmentId".',
          severity: "error",
        });
        return undefined;
      }
      if (p.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${path}.assessmentId`,
          message: 'Subject requires "assessmentId".',
          severity: "error",
        });
        return undefined;
      }
      const res = validateId<"AssessmentId">(p.value, "AssessmentId", `${path}.assessmentId`);
      if (!res.valid) {
        issues.push(...res.issues);
        return undefined;
      }
      return { kind: "assessment", assessmentId: res.value as AssessmentId };
    }

    case "consequence": {
      const p = readOwnProperty(rawSubj, "consequenceId");
      if (p.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${path}.consequenceId`,
          message: 'Failed to read property "consequenceId".',
          severity: "error",
        });
        return undefined;
      }
      if (p.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${path}.consequenceId`,
          message: 'Subject requires "consequenceId".',
          severity: "error",
        });
        return undefined;
      }
      const res = validateId<"ConsequenceId">(p.value, "ConsequenceId", `${path}.consequenceId`);
      if (!res.valid) {
        issues.push(...res.issues);
        return undefined;
      }
      return { kind: "consequence", consequenceId: res.value as ConsequenceId };
    }

    case "evidence": {
      const evProp = readOwnProperty(rawSubj, "evidenceId");
      if (evProp.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${path}.evidenceId`,
          message: 'Failed to read property "evidenceId".',
          severity: "error",
        });
        return undefined;
      }
      if (evProp.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${path}.evidenceId`,
          message: 'Evidence subject requires "evidenceId".',
          severity: "error",
        });
        return undefined;
      }
      const evRes = validateId<"EvidenceId">(evProp.value, "EvidenceId", `${path}.evidenceId`);
      if (!evRes.valid) {
        issues.push(...evRes.issues);
        return undefined;
      }

      const ownerProp = readOwnProperty(rawSubj, "owner");
      if (ownerProp.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${path}.owner`,
          message: 'Failed to read property "owner".',
          severity: "error",
        });
        return undefined;
      }
      if (ownerProp.status !== "present" || !isPlainObject(ownerProp.value)) {
        issues.push({
          code: "INVALID_EVIDENCE_OWNER",
          path: `${path}.owner`,
          message: 'Evidence subject requires a plain object "owner".',
          severity: "error",
        });
        return undefined;
      }

      const rawOwner = ownerProp.value;
      const ownerKindProp = readOwnProperty(rawOwner, "kind");
      if (ownerKindProp.status === "error") {
        issues.push({
          code: "READ_ERROR",
          path: `${path}.owner.kind`,
          message: 'Failed to read property "owner.kind".',
          severity: "error",
        });
        return undefined;
      }
      if (ownerKindProp.status !== "present") {
        issues.push({
          code: "MISSING_REQUIRED_PROPERTY",
          path: `${path}.owner.kind`,
          message: 'Evidence owner requires "kind".',
          severity: "error",
        });
        return undefined;
      }

      let validatedOwner: ActionGraphEvidenceOwner | undefined;

      if (ownerKindProp.value === "fact") {
        const fIdProp = readOwnProperty(rawOwner, "factId");
        if (fIdProp.status === "error") {
          issues.push({
            code: "READ_ERROR",
            path: `${path}.owner.factId`,
            message: 'Failed to read property "owner.factId".',
            severity: "error",
          });
          return undefined;
        }
        if (fIdProp.status !== "present") {
          issues.push({
            code: "MISSING_REQUIRED_PROPERTY",
            path: `${path}.owner.factId`,
            message: 'Fact evidence owner requires "factId".',
            severity: "error",
          });
          return undefined;
        }
        const fIdRes = validateId<"ObservationId">(
          fIdProp.value,
          "ObservationId",
          `${path}.owner.factId`,
        );
        if (!fIdRes.valid) {
          issues.push(...fIdRes.issues);
          return undefined;
        }
        validatedOwner = { kind: "fact", factId: fIdRes.value as ObservationId };
      } else if (ownerKindProp.value === "consequence") {
        const cIdProp = readOwnProperty(rawOwner, "consequenceId");
        if (cIdProp.status === "error") {
          issues.push({
            code: "READ_ERROR",
            path: `${path}.owner.consequenceId`,
            message: 'Failed to read property "owner.consequenceId".',
            severity: "error",
          });
          return undefined;
        }
        if (cIdProp.status !== "present") {
          issues.push({
            code: "MISSING_REQUIRED_PROPERTY",
            path: `${path}.owner.consequenceId`,
            message: 'Consequence evidence owner requires "consequenceId".',
            severity: "error",
          });
          return undefined;
        }
        const cIdRes = validateId<"ConsequenceId">(
          cIdProp.value,
          "ConsequenceId",
          `${path}.owner.consequenceId`,
        );
        if (!cIdRes.valid) {
          issues.push(...cIdRes.issues);
          return undefined;
        }
        validatedOwner = {
          kind: "consequence",
          consequenceId: cIdRes.value as ConsequenceId,
        };
      } else {
        issues.push({
          code: "INVALID_EVIDENCE_OWNER_KIND",
          path: `${path}.owner.kind`,
          message: `Invalid evidence owner kind "${safeFormatValue(ownerKindProp.value)}". Expected "fact" or "consequence".`,
          severity: "error",
        });
        return undefined;
      }

      const evidenceSubject: ActionGraphEvidenceSubject = {
        kind: "evidence",
        evidenceId: evRes.value as EvidenceId,
        owner: validatedOwner,
      };
      return evidenceSubject;
    }
  }
}

interface CompletenessVerificationParams {
  readonly context: ActionEvaluationContext;
  readonly assessment?: ConsequenceAssessment;
  readonly nodeById: Map<ActionGraphNodeId, ActionGraphNode>;
  readonly nodeBySubjectKey: Map<string, ActionGraphNode>;
  readonly validatedEdges: readonly ActionGraphEdge[];
  readonly structuralEdgeKeys: Set<string>;
  readonly path: string;
  readonly issues: ValidationIssue[];
}

function verifyCanonicalSourceCompletenessAndConsistency(
  params: CompletenessVerificationParams,
): void {
  const {
    context,
    assessment,
    nodeById: _nodeById,
    nodeBySubjectKey,
    validatedEdges,
    structuralEdgeKeys,
    path,
    issues,
  } = params;

  // Build expected node canonical subject keys (Finding M5 / Sections 21-29)
  const expectedSubjectKeys = new Set<string>();

  expectedSubjectKeys.add(getSubjectKey({ kind: "evaluation-context", contextId: context.id }));
  expectedSubjectKeys.add(getSubjectKey({ kind: "state-snapshot", stateId: context.state.id }));
  expectedSubjectKeys.add(getSubjectKey({ kind: "proposed-action", actionId: context.action.id }));

  // Entities: Union of state entities + action targets + consequence affected entities
  const canonicalEntityIds = new Set<EntityId>();

  for (const entity of context.state.entities) {
    canonicalEntityIds.add(entity.id);
  }
  for (const target of context.action.targets) {
    canonicalEntityIds.add(target.entityId);
  }
  if (assessment) {
    for (const csq of assessment.consequences) {
      for (const affId of csq.affectedEntities) {
        canonicalEntityIds.add(affId);
      }
    }
  }

  for (const entityId of canonicalEntityIds) {
    expectedSubjectKeys.add(getSubjectKey({ kind: "entity", entityId }));
  }

  for (const fact of context.state.facts) {
    expectedSubjectKeys.add(getSubjectKey({ kind: "fact", factId: fact.id }));
    const factEvidences = fact.evidence ?? [];
    for (const ev of factEvidences) {
      expectedSubjectKeys.add(
        getSubjectKey({
          kind: "evidence",
          evidenceId: ev.id,
          owner: { kind: "fact", factId: fact.id },
        }),
      );
    }
  }

  if (assessment) {
    expectedSubjectKeys.add(getSubjectKey({ kind: "assessment", assessmentId: assessment.id }));
    for (const csq of assessment.consequences) {
      expectedSubjectKeys.add(getSubjectKey({ kind: "consequence", consequenceId: csq.id }));
      for (const ev of csq.evidence) {
        expectedSubjectKeys.add(
          getSubjectKey({
            kind: "evidence",
            evidenceId: ev.id,
            owner: { kind: "consequence", consequenceId: csq.id },
          }),
        );
      }
    }
  }

  // A. Completeness: Ensure all expected canonical subjects have a corresponding node (Requirement 27, 41)
  for (const key of expectedSubjectKeys) {
    if (!nodeBySubjectKey.has(key)) {
      issues.push({
        code: "INCOMPLETE_GRAPH_NODES",
        path: `${path}.nodes`,
        message: `Graph is missing required canonical node for subject "${key}".`,
        severity: "error",
      });
    }
  }

  // B. Invariant 23F: Ensure no rogue node exists claiming a canonical subject not in source (Section 26)
  for (const [key] of nodeBySubjectKey) {
    if (!expectedSubjectKeys.has(key)) {
      issues.push({
        code: "UNKNOWN_CANONICAL_SUBJECT",
        path: `${path}.nodes`,
        message: `Graph contains node with canonical subject "${key}" not present in canonical source records.`,
        severity: "error",
      });
    }
  }

  // If core node errors exist, skip detailed edge completeness to avoid cascading noise
  const ctxNode = nodeBySubjectKey.get(
    getSubjectKey({ kind: "evaluation-context", contextId: context.id }),
  );
  const stateNode = nodeBySubjectKey.get(
    getSubjectKey({ kind: "state-snapshot", stateId: context.state.id }),
  );
  const actionNode = nodeBySubjectKey.get(
    getSubjectKey({ kind: "proposed-action", actionId: context.action.id }),
  );

  if (!ctxNode || !stateNode || !actionNode) {
    return;
  }

  // Build expected structural edge keys
  const expectedEdgeKeys = new Set<string>();

  expectedEdgeKeys.add(
    getStructuralEdgeKey({
      sourceNodeId: ctxNode.id,
      relation: "context-has-state",
      targetNodeId: stateNode.id,
    }),
  );
  expectedEdgeKeys.add(
    getStructuralEdgeKey({
      sourceNodeId: ctxNode.id,
      relation: "context-has-action",
      targetNodeId: actionNode.id,
    }),
  );

  // state-has-entity exists ONLY for StateSnapshot.entities (Finding M5 / Section 28)
  for (const entity of context.state.entities) {
    const entNode = nodeBySubjectKey.get(getSubjectKey({ kind: "entity", entityId: entity.id }));
    if (entNode) {
      expectedEdgeKeys.add(
        getStructuralEdgeKey({
          sourceNodeId: stateNode.id,
          relation: "state-has-entity",
          targetNodeId: entNode.id,
        }),
      );
    }
  }

  for (const fact of context.state.facts) {
    const factNode = nodeBySubjectKey.get(getSubjectKey({ kind: "fact", factId: fact.id }));
    const entNode = nodeBySubjectKey.get(
      getSubjectKey({ kind: "entity", entityId: fact.subjectEntityId }),
    );
    if (factNode) {
      expectedEdgeKeys.add(
        getStructuralEdgeKey({
          sourceNodeId: stateNode.id,
          relation: "state-has-fact",
          targetNodeId: factNode.id,
        }),
      );
      if (entNode) {
        expectedEdgeKeys.add(
          getStructuralEdgeKey({
            sourceNodeId: factNode.id,
            relation: "fact-describes-entity",
            targetNodeId: entNode.id,
          }),
        );
      }
      const factEvidences = fact.evidence ?? [];
      for (const ev of factEvidences) {
        const evNode = nodeBySubjectKey.get(
          getSubjectKey({
            kind: "evidence",
            evidenceId: ev.id,
            owner: { kind: "fact", factId: fact.id },
          }),
        );
        if (evNode) {
          expectedEdgeKeys.add(
            getStructuralEdgeKey({
              sourceNodeId: factNode.id,
              relation: "fact-supported-by-evidence",
              targetNodeId: evNode.id,
            }),
          );
        }
      }
    }
  }

  for (const target of context.action.targets) {
    const entNode = nodeBySubjectKey.get(
      getSubjectKey({ kind: "entity", entityId: target.entityId }),
    );
    if (entNode) {
      expectedEdgeKeys.add(
        getStructuralEdgeKey({
          sourceNodeId: actionNode.id,
          relation: "action-targets-entity",
          targetNodeId: entNode.id,
          targetRole: target.role,
        }),
      );
    }
  }

  if (assessment) {
    const asmtNode = nodeBySubjectKey.get(
      getSubjectKey({ kind: "assessment", assessmentId: assessment.id }),
    );
    if (asmtNode) {
      expectedEdgeKeys.add(
        getStructuralEdgeKey({
          sourceNodeId: asmtNode.id,
          relation: "assessment-for-context",
          targetNodeId: ctxNode.id,
        }),
      );

      for (const csq of assessment.consequences) {
        const csqNode = nodeBySubjectKey.get(
          getSubjectKey({ kind: "consequence", consequenceId: csq.id }),
        );
        if (csqNode) {
          expectedEdgeKeys.add(
            getStructuralEdgeKey({
              sourceNodeId: asmtNode.id,
              relation: "assessment-has-consequence",
              targetNodeId: csqNode.id,
            }),
          );
          for (const affId of csq.affectedEntities) {
            const entNode = nodeBySubjectKey.get(
              getSubjectKey({ kind: "entity", entityId: affId }),
            );
            if (entNode) {
              expectedEdgeKeys.add(
                getStructuralEdgeKey({
                  sourceNodeId: csqNode.id,
                  relation: "consequence-affects-entity",
                  targetNodeId: entNode.id,
                }),
              );
            }
          }
          for (const ev of csq.evidence) {
            const evNode = nodeBySubjectKey.get(
              getSubjectKey({
                kind: "evidence",
                evidenceId: ev.id,
                owner: { kind: "consequence", consequenceId: csq.id },
              }),
            );
            if (evNode) {
              expectedEdgeKeys.add(
                getStructuralEdgeKey({
                  sourceNodeId: csqNode.id,
                  relation: "consequence-supported-by-evidence",
                  targetNodeId: evNode.id,
                }),
              );
            }
          }
        }
      }
    }
  }

  // C. Completeness: Ensure all required structural edges are present (Requirement 27, 41)
  for (const expectedKey of expectedEdgeKeys) {
    if (!structuralEdgeKeys.has(expectedKey)) {
      issues.push({
        code: "INCOMPLETE_GRAPH_EDGES",
        path: `${path}.edges`,
        message: `Graph is missing required structural edge: "${expectedKey}".`,
        severity: "error",
      });
    }
  }

  // D. Consistency: Ensure all present edges correspond to real canonical relationships (Requirement 26, 23H)
  for (const edge of validatedEdges) {
    const edgeKey = getStructuralEdgeKey(edge);
    if (!expectedEdgeKeys.has(edgeKey)) {
      issues.push({
        code: "INVALID_STRUCTURAL_EDGE",
        path: `${path}.edges`,
        message: `Structural edge "${edgeKey}" does not correspond to an actual relationship in canonical source records.`,
        severity: "error",
      });
    }
  }
}
