import { describe, expect, it } from "vitest";
import { createDeterministicIdGenerator, type IsoTimestamp } from "@futureclick/shared";
import {
  createActionEvaluationContext,
  createCanonicalEntity,
  createProposedAction,
  createStateFact,
  createStateSnapshot,
  type EntityId,
  type ActionId,
  type ObservationId,
} from "@futureclick/action-schema";
import {
  buildActionGraph,
  getNodeById,
  getNodesByKind,
  getOutgoingEdges,
  getIncomingEdges,
  getNeighbors,
  findNodeBySubject,
  getEdgesByRelation,
  serializeActionGraph,
  parseActionGraph,
  type ActionGraphNodeId,
} from "../src/index.js";

function createSimpleContext() {
  const env = {
    environmentId: "env-test",
    kind: "terminal" as const,
    platform: "linux" as const,
    application: { id: "app-sh", name: "bash", version: "5.2" },
  };

  const entity = createCanonicalEntity({
    id: "ent-1" as EntityId,
    kind: "file",
    label: "test.txt",
  });

  const fact = createStateFact({
    id: "fact-1" as ObservationId,
    subjectEntityId: entity.id,
    key: "file.exists",
    value: true,
  });

  const state = createStateSnapshot({
    environment: env,
    entities: [entity],
    facts: [fact],
    observedAt: "2026-09-07T00:00:00.000Z" as IsoTimestamp,
  });

  const action = createProposedAction({
    id: "act-1" as ActionId,
    proposedAt: "2026-09-07T00:00:01.000Z" as IsoTimestamp,
    environment: env,
    actor: { kind: "human", id: "user-1" },
    intent: { verb: "execute", domain: "system" },
    targets: [{ entityId: entity.id, role: "primary" }],
    parameters: { force: true },
  });

  return createActionEvaluationContext({ state, action });
}

describe("action-graph/ActionGraph Core & Query API", () => {
  it("builds a canonical ActionGraph from context and executes query helpers", () => {
    const context = createSimpleContext();
    const idGen = createDeterministicIdGenerator("test");

    const graph = buildActionGraph({
      context,
      idGenerator: idGen,
      generatedAt: "2026-09-07T00:00:02.000Z" as IsoTimestamp,
    });

    expect(graph.schemaVersion).toBe("1.0");
    expect(graph.nodes.length).toBe(5); // context, state, action, entity, fact
    expect(graph.edges.length).toBe(6); // context->state, context->action, state->entity, state->fact, fact->entity, action->entity
    // 1: context-has-state
    // 2: context-has-action
    // 3: state-has-entity
    // 4: state-has-fact
    // 5: fact-describes-entity
    // 6: action-targets-entity

    // Query: getNodeById
    const ctxNode = graph.nodes[0];
    expect(ctxNode).toBeDefined();
    if (!ctxNode) throw new Error("Expected ctxNode");
    expect(getNodeById(graph, ctxNode.id)).toBe(ctxNode);
    expect(getNodeById(graph, "missing-node" as ActionGraphNodeId)).toBeUndefined();

    // Query: getNodesByKind
    const entities = getNodesByKind(graph, "entity");
    expect(entities.length).toBe(1);
    expect(entities[0]?.subject.kind).toBe("entity");

    // Query: findNodeBySubject
    const foundEntity = findNodeBySubject(graph, { kind: "entity", entityId: "ent-1" as EntityId });
    expect(foundEntity).toBeDefined();
    expect(foundEntity?.id).toBe(entities[0]?.id);

    // Query: getOutgoingEdges
    const ctxOutgoing = getOutgoingEdges(graph, ctxNode.id);
    expect(ctxOutgoing.length).toBe(2);
    expect(ctxOutgoing.map((e) => e.relation).sort()).toEqual([
      "context-has-action",
      "context-has-state",
    ]);

    // Query: getIncomingEdges
    const entityNode = entities[0];
    expect(entityNode).toBeDefined();
    if (!entityNode) throw new Error("Expected entityNode");
    const entIncoming = getIncomingEdges(graph, entityNode.id);
    expect(entIncoming.length).toBe(3); // state-has-entity, fact-describes-entity, action-targets-entity

    // Query: getNeighbors
    const stateNode = graph.nodes[1];
    expect(stateNode).toBeDefined();
    if (!stateNode) throw new Error("Expected stateNode");
    const stateNeighbors = getNeighbors(graph, stateNode.id);
    // State connects to context (incoming), entity (outgoing), fact (outgoing) => 3 neighbors
    expect(stateNeighbors.length).toBe(3);

    // Query: getEdgesByRelation
    const targetEdges = getEdgesByRelation(graph, "action-targets-entity");
    expect(targetEdges.length).toBe(1);
    expect(targetEdges[0]?.targetRole).toBe("primary");
  });

  it("serializes and parses ActionGraph preserving structure and values", () => {
    const context = createSimpleContext();
    const idGen = createDeterministicIdGenerator("ser");

    const graph = buildActionGraph({
      context,
      idGenerator: idGen,
      generatedAt: "2026-09-07T00:00:02.000Z" as IsoTimestamp,
    });

    const serRes = serializeActionGraph(graph);
    expect(serRes.ok).toBe(true);
    if (!serRes.ok) throw serRes.error;

    const parseRes = parseActionGraph(serRes.value);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) throw parseRes.error;
    expect(parseRes.value.id).toBe(graph.id);
    expect(parseRes.value.nodes.length).toBe(graph.nodes.length);
    expect(parseRes.value.edges.length).toBe(graph.edges.length);
  });
});
