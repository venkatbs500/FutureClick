/**
 * ActionGraph Canonical Structural Test Suite (Sprint FC-003 / FC-003A)
 *
 * Covers:
 * - FC-003A Subject-Key Regression Matrix (Probes 1 - 8)
 * - FC-003A Structural-Edge-Key Regression Matrix (Probes 9 - 14)
 * - FC-003A Optional-Property Regression Matrix (Probes 15 - 23)
 * - FC-003A Immutability Regression Matrix (Probes 24 - 36)
 * - FC-003A Builder-Validity Regression Matrix (Probes 37 - 42)
 * - FC-003A External-Entity Regression Matrix (Probes 43 - 56)
 * - FC-003A Hostile-Validator Regression Matrix (Probes 57 - 64)
 * - Synthetic Domain Scenarios & Strengthened Tests (Detachment, Semantic Roundtrip, Same-Kind Tampering)
 */

import { describe, expect, it } from "vitest";
import { type IsoTimestamp, createDeterministicIdGenerator } from "@futureclick/shared";
import {
  type ActionEvaluationContext,
  type ActionId,
  type AssessmentId,
  type ConsequenceId,
  createActionEvaluationContext,
  createCanonicalEntity,
  createConfidenceScore,
  createConsequence,
  createConsequenceAssessment,
  createProposedAction,
  createStateFact,
  createStateSnapshot,
  type EntityId,
  type EvidenceId,
  type ObservationId,
} from "@futureclick/action-schema";
import {
  ACTION_GRAPH_SCHEMA_VERSION,
  type ActionGraph,
  type ActionGraphEdge,
  type ActionGraphEdgeId,
  type ActionGraphNode,
  type ActionGraphNodeId,
  buildActionGraph,
  findNodeBySubject,
  getEdgesByRelation,
  getIncomingEdges,
  getNeighbors,
  getNodeById,
  getNodesByKind,
  getOutgoingEdges,
  getStructuralEdgeKey,
  getSubjectKey,
  parseActionGraph,
  serializeActionGraph,
  validateActionGraph,
} from "../src/index.js";

// ============================================================================
// SAFE TEST HELPERS (NO NON-NULL ASSERTIONS)
// ============================================================================

function requireItem<T>(arr: readonly T[], index: number): T {
  const item = arr[index];
  if (item === undefined) {
    throw new Error(`Expected item at index ${index} to be defined.`);
  }
  return item;
}

function findRequiredNode(
  nodes: readonly ActionGraphNode[],
  predicate: (n: ActionGraphNode) => boolean,
): ActionGraphNode {
  const node = nodes.find(predicate);
  if (!node) {
    throw new Error("Expected node matching predicate to be defined.");
  }
  return node;
}

function findRequiredEdge(
  edges: readonly ActionGraphEdge[],
  predicate: (e: ActionGraphEdge) => boolean,
): ActionGraphEdge {
  const edge = edges.find(predicate);
  if (!edge) {
    throw new Error("Expected edge matching predicate to be defined.");
  }
  return edge;
}

// ============================================================================
// SYNTHETIC DOMAIN FIXTURES
// ============================================================================

function createSyntheticFilesystemContext(): ActionEvaluationContext {
  const desktopEnv = {
    environmentId: "env-macos-finder",
    kind: "filesystem" as const,
    platform: "macos" as const,
    application: { id: "com.apple.finder", name: "Finder", version: "14.5" },
  };

  const fileEntity = createCanonicalEntity({
    id: "ent-file-report-pdf" as EntityId,
    kind: "file",
    label: "Annual_Report_2026.pdf",
    attributes: {
      path: "/Users/alice/Documents/Annual_Report_2026.pdf",
      sizeBytes: 1048576,
      readOnly: false,
    },
  });

  const folderEntity = createCanonicalEntity({
    id: "ent-folder-documents" as EntityId,
    kind: "folder",
    label: "Documents",
    attributes: {
      path: "/Users/alice/Documents",
    },
  });

  const factFileExists = createStateFact({
    id: "fact-file-exists" as ObservationId,
    subjectEntityId: fileEntity.id,
    key: "filesystem.file_exists",
    value: true,
    observedAt: "2026-09-07T00:00:00.000Z" as IsoTimestamp,
    evidence: [
      {
        id: "ev-stat-call" as EvidenceId,
        mode: "verified",
        source: "adapter",
        observedAt: "2026-09-07T00:00:00.000Z" as IsoTimestamp,
        scope: "filesystem/stat",
        assumptions: [],
        confidence: createConfidenceScore(1.0),
        summary: "lstat64 returned st_mode S_IFREG",
      },
    ],
  });

  const state = createStateSnapshot({
    environment: desktopEnv,
    entities: [fileEntity, folderEntity],
    facts: [factFileExists],
    observedAt: "2026-09-07T00:00:00.000Z" as IsoTimestamp,
  });

  const deleteAction = createProposedAction({
    id: "act-delete-file" as ActionId,
    proposedAt: "2026-09-07T00:00:01.000Z" as IsoTimestamp,
    environment: desktopEnv,
    actor: { kind: "human", id: "user-alice" },
    intent: { verb: "delete", domain: "filesystem" },
    targets: [{ entityId: fileEntity.id, role: "primary" }],
    parameters: { recursive: false, permanent: false },
    executionStatus: "proposed",
  });

  return createActionEvaluationContext({ state, action: deleteAction });
}

