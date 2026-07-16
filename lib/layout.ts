import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import { MarkerType, type Edge, type Node } from "reactflow";
import { darkenHexColor, getClusterTintMap } from "./clusters";
import type { SkillEdge, SkillGraph, SkillNode } from "./schema";

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 48;

export type SkillFlowNodeData = SkillNode & {
  isGoal: boolean;
  isPreReveal?: boolean;
  revealDurationMs?: number;
  clusterTint: string;
};

export type SkillFlowNode = Node<SkillFlowNodeData>;
export type SkillFlowEdge = Edge<SkillEdge>;

export type SkillFlowGraph = {
  nodes: SkillFlowNode[];
  edges: SkillFlowEdge[];
};

const elk = new ELK();

function createElkGraph(
  nodes: SkillNode[],
  edges: SkillEdge[],
  useModelOrder: boolean,
): ElkNode {
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "85",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      ...(useModelOrder
        ? {
            "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
          }
        : {}),
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: edges.map(
      (edge, index): ElkExtendedEdge => ({
        id: `${edge.source}-${edge.target}-${edge.type}-${index}`,
        sources: [edge.source],
        targets: [edge.target],
      }),
    ),
  };
}

function getValidPositions(
  layoutedGraph: ElkNode,
  nodes: SkillNode[],
): Map<string, { x: number; y: number }> {
  const positions = new Map(
    layoutedGraph.children?.map((node) => [
      node.id,
      { x: node.x, y: node.y },
    ]),
  );

  nodes.forEach((node) => {
    const position = positions.get(node.id);

    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      throw new Error(`ELK returned an invalid position for node ${node.id}.`);
    }
  });

  return positions as Map<string, { x: number; y: number }>;
}

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
  const outgoingNodeIds = new Set(validEdges.map((edge) => edge.source));
  const clusterTints = getClusterTintMap(graph.nodes);
  const nodesInClusterOrder = graph.nodes
    .map((node, index) => ({ node, index }))
    .sort(
      (first, second) =>
        first.node.cluster.localeCompare(second.node.cluster) ||
        first.index - second.index,
    )
    .map(({ node }) => node);

  let positions: Map<string, { x: number; y: number }>;
  try {
    const layoutedGraph = await elk.layout(
      createElkGraph(nodesInClusterOrder, validEdges, true),
    );
    positions = getValidPositions(layoutedGraph, graph.nodes);
  } catch {
    const layoutedGraph = await elk.layout(
      createElkGraph(graph.nodes, validEdges, false),
    );
    positions = getValidPositions(layoutedGraph, graph.nodes);
  }

  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        ...node,
        isGoal: !outgoingNodeIds.has(node.id),
        clusterTint: darkenHexColor(clusterTints.get(node.cluster) ?? "#E8DFD0"),
      },
      type: "skill",
      style: {
        width: NODE_WIDTH,
      },
    })),
    edges: validEdges.map((edge, index) => ({
      id: `${edge.source}-${edge.target}-${edge.type}-${index}`,
      source: edge.source,
      target: edge.target,
      data: edge,
      type: "default",
      style: {
        stroke: edge.type === "choice" ? "var(--ink-muted)" : "var(--line-faint)",
        strokeWidth: 1.25,
        strokeDasharray: edge.type === "choice" ? "5 4" : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: edge.type === "choice" ? "var(--ink-muted)" : "var(--line-faint)",
      },
    })),
  };
}
