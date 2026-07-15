import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import type { Edge, Node } from "reactflow";
import type { SkillEdge, SkillGraph, SkillNode } from "./schema";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 92;

export type SkillFlowNode = Node<SkillNode>;
export type SkillFlowEdge = Edge<SkillEdge>;

export type SkillFlowGraph = {
  nodes: SkillFlowNode[];
  edges: SkillFlowEdge[];
};

const elk = new ELK();

export async function layoutSkillGraph(graph: SkillGraph): Promise<SkillFlowGraph> {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const validEdges = graph.edges.filter((edge) => {
    const missingNodeIds = [edge.source, edge.target].filter(
      (nodeId) => !nodeIds.has(nodeId),
    );

    if (missingNodeIds.length > 0) {
      console.warn(
        `Dropping edge before layout because it references non-existent node id(s): ${missingNodeIds.join(", ")}. Every edge source/target must match an existing node id exactly.`,
      );
      return false;
    }

    return true;
  });

  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: validEdges.map(
      (edge, index): ElkExtendedEdge => ({
        id: `${edge.source}-${edge.target}-${edge.type}-${index}`,
        sources: [edge.source],
        targets: [edge.target],
      }),
    ),
  };

  const layoutedGraph = await elk.layout(elkGraph);
  const positions = new Map(
    layoutedGraph.children?.map((node) => [
      node.id,
      { x: node.x ?? 0, y: node.y ?? 0 },
    ]),
  );

  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: node,
      type: "default",
      style: {
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
      },
    })),
    edges: validEdges.map((edge, index) => ({
      id: `${edge.source}-${edge.target}-${edge.type}-${index}`,
      source: edge.source,
      target: edge.target,
      label: edge.type,
      data: edge,
      animated: edge.type === "choice",
    })),
  };
}