function createSyntheticAssessment(context: ActionEvaluationContext) {
  const fileEntityId = requireItem(context.state.entities, 0).id;

  const consequence = createConsequence({
    id: "csq-file-disappears" as ConsequenceId,
    actionId: context.action.id,
    kind: "availability",
    summary: "File will be moved to system Trash and removed from directory.",
    affectedEntities: [fileEntityId],
    stateChanges: [
      {
        entityId: fileEntityId,
        property: "filesystem.file_exists",
        operation: "replace",
        before: { status: "known", value: true },
        after: { status: "known", value: false },
      },
    ],
    confidence: createConfidenceScore(0.95),
    reversibility: {
      level: "reversible",
      method: "Can be restored from Trash bin.",
    },
    risk: {
      severity: "low",
      categories: ["data-loss"],
      description: "temporary unavailability",
    },
    evidence: [
      {
        id: "ev-csq-sim" as EvidenceId,
        mode: "simulated",
        source: "engine",
        observedAt: "2026-09-07T00:00:02.000Z" as IsoTimestamp,
        scope: "consequence/trash_simulation",
        assumptions: [],
        confidence: createConfidenceScore(0.95),
        summary: "Dry-run moving file to ~/.Trash succeeded.",
      },
    ],
  });

  return createConsequenceAssessment({
    evaluationContextId: context.id,
    actionId: context.action.id,
    provenance: {
      source: "engine",
      engineVersion: "1.0.0",
      timestamp: "2026-09-07T00:00:02.000Z" as IsoTimestamp,
    },
    consequences: [consequence],
  });
}

function createDocumentSharingContext(): ActionEvaluationContext {
  const cloudEnv = {
    environmentId: "env-cloud-workspace",
    kind: "browser" as const,
    platform: "web" as const,
    application: { id: "app-drive", name: "Cloud Drive", version: "3.0" },
  };

  const docEntity = createCanonicalEntity({
    id: "ent-doc-budget" as EntityId,
    kind: "document",
    label: "Budget_2027.xlsx",
  });

  const recipientEntity = createCanonicalEntity({
    id: "ent-user-bob" as EntityId,
    kind: "account",
    label: "bob@example.com",
  });

  const state = createStateSnapshot({
    environment: cloudEnv,
    entities: [docEntity, recipientEntity],
    facts: [],
    observedAt: "2026-09-07T00:00:00.000Z" as IsoTimestamp,
  });

  const shareAction = createProposedAction({
    id: "act-share-doc" as ActionId,
    proposedAt: "2026-09-07T00:00:01.000Z" as IsoTimestamp,
    environment: cloudEnv,
    actor: { kind: "human", id: "user-alice" },
    intent: { verb: "share", domain: "collaboration" },
    targets: [
      { entityId: docEntity.id, role: "primary" },
      { entityId: recipientEntity.id, role: "recipient" },
    ],
    parameters: { role: "viewer", sendNotification: true },
    executionStatus: "proposed",
  });

  return createActionEvaluationContext({ state, action: shareAction });
}

function createExternalTargetContext(): ActionEvaluationContext {
  const env = {
    environmentId: "env-ext",
    kind: "filesystem" as const,
    platform: "macos" as const,
    application: { id: "com.apple.finder", name: "Finder", version: "14.5" },
  };

  const localFile = createCanonicalEntity({
    id: "ent-local-file" as EntityId,
    kind: "file",
    label: "report.pdf",
  });

  const state = createStateSnapshot({
    environment: env,
    entities: [localFile],
    facts: [],
    observedAt: "2026-09-07T00:00:00.000Z" as IsoTimestamp,
  });

  const action = createProposedAction({
    id: "act-export-ext" as ActionId,
    proposedAt: "2026-09-07T00:00:01.000Z" as IsoTimestamp,
    environment: env,
    actor: { kind: "human", id: "user-1" },
    intent: { verb: "copy", domain: "storage" },
    targets: [
      { entityId: localFile.id, role: "source" },
      { entityId: "ent-ext-dest-cloud" as EntityId, role: "destination" },
    ],
    parameters: {},
  });

  return createActionEvaluationContext({ state, action });
}

function createExternalAffectedAssessment(context: ActionEvaluationContext) {
  const consequence = createConsequence({
    id: "csq-ext-affected" as ConsequenceId,
    actionId: context.action.id,
    kind: "availability",
    summary: "External cloud storage will receive exported artifact.",
    affectedEntities: ["ent-ext-dest-cloud" as EntityId],
    stateChanges: [],
    confidence: createConfidenceScore(0.9),
    reversibility: { level: "reversible" },
    risk: { severity: "low", categories: ["availability"] },
    evidence: [],
  });

  return createConsequenceAssessment({
    evaluationContextId: context.id,
    actionId: context.action.id,
    provenance: {
      source: "engine",
      engineVersion: "1.0.0",
      timestamp: "2026-09-07T00:00:02.000Z" as IsoTimestamp,
    },
    consequences: [consequence],
  });
}

// ============================================================================
// SUITE 1: SUBJECT KEY REGRESSION MATRIX (Probes 1 - 8 / Finding H1)
// ============================================================================

