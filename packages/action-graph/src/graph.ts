/**
 * Foundational ActionGraph relational placeholder model.
 */

export type NodeKind = "actor" | "action" | "target" | "state" | "consequence";

export interface ActionGraphNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly label: string;
}

export type EdgeRelation = "targets" | "depends_on" | "yields_consequence" | "originates_from";

export interface ActionGraphEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly relation: EdgeRelation;
}

export class ActionGraph {
  private readonly nodes = new Map<string, ActionGraphNode>();
  private readonly edges: ActionGraphEdge[] = [];

  public addNode(node: ActionGraphNode): void {
    this.nodes.set(node.id, node);
  }

  public getNode(id: string): ActionGraphNode | undefined {
    return this.nodes.get(id);
  }

  public addEdge(edge: ActionGraphEdge): void {
    if (!this.nodes.has(edge.sourceId) || !this.nodes.has(edge.targetId)) {
      throw new Error(
        `Cannot add edge: node ${edge.sourceId} or ${edge.targetId} does not exist in graph`,
      );
    }
    this.edges.push(edge);
  }

  public getOutgoingEdges(sourceId: string): readonly ActionGraphEdge[] {
    return this.edges.filter((e) => e.sourceId === sourceId);
  }

  public get nodeCount(): number {
    return this.nodes.size;
  }

  public get edgeCount(): number {
    return this.edges.length;
  }
}
