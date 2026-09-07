/**
 * ActionGraph Basic One-Hop Query Utilities (Sprint FC-003)
 *
 * Provides lightweight, deterministic, non-mutating one-hop inspection helpers
 * over validated ActionGraph instances.
 *
 * Epistemological Boundary:
 * These helpers provide pure structural indexing over ActionGraph nodes and edges.
 * They explicitly do NOT implement causal reasoning, shortest-path calculation,
 * propagation modeling, consequence scoring, or graph neural networks.
 */

import {
  type ActionGraph,
  type ActionGraphEdge,
  type ActionGraphNode,
  type ActionGraphNodeId,
  type ActionGraphNodeKind,
  type ActionGraphRelation,
  type ActionGraphSubjectRef,
  getSubjectKey,
} from "./types.js";

/**
 * Retrieves a node by its ActionGraphNodeId.
 */
export function getNodeById(
  graph: ActionGraph,
  id: ActionGraphNodeId,
): ActionGraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/**
 * Retrieves all nodes of a specific ActionGraphNodeKind in deterministic graph order.
 */
export function getNodesByKind(
  graph: ActionGraph,
  kind: ActionGraphNodeKind,
): readonly ActionGraphNode[] {
  return graph.nodes.filter((n) => n.kind === kind);
}

/**
 * Finds a node matching the specified canonical subject reference.
 */
export function findNodeBySubject(
  graph: ActionGraph,
  subject: ActionGraphSubjectRef,
): ActionGraphNode | undefined {
  const targetKey = getSubjectKey(subject);
  return graph.nodes.find((n) => getSubjectKey(n.subject) === targetKey);
}

/**
 * Retrieves all outgoing edges originating from the specified node.
 */
export function getOutgoingEdges(
  graph: ActionGraph,
  nodeId: ActionGraphNodeId,
): readonly ActionGraphEdge[] {
  return graph.edges.filter((e) => e.sourceNodeId === nodeId);
}

/**
 * Retrieves all incoming edges terminating at the specified node.
 */
export function getIncomingEdges(
  graph: ActionGraph,
  nodeId: ActionGraphNodeId,
): readonly ActionGraphEdge[] {
  return graph.edges.filter((e) => e.targetNodeId === nodeId);
}

/**
 * Retrieves all neighbor nodes (both incoming and outgoing adjacent nodes)
 * for the specified node, returning a newly allocated, deduplicated readonly array.
 */
export function getNeighbors(
  graph: ActionGraph,
  nodeId: ActionGraphNodeId,
): readonly ActionGraphNode[] {
  const neighborIds = new Set<ActionGraphNodeId>();

  for (const edge of graph.edges) {
    if (edge.sourceNodeId === nodeId) {
      neighborIds.add(edge.targetNodeId);
    } else if (edge.targetNodeId === nodeId) {
      neighborIds.add(edge.sourceNodeId);
    }
  }

  return graph.nodes.filter((n) => neighborIds.has(n.id));
}

/**
 * Retrieves all edges with a specific ActionGraphRelation in deterministic graph order.
 */
export function getEdgesByRelation(
  graph: ActionGraph,
  relation: ActionGraphRelation,
): readonly ActionGraphEdge[] {
  return graph.edges.filter((e) => e.relation === relation);
}