describe("FC-003A Subject-Key Regression Matrix (Section 36)", () => {
  it("Probe 1: ordinary entity subject key is stable and structured", () => {
    const key = getSubjectKey({ kind: "entity", entityId: "ent-file-1" as EntityId });
    expect(key).toBe(JSON.stringify(["entity", "ent-file-1"]));
  });

  it("Probe 2: same textual ID across entity and fact remains strictly distinct", () => {
    const sharedId = "shared-uuid-1234";
    const entityKey = getSubjectKey({ kind: "entity", entityId: sharedId as EntityId });
    const factKey = getSubjectKey({ kind: "fact", factId: sharedId as ObservationId });
    expect(entityKey).not.toBe(factKey);
  });

  it("Probe 3: fact evidence (a:b, c) differs from (a, b:c) - no delimiter collision", () => {
    const keyA = getSubjectKey({
      kind: "evidence",
      evidenceId: "c" as EvidenceId,
      owner: { kind: "fact", factId: "a:b" as ObservationId },
    });
    const keyB = getSubjectKey({
      kind: "evidence",
      evidenceId: "b:c" as EvidenceId,
      owner: { kind: "fact", factId: "a" as ObservationId },
    });
    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe(JSON.stringify(["evidence", "fact", "a:b", "c"]));
    expect(keyB).toBe(JSON.stringify(["evidence", "fact", "a", "b:c"]));
  });

  it("Probe 4: consequence evidence equivalent delimiter case differs strictly", () => {
    const keyA = getSubjectKey({
      kind: "evidence",
      evidenceId: "c" as EvidenceId,
      owner: { kind: "consequence", consequenceId: "a:b" as ConsequenceId },
    });
    const keyB = getSubjectKey({
      kind: "evidence",
      evidenceId: "b:c" as EvidenceId,
      owner: { kind: "consequence", consequenceId: "a" as ConsequenceId },
    });
    expect(keyA).not.toBe(keyB);
  });

  it("Probe 5: fact vs consequence owner with same evidence ID remains distinct", () => {
    const evId = "ev-common-1" as EvidenceId;
    const factOwnerKey = getSubjectKey({
      kind: "evidence",
      evidenceId: evId,
      owner: { kind: "fact", factId: "fact-1" as ObservationId },
    });
    const csqOwnerKey = getSubjectKey({
      kind: "evidence",
      evidenceId: evId,
      owner: { kind: "consequence", consequenceId: "csq-1" as ConsequenceId },
    });
    expect(factOwnerKey).not.toBe(csqOwnerKey);
  });

  it("Probe 6: quote and backslash containing IDs do not collide or produce invalid keys", () => {
    const keyA = getSubjectKey({
      kind: "evidence",
      evidenceId: "c" as EvidenceId,
      owner: { kind: "fact", factId: 'a"b' as ObservationId },
    });
    const keyB = getSubjectKey({
      kind: "evidence",
      evidenceId: '"b"c' as EvidenceId,
      owner: { kind: "fact", factId: "a" as ObservationId },
    });
    expect(keyA).not.toBe(keyB);
    expect(() => JSON.parse(keyA)).not.toThrow();
    expect(() => JSON.parse(keyB)).not.toThrow();
  });

  it("Probe 7: forged colliding owner fails validation", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    const evNode = findRequiredNode(graph.nodes, (n) => n.kind === "evidence");
    // Tamper evidence subject to point to an owner that does not exist in source
    const tamperedNodes = graph.nodes.map((n) =>
      n.id === evNode.id
        ? {
            ...n,
            subject: {
              kind: "evidence" as const,
              evidenceId: "ev-stat-call" as EvidenceId,
              owner: { kind: "fact" as const, factId: "fact-nonexistent" as ObservationId },
            },
          }
        : n,
    );

    const tamperedGraph = { ...graph, nodes: tamperedNodes };
    const res = validateActionGraph(tamperedGraph);
    expect(res.valid).toBe(false);
  });

  it("Probe 8: findNodeBySubject selects exact structured subject without confusion", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    const entityNode = findRequiredNode(graph.nodes, (n) => n.kind === "entity");
    const found = findNodeBySubject(graph, entityNode.subject);
    expect(found).toBeDefined();
    expect(found?.id).toBe(entityNode.id);

    const notFound = findNodeBySubject(graph, {
      kind: "entity",
      entityId: "ent-nonexistent" as EntityId,
    });
    expect(notFound).toBeUndefined();
  });
});

// ============================================================================
// SUITE 2: STRUCTURAL EDGE KEY REGRESSION MATRIX (Probes 9 - 14 / Finding H2)
// ============================================================================

