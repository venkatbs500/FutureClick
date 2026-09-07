import { describe, expect, it } from "vitest";
import { ActionGraph } from "../src/index.js";

describe("action-graph/ActionGraph", () => {
  it("initializes an empty graph and adds nodes/edges", () => {
    const graph = new ActionGraph();
    expect(graph.nodeCount).toBe(0);
    expect(graph.edgeCount).toBe(0);

    graph.addNode({
      id: "act-1",
      kind: "action",
      label: "Delete Project",
    });

    graph.addNode({
      id: "tgt-1",
      kind: "target",
      label: "Project Alpha",
    });

    expect(graph.nodeCount).toBe(2);
    expect(graph.getNode("act-1")?.label).toBe("Delete Project");

    graph.addEdge({
      sourceId: "act-1",
      targetId: "tgt-1",
      relation: "targets",
    });

    expect(graph.edgeCount).toBe(1);
    const outgoing = graph.getOutgoingEdges("act-1");
    expect(outgoing.length).toBe(1);
    expect(outgoing[0]?.relation).toBe("targets");
  });

  it("throws error when adding an edge between non-existent nodes", () => {
    const graph = new ActionGraph();
    expect(() =>
      graph.addEdge({
        sourceId: "missing-1",
        targetId: "missing-2",
        relation: "targets",
      }),
    ).toThrow(/does not exist in graph/);
  });
});
