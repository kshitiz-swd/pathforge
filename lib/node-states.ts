import type { SkillEdge, SkillNode } from "./schema";

export type StatefulNode = Pick<SkillNode, "id" | "state">;
export type DependencyEdge = Pick<SkillEdge, "source" | "target">;
export type DerivedNodeState = {
  id: string;
  state: SkillNode["state"];
};

export function findTerminalGoalNodeId(
  nodes: readonly Pick<StatefulNode, "id">[],
  edges: readonly DependencyEdge[],
): string | undefined {
  const sourceIds = new Set(edges.map((edge) => edge.source));
  const terminalNodes = nodes.filter((node) => !sourceIds.has(node.id));

  return terminalNodes.length === 1 ? terminalNodes[0].id : undefined;
}

export function recomputeNodeStates(
  nodes: readonly StatefulNode[],
  edges: readonly DependencyEdge[],
  requestedMasteredIds: Iterable<string>,
): DerivedNodeState[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const goalNodeId = findTerminalGoalNodeId(nodes, edges);
  const masteredIds = new Set(
    [...requestedMasteredIds].filter(
      (id) => nodeIds.has(id) && id !== goalNodeId,
    ),
  );
  const prerequisitesByNode = new Map(
    nodes.map((node) => [node.id, [] as string[]]),
  );

  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      prerequisitesByNode.get(edge.target)?.push(edge.source);
    }
  });

  return nodes.map((node) => {
    if (masteredIds.has(node.id)) {
      return { id: node.id, state: "mastered" };
    }

    const prerequisites = prerequisitesByNode.get(node.id) ?? [];
    return {
      id: node.id,
      state: prerequisites.every((id) => masteredIds.has(id))
        ? "available"
        : "locked",
    };
  });
}