describe("FC-003A Structural-Edge-Key Regression Matrix (Section 37)", () => {
  it("Probe 9: two formerly colliding structural tuples now differ strictly", () => {
    const key1 = getStructuralEdgeKey({
      sourceNodeId: "a:b" as ActionGraphNodeId,
      relation: "action-targets-entity",
      targetNodeId: "c" as ActionGraphNodeId,
      targetRole: "primary",
    });
    const key2 = getStructuralEdgeKey({
      sourceNodeId: "a" as ActionGraphNodeId,
      relation: "action-targets-entity",
      targetNodeId: "b:c" as ActionGraphNodeId,
      targetRole: "primary",
    });
    expect(key1).not.toBe(key2);
  });

  it("Probe 10: deleting one required edge rejects under completeness validation", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    // Delete one required edge
    const remainingEdges = graph.edges.slice(1);
    const tamperedGraph = { ...graph, edges: remainingEdges };
    const res = validateActionGraph(tamperedGraph);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INCOMPLETE_GRAPH_EDGES")).toBe(true);
  });

  it("Probe 11: exact duplicate edge with different EdgeId rejects under structural uniqueness", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    const firstEdge = requireItem(graph.edges, 0);
    const duplicateEdge: ActionGraphEdge = {
      ...firstEdge,
      id: "edge-new-distinct-id" as ActionGraphEdgeId,
    };

    const tamperedGraph = { ...graph, edges: [...graph.edges, duplicateEdge] };
    const res = validateActionGraph(tamperedGraph);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "DUPLICATE_STRUCTURAL_EDGE")).toBe(true);
  });

  it("Probe 12: same source/target with two distinct target roles remains representable", () => {
    const key1 = getStructuralEdgeKey({
      sourceNodeId: "node-act" as ActionGraphNodeId,
      relation: "action-targets-entity",
      targetNodeId: "node-ent" as ActionGraphNodeId,
      targetRole: "primary",
    });
    const key2 = getStructuralEdgeKey({
      sourceNodeId: "node-act" as ActionGraphNodeId,
      relation: "action-targets-entity",
      targetNodeId: "node-ent" as ActionGraphNodeId,
      targetRole: "destination",
    });
    expect(key1).not.toBe(key2);
  });

  it("Probe 13: targetRole participates in structural edge identity", () => {
    const keyPrimary = getStructuralEdgeKey({
      sourceNodeId: "node-act" as ActionGraphNodeId,
      relation: "action-targets-entity",
      targetNodeId: "node-ent" as ActionGraphNodeId,
      targetRole: "primary",
    });
    const keyRecipient = getStructuralEdgeKey({
      sourceNodeId: "node-act" as ActionGraphNodeId,
      relation: "action-targets-entity",
      targetNodeId: "node-ent" as ActionGraphNodeId,
      targetRole: "recipient",
    });
    expect(keyPrimary).not.toBe(keyRecipient);
  });

  it("Probe 14: absence of targetRole represented distinctly from any role", () => {
    const keyNoRole = getStructuralEdgeKey({
      sourceNodeId: "node-1" as ActionGraphNodeId,
      relation: "context-has-state",
      targetNodeId: "node-2" as ActionGraphNodeId,
    });
    const keyWithNull = JSON.stringify(["node-1", "context-has-state", "node-2", null]);
    expect(keyNoRole).toBe(keyWithNull);
  });
});

// ============================================================================
// SUITE 3: OPTIONAL PROPERTY REGRESSION MATRIX (Probes 15 - 23 / Finding M1)
// ============================================================================

describe("FC-003A Optional-Property Regression Matrix (Section 38)", () => {
  it("Probe 15: absent assessment is valid context-only graph", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    const res = validateActionGraph(graph);
    expect(res.valid).toBe(true);
    if (!res.valid) throw new Error("Expected valid");
    expect(res.value.source.assessment).toBeUndefined();
  });

  it("Probe 16: valid assessment is valid assessment-enriched graph", () => {
    const context = createSyntheticFilesystemContext();
    const assessment = createSyntheticAssessment(context);
    const graph = buildActionGraph({ context, assessment });
    const res = validateActionGraph(graph);
    expect(res.valid).toBe(true);
  });

  it("Probe 17: source with assessment: undefined is invalid (explicit undefined rejected)", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    const tamperedGraph = {
      ...graph,
      source: {
        context,
        assessment: undefined,
      },
    };
    const res = validateActionGraph(tamperedGraph);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_PROPERTY")).toBe(true);
  });

  it("Probe 18: throwing assessment getter fails closed without throwing", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    const hostileSource = {
      context,
      get assessment(): never {
        throw new Error("hostile assessment getter");
      },
    };
    const tamperedGraph = { ...graph, source: hostileSource };

    let res: ReturnType<typeof validateActionGraph> | undefined;
    expect(() => {
      res = validateActionGraph(tamperedGraph);
    }).not.toThrow();

    expect(res?.valid).toBe(false);
    expect(res?.issues.some((i) => i.code === "READ_ERROR")).toBe(true);
  });

  it("Probe 19: absent unrelated targetRole is valid", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    const stateEdge = findRequiredEdge(graph.edges, (e) => e.relation === "context-has-state");
    expect(Object.prototype.hasOwnProperty.call(stateEdge, "targetRole")).toBe(false);
    expect(validateActionGraph(graph).valid).toBe(true);
  });

  it("Probe 20: unrelated targetRole: undefined as own property is invalid", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    const tamperedEdges = graph.edges.map((e) =>
      e.relation === "context-has-state" ? Object.assign({}, e, { targetRole: undefined }) : e,
    );
    const tamperedGraph = { ...graph, edges: tamperedEdges };
    const res = validateActionGraph(tamperedGraph);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "UNEXPECTED_EDGE_PAYLOAD")).toBe(true);
  });

  it("Probe 21: throwing unrelated targetRole getter fails closed without throwing", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    const hostileEdge = {
      ...requireItem(graph.edges, 0),
      relation: "context-has-state" as const,
      get targetRole(): never {
        throw new Error("hostile targetRole getter");
      },
    };

    const tamperedEdges = [hostileEdge, ...graph.edges.slice(1)];
    const tamperedGraph = { ...graph, edges: tamperedEdges };

    let res: ReturnType<typeof validateActionGraph> | undefined;
    expect(() => {
      res = validateActionGraph(tamperedGraph);
    }).not.toThrow();
    expect(res?.valid).toBe(false);
    expect(res?.issues.some((i) => i.code === "READ_ERROR")).toBe(true);
  });

  it("Probe 22: optional builder generatedAt getter throwing is normalized to Error", () => {
    const context = createSyntheticFilesystemContext();
    expect(() =>
      buildActionGraph({
        context,
        get generatedAt(): never {
          throw "raw string throw";
        },
      }),
    ).toThrow(Error);
  });

  it("Probe 23: optional builder idGenerator getter throwing is normalized to Error", () => {
    const context = createSyntheticFilesystemContext();
    expect(() =>
      buildActionGraph({
        context,
        get idGenerator(): never {
          throw null;
        },
      }),
    ).toThrow(Error);
  });
});

// ============================================================================
// SUITE 4: IMMUTABILITY REGRESSION MATRIX (Probes 24 - 36 / Finding M2)
// ============================================================================

describe("FC-003A Immutability Regression Matrix (Section 39)", () => {
  it("Probe 24: graph root frozen", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    expect(Object.isFrozen(graph)).toBe(true);
  });

  it("Probe 25: graph.source frozen", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    expect(Object.isFrozen(graph.source)).toBe(true);
  });

  it("Probe 26: context frozen", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    expect(Object.isFrozen(graph.source.context)).toBe(true);
  });

  it("Probe 27: assessment frozen when present", () => {
    const context = createSyntheticFilesystemContext();
    const assessment = createSyntheticAssessment(context);
    const graph = buildActionGraph({ context, assessment });
    expect(Object.isFrozen(graph.source.assessment)).toBe(true);
  });

  it("Probe 28: nodes array frozen", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    expect(Object.isFrozen(graph.nodes)).toBe(true);
  });

  it("Probe 29: node frozen", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    expect(Object.isFrozen(requireItem(graph.nodes, 0))).toBe(true);
  });

  it("Probe 30: node subject frozen", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    expect(Object.isFrozen(requireItem(graph.nodes, 0).subject)).toBe(true);
  });

  it("Probe 31: evidence owner frozen", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    const evNode = findRequiredNode(graph.nodes, (n) => n.kind === "evidence");
    if (evNode.subject.kind === "evidence") {
      expect(Object.isFrozen(evNode.subject.owner)).toBe(true);
    }
  });

  it("Probe 32: edges array frozen", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    expect(Object.isFrozen(graph.edges)).toBe(true);
  });

  it("Probe 33: edge frozen", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    expect(Object.isFrozen(requireItem(graph.edges, 0))).toBe(true);
  });

  it("Probe 34: nested source action.parameters frozen", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    expect(Object.isFrozen(graph.source.context.action.parameters)).toBe(true);
  });

  it("Probe 35: caller input mutation does not alter graph", () => {
    const context = createSyntheticFilesystemContext();
    const originalActionId = context.action.id;
    const graph = buildActionGraph({ context });

    // Attempt caller mutation of source context
    try {
      (context as unknown as Record<string, unknown>).id = "mutated-ctx-id";
    } catch {
      // May throw in strict mode
    }

    expect(graph.source.context.action.id).toBe(originalActionId);
  });

  it("Probe 36: mutable graph input mutation does not alter validateActionGraph(...).value", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    // Create a mutable copy of the graph
    const mutableGraph = {
      schemaVersion: graph.schemaVersion,
      id: graph.id,
      generatedAt: graph.generatedAt,
      source: { context: graph.source.context },
      nodes: [...graph.nodes],
      edges: [...graph.edges],
    };

    const res = validateActionGraph(mutableGraph);
    expect(res.valid).toBe(true);
    if (!res.valid) throw new Error("Expected valid");

    // Mutate caller's mutable copy
    mutableGraph.nodes.length = 0;
    expect(res.value.nodes.length).toBeGreaterThan(0);
    expect(Object.isFrozen(res.value)).toBe(true);
    expect(Object.isFrozen(res.value.nodes)).toBe(true);
  });
});

// ============================================================================
// SUITE 5: BUILDER VALIDITY REGRESSION MATRIX (Probes 37 - 42 / Finding M3, M4)
// ============================================================================

describe("FC-003A Builder-Validity Regression Matrix (Section 40)", () => {
  it("Probe 37: constant duplicate generator causes builder failure with standard Error", () => {
    const context = createSyntheticFilesystemContext();
    const duplicateGen: import("@futureclick/shared").IdGenerator = {
      generate: <TBrand extends string>() =>
        "constant-duplicate-id" as import("@futureclick/shared").Brand<string, TBrand>,
      nextId: <TBrand extends string>() =>
        "constant-duplicate-id" as import("@futureclick/shared").Brand<string, TBrand>,
    };

    expect(() =>
      buildActionGraph({
        context,
        idGenerator: duplicateGen,
      }),
    ).toThrow(Error);
  });

  it("Probe 38: invalid generatedAt causes builder failure with standard Error", () => {
    const context = createSyntheticFilesystemContext();
    expect(() =>
      buildActionGraph({
        context,
        generatedAt: "invalid-timestamp-value" as unknown as IsoTimestamp,
      }),
    ).toThrow(/Invalid generatedAt timestamp/);
  });

  it("Probe 39: valid builder output authoritatively passes validateActionGraph", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });
    const validation = validateActionGraph(graph);
    expect(validation.valid).toBe(true);
  });

  it("Probe 40: hostile option thrown string becomes standard Error", () => {
    const context = createSyntheticFilesystemContext();
    expect(() =>
      buildActionGraph({
        context,
        get assessment(): never {
          throw "raw string failure";
        },
      }),
    ).toThrow(Error);
  });

  it("Probe 41: hostile option thrown null-prototype becomes standard Error", () => {
    const context = createSyntheticFilesystemContext();
    expect(() =>
      buildActionGraph({
        context,
        get assessment(): never {
          throw Object.create(null);
        },
      }),
    ).toThrow(Error);
  });

  it("Probe 42: hostile option thrown {toString:null} becomes standard Error", () => {
    const context = createSyntheticFilesystemContext();
    expect(() =>
      buildActionGraph({
        context,
        get assessment(): never {
          throw { toString: null };
        },
      }),
    ).toThrow(Error);
  });
});

// ============================================================================
// SUITE 6: EXTERNAL ENTITY REGRESSION MATRIX (Probes 43 - 56 / Finding M5)
// ============================================================================

describe("FC-003A External-Entity Regression Matrix (Section 41)", () => {
  it("Probe 43: external action target builds successfully", () => {
    const context = createExternalTargetContext();
    const graph = buildActionGraph({ context });
    expect(graph).toBeDefined();
  });

  it("Probe 44: external target entity node exists", () => {
    const context = createExternalTargetContext();
    const graph = buildActionGraph({ context });
    const extTargetNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-ext-dest-cloud",
    );
    expect(extTargetNode).toBeDefined();
  });

  it("Probe 45: external target edge exists with correct targetRole", () => {
    const context = createExternalTargetContext();
    const graph = buildActionGraph({ context });
    const extTargetNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-ext-dest-cloud",
    );
    const targetEdge = findRequiredEdge(
      graph.edges,
      (e) => e.relation === "action-targets-entity" && e.targetNodeId === extTargetNode.id,
    );
    expect(targetEdge.targetRole).toBe("destination");
  });

  it("Probe 46: external target has no state-has-entity edge", () => {
    const context = createExternalTargetContext();
    const graph = buildActionGraph({ context });
    const extTargetNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-ext-dest-cloud",
    );
    const stateHasExtEdge = graph.edges.find(
      (e) => e.relation === "state-has-entity" && e.targetNodeId === extTargetNode.id,
    );
    expect(stateHasExtEdge).toBeUndefined();
  });

  it("Probe 47: validator accepts builder output for external action target", () => {
    const context = createExternalTargetContext();
    const graph = buildActionGraph({ context });
    const validation = validateActionGraph(graph);
    expect(validation.valid).toBe(true);
  });

  it("Probe 48: external consequence affected entity builds successfully", () => {
    const context = createExternalTargetContext();
    const assessment = createExternalAffectedAssessment(context);
    const graph = buildActionGraph({ context, assessment });
    expect(graph).toBeDefined();
  });

  it("Probe 49: affected entity node exists", () => {
    const context = createExternalTargetContext();
    const assessment = createExternalAffectedAssessment(context);
    const graph = buildActionGraph({ context, assessment });
    const affNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-ext-dest-cloud",
    );
    expect(affNode).toBeDefined();
  });

  it("Probe 50: consequence-affects edge exists", () => {
    const context = createExternalTargetContext();
    const assessment = createExternalAffectedAssessment(context);
    const graph = buildActionGraph({ context, assessment });
    const affNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-ext-dest-cloud",
    );
    const csqEdge = findRequiredEdge(
      graph.edges,
      (e) => e.relation === "consequence-affects-entity" && e.targetNodeId === affNode.id,
    );
    expect(csqEdge).toBeDefined();
  });

  it("Probe 51: no forged state-has-entity edge for external consequence-affected entity", () => {
    const context = createExternalTargetContext();
    const assessment = createExternalAffectedAssessment(context);
    const graph = buildActionGraph({ context, assessment });
    const affNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-ext-dest-cloud",
    );
    const stateEdge = graph.edges.find(
      (e) => e.relation === "state-has-entity" && e.targetNodeId === affNode.id,
    );
    expect(stateEdge).toBeUndefined();
  });

  it("Probe 52: validator accepts builder output for external consequence affected entity", () => {
    const context = createExternalTargetContext();
    const assessment = createExternalAffectedAssessment(context);
    const graph = buildActionGraph({ context, assessment });
    const validation = validateActionGraph(graph);
    expect(validation.valid).toBe(true);
  });

  it("Probe 53: same EntityId across state and target produces exactly one entity node", () => {
    const context = createSyntheticFilesystemContext();
    const fileId = requireItem(context.state.entities, 0).id;
    expect(context.action.targets.some((t) => t.entityId === fileId)).toBe(true);

    const graph = buildActionGraph({ context });
    const matchingNodes = graph.nodes.filter(
      (n) => n.kind === "entity" && n.subject.kind === "entity" && n.subject.entityId === fileId,
    );
    expect(matchingNodes.length).toBe(1);
  });

  it("Probe 54: same EntityId across target and affected produces exactly one entity node", () => {
    const context = createExternalTargetContext();
    const assessment = createExternalAffectedAssessment(context);
    const graph = buildActionGraph({ context, assessment });

    const matchingNodes = graph.nodes.filter(
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-ext-dest-cloud",
    );
    expect(matchingNodes.length).toBe(1);
  });

  it("Probe 55: spurious EntityId appearing nowhere in source is rejected", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    const spuriousNode: ActionGraphNode = {
      id: "node-spurious-entity" as ActionGraphNodeId,
      kind: "entity",
      subject: { kind: "entity", entityId: "ent-nowhere-in-source" as EntityId },
    };

    const tamperedGraph = { ...graph, nodes: [...graph.nodes, spuriousNode] };
    const res = validateActionGraph(tamperedGraph);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "UNKNOWN_CANONICAL_SUBJECT")).toBe(true);
  });

  it("Probe 56: omitted external referenced entity node is rejected under completeness", () => {
    const context = createExternalTargetContext();
    const graph = buildActionGraph({ context });

    const extNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-ext-dest-cloud",
    );

    const filteredNodes = graph.nodes.filter((n) => n.id !== extNode.id);
    const filteredEdges = graph.edges.filter((e) => e.targetNodeId !== extNode.id);
    const tamperedGraph = { ...graph, nodes: filteredNodes, edges: filteredEdges };

    const res = validateActionGraph(tamperedGraph);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INCOMPLETE_GRAPH_NODES")).toBe(true);
  });
});

// ============================================================================
// SUITE 7: HOSTILE VALIDATOR REGRESSION MATRIX (Probes 57 - 64 / Finding M4)
// ============================================================================

describe("FC-003A Hostile-Validator Regression Matrix (Section 42)", () => {
  it("Probe 57: Object.create(null) fails closed without throwing", () => {
    const res = validateActionGraph(Object.create(null));
    expect(res.valid).toBe(false);
  });

  it("Probe 58: revoked Proxy fails closed without throwing", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    let res: ReturnType<typeof validateActionGraph> | undefined;
    expect(() => {
      res = validateActionGraph(proxy);
    }).not.toThrow();
    expect(res?.valid).toBe(false);
  });

  it("Probe 59: schemaVersion getter throwing string fails closed without throwing", () => {
    const hostile = {
      get schemaVersion(): never {
        throw "hostile string throw";
      },
    };
    let res: ReturnType<typeof validateActionGraph> | undefined;
    expect(() => {
      res = validateActionGraph(hostile);
    }).not.toThrow();
    expect(res?.valid).toBe(false);
  });

  it("Probe 60: schemaVersion getter throwing null fails closed without throwing", () => {
    const hostile = {
      get schemaVersion(): never {
        throw null;
      },
    };
    let res: ReturnType<typeof validateActionGraph> | undefined;
    expect(() => {
      res = validateActionGraph(hostile);
    }).not.toThrow();
    expect(res?.valid).toBe(false);
  });

  it("Probe 61: schemaVersion getter throwing null-prototype fails closed without throwing", () => {
    const hostile = {
      get schemaVersion(): never {
        throw Object.create(null);
      },
    };
    let res: ReturnType<typeof validateActionGraph> | undefined;
    expect(() => {
      res = validateActionGraph(hostile);
    }).not.toThrow();
    expect(res?.valid).toBe(false);
  });

  it("Probe 62: hostile diagnostic value {toString:null} cannot escape exception boundary", () => {
    const hostile = {
      schemaVersion: { toString: null },
    };
    let res: ReturnType<typeof validateActionGraph> | undefined;
    expect(() => {
      res = validateActionGraph(hostile);
    }).not.toThrow();
    expect(res?.valid).toBe(false);
  });

  it("Probe 63: hostile nodes getter fails closed without throwing", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    const hostileGraph = {
      ...graph,
      get nodes(): never {
        throw new Error("hostile nodes getter");
      },
    };

    let res: ReturnType<typeof validateActionGraph> | undefined;
    expect(() => {
      res = validateActionGraph(hostileGraph);
    }).not.toThrow();
    expect(res?.valid).toBe(false);
  });

  it("Probe 64: hostile edges getter fails closed without throwing", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    const hostileGraph = {
      ...graph,
      get edges(): never {
        throw new Error("hostile edges getter");
      },
    };

    let res: ReturnType<typeof validateActionGraph> | undefined;
    expect(() => {
      res = validateActionGraph(hostileGraph);
    }).not.toThrow();
    expect(res?.valid).toBe(false);
  });
});

// ============================================================================
// SUITE 8: STRENGTHENED DETACHMENT, ROUNDTRIP & SAME-KIND TAMPERING TESTS
// ============================================================================

describe("FC-003A Strengthened Detachment, Roundtrip & Same-Kind Tampering (Sections 33-35)", () => {
  it("verifies nested detachment of caller domain input", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    // Mutate caller input deeply
    try {
      (context.action.parameters as Record<string, unknown>).recursive = true;
      (context.action.parameters as Record<string, unknown>).newField = "evil";
    } catch {
      // Ignored if frozen
    }

    expect(graph.source.context.action.parameters.recursive).toBe(false);
    expect(
      (graph.source.context.action.parameters as Record<string, unknown>).newField,
    ).toBeUndefined();
  });

  it("verifies semantic deep equality after serialization round-trip", () => {
    const context = createSyntheticFilesystemContext();
    const assessment = createSyntheticAssessment(context);
    const idGen = createDeterministicIdGenerator("roundtrip");

    const graph = buildActionGraph({
      context,
      assessment,
      idGenerator: idGen,
      generatedAt: "2026-09-07T00:00:05.000Z" as IsoTimestamp,
    });

    const serRes = serializeActionGraph(graph);
    expect(serRes.ok).toBe(true);
    if (!serRes.ok) throw serRes.error;

    const parseRes = parseActionGraph(serRes.value);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) throw parseRes.error;

    const parsed = parseRes.value;
    expect(parsed.schemaVersion).toBe(graph.schemaVersion);
    expect(parsed.id).toBe(graph.id);
    expect(parsed.generatedAt).toBe(graph.generatedAt);
    expect(parsed.nodes.length).toBe(graph.nodes.length);
    expect(parsed.edges.length).toBe(graph.edges.length);
    expect(parsed.source.context.id).toBe(graph.source.context.id);
    expect(parsed.source.assessment?.id).toBe(graph.source.assessment?.id);

    // Compare each node subject and each edge relation and targetRole
    for (let i = 0; i < graph.nodes.length; i++) {
      expect(requireItem(parsed.nodes, i).kind).toBe(requireItem(graph.nodes, i).kind);
      expect(getSubjectKey(requireItem(parsed.nodes, i).subject)).toBe(
        getSubjectKey(requireItem(graph.nodes, i).subject),
      );
    }

    for (let i = 0; i < graph.edges.length; i++) {
      expect(requireItem(parsed.edges, i).relation).toBe(requireItem(graph.edges, i).relation);
      expect(requireItem(parsed.edges, i).targetRole).toBe(requireItem(graph.edges, i).targetRole);
      expect(getStructuralEdgeKey(requireItem(parsed.edges, i))).toBe(
        getStructuralEdgeKey(requireItem(graph.edges, i)),
      );
    }
  });

  it("rejects same-kind entity tampering on fact-describes-entity", () => {
    const context = createSyntheticFilesystemContext();
    const graph = buildActionGraph({ context });

    // Entities in filesystem context: [fileEntity, folderEntity]
    const fileNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-file-report-pdf",
    );
    const folderNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-folder-documents",
    );

    const factEdge = findRequiredEdge(graph.edges, (e) => e.relation === "fact-describes-entity");
    expect(factEdge.targetNodeId).toBe(fileNode.id);

    // Tamper edge to point to folderNode instead (both are entity nodes!)
    const tamperedEdges = graph.edges.map((e) =>
      e.id === factEdge.id ? { ...e, targetNodeId: folderNode.id } : e,
    );

    const res = validateActionGraph({ ...graph, edges: tamperedEdges });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_STRUCTURAL_EDGE")).toBe(true);
  });

  it("rejects same-kind entity tampering on action-targets-entity", () => {
    const context = createDocumentSharingContext();
    const graph = buildActionGraph({ context });

    const docNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-doc-budget",
    );
    const userNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" && n.subject.kind === "entity" && n.subject.entityId === "ent-user-bob",
    );

    const targetEdge = findRequiredEdge(
      graph.edges,
      (e) => e.relation === "action-targets-entity" && e.targetRole === "primary",
    );
    expect(targetEdge.targetNodeId).toBe(docNode.id);

    // Tamper target to userNode (both are entity nodes)
    const tamperedEdges = graph.edges.map((e) =>
      e.id === targetEdge.id ? { ...e, targetNodeId: userNode.id } : e,
    );

    const res = validateActionGraph({ ...graph, edges: tamperedEdges });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_STRUCTURAL_EDGE")).toBe(true);
  });

  it("rejects forged state-has-entity on external action target", () => {
    const context = createExternalTargetContext();
    const graph = buildActionGraph({ context });

    const stateNode = findRequiredNode(graph.nodes, (n) => n.kind === "state-snapshot");
    const extTargetNode = findRequiredNode(
      graph.nodes,
      (n) =>
        n.kind === "entity" &&
        n.subject.kind === "entity" &&
        n.subject.entityId === "ent-ext-dest-cloud",
    );

    // Add forged state-has-entity edge for external target
    const forgedEdge: ActionGraphEdge = {
      id: "edge-forged-state-has-ext" as ActionGraphEdgeId,
      relation: "state-has-entity",
      sourceNodeId: stateNode.id,
      targetNodeId: extTargetNode.id,
    };

    const tamperedGraph = { ...graph, edges: [...graph.edges, forgedEdge] };
    const res = validateActionGraph(tamperedGraph);
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_STRUCTURAL_EDGE")).toBe(true);
  });
});
