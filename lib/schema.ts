import { z } from "zod";

function normalizeGoalText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getGoalMatchScore(label: string, goal: string): number {
  const normalizedLabel = normalizeGoalText(label);
  const normalizedGoal = normalizeGoalText(goal);

  if (!normalizedLabel || !normalizedGoal) {
    return 0;
  }

  if (normalizedLabel === normalizedGoal) {
    return 100;
  }

  const labelTokens = new Set(normalizedLabel.split(" "));
  const goalTokens = new Set(normalizedGoal.split(" "));
  const allTokens = new Set([...labelTokens, ...goalTokens]);
  const overlap = [...labelTokens].filter((token) => goalTokens.has(token)).length;
  const containmentScore =
    normalizedLabel.includes(normalizedGoal) || normalizedGoal.includes(normalizedLabel)
      ? 50
      : 0;

  return containmentScore + overlap / allTokens.size;
}

function findGoalNode(
  nodes: Array<{ id: string; label: string }>,
  goal: string,
): { id: string; label: string } | undefined {
  return nodes.reduce<{ node: { id: string; label: string }; score: number } | undefined>(
    (best, node) => {
      const score = getGoalMatchScore(node.label, goal);

      if (!best || score > best.score) {
        return { node, score };
      }

      return best;
    },
    undefined,
  )?.node;
}

function getEdgeKey(edge: SkillEdge): string {
  return `${edge.source}\u0000${edge.target}\u0000${edge.type}`;
}

function getSanitizedEdges(edges: SkillEdge[], nodeIds: Set<string>): SkillEdge[] {
  const seenEdges = new Set<string>();
  const sanitizedEdges: SkillEdge[] = [];

  edges.forEach((edge) => {
    if (
      !nodeIds.has(edge.source) ||
      !nodeIds.has(edge.target) ||
      edge.source === edge.target
    ) {
      return;
    }

    const edgeKey = getEdgeKey(edge);
    if (seenEdges.has(edgeKey)) {
      return;
    }

    seenEdges.add(edgeKey);
    sanitizedEdges.push(edge);
  });

  return sanitizedEdges;
}

function getOutgoingCounts(nodes: SkillNode[], edges: SkillEdge[]) {
  const outgoingCounts = new Map(nodes.map((node) => [node.id, 0]));

  edges.forEach((edge) => {
    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1);
  });

  return outgoingCounts;
}

function getReachableNodeIds(nodes: SkillNode[], edges: SkillEdge[], sinkId: string) {
  const reverseEdges = new Map<string, string[]>(
    nodes.map((node) => [node.id, []]),
  );

  edges.forEach((edge) => {
    reverseEdges.get(edge.target)?.push(edge.source);
  });

  const reachableNodeIds = new Set([sinkId]);
  const stack = [sinkId];

  while (stack.length > 0) {
    const nodeId = stack.pop();

    if (!nodeId) {
      continue;
    }

    reverseEdges.get(nodeId)?.forEach((sourceId) => {
      if (!reachableNodeIds.has(sourceId)) {
        reachableNodeIds.add(sourceId);
        stack.push(sourceId);
      }
    });
  }

  return reachableNodeIds;
}

export const SkillNodeSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    state: z.enum(["mastered", "available", "locked"]),
    cluster: z.string().min(1),
  })
  .strict();

export const SkillEdgeSchema = z
  .object({
    source: z.string().min(1),
    target: z.string().min(1),
    type: z.enum(["requires", "choice"]),
  })
  .strict();

export const SkillGraphBaseSchema = z
  .object({
    goal: z.string().min(1),
    nodes: z.array(SkillNodeSchema).min(1),
    edges: z.array(SkillEdgeSchema),
  })
  .strict();

export type SkillNode = z.infer<typeof SkillNodeSchema>;
export type SkillEdge = z.infer<typeof SkillEdgeSchema>;
export type SkillGraph = z.infer<typeof SkillGraphBaseSchema>;

export function repairGraph(graph: SkillGraph): SkillGraph {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const structurallyUsableEdges = getSanitizedEdges(graph.edges, nodeIds);
  const initialOutgoingCounts = getOutgoingCounts(
    graph.nodes,
    structurallyUsableEdges,
  );
  const initialSinks = graph.nodes.filter(
    (node) => (initialOutgoingCounts.get(node.id) ?? 0) === 0,
  );
  const goalSink =
    (initialSinks.length > 0
      ? findGoalNode(initialSinks, graph.goal)
      : undefined) ?? graph.nodes[graph.nodes.length - 1];

  let edges = graph.edges.map((edge) =>
    edge.source === goalSink.id
      ? { ...edge, source: edge.target, target: edge.source }
      : edge,
  );

  initialSinks.forEach((sink) => {
    if (sink.id !== goalSink.id) {
      edges.push({ source: sink.id, target: goalSink.id, type: "requires" });
    }
  });

  edges = getSanitizedEdges(edges, nodeIds);

  for (let attempt = 0; attempt < graph.nodes.length; attempt += 1) {
    const reachableNodeIds = getReachableNodeIds(graph.nodes, edges, goalSink.id);
    const unreachableNodes = graph.nodes.filter(
      (node) => !reachableNodeIds.has(node.id),
    );

    if (unreachableNodes.length === 0) {
      break;
    }

    const unreachableNodeIds = new Set(unreachableNodes.map((node) => node.id));
    const islandSink =
      unreachableNodes.find(
        (node) =>
          !edges.some(
            (edge) =>
              edge.source === node.id && unreachableNodeIds.has(edge.target),
          ),
      ) ?? unreachableNodes[unreachableNodes.length - 1];

    edges = getSanitizedEdges(
      [
        ...edges,
        { source: islandSink.id, target: goalSink.id, type: "requires" },
      ],
      nodeIds,
    );
  }

  return {
    ...graph,
    edges,
  };
}

export const SkillGraphSchema = SkillGraphBaseSchema.superRefine((graph, ctx) => {
    const nodeIds = new Set<string>();

    graph.nodes.forEach((node, index) => {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: `Duplicate node id: ${node.id}. Every node id must be unique.`,
        });
        return;
      }

      nodeIds.add(node.id);
    });

    graph.edges.forEach((edge, index) => {
      if (!nodeIds.has(edge.source)) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", index, "source"],
          message: `Edge references non-existent node id: ${edge.source}. Every edge source/target must match an existing node id exactly.`,
        });
      }

      if (!nodeIds.has(edge.target)) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", index, "target"],
          message: `Edge references non-existent node id: ${edge.target}. Every edge source/target must match an existing node id exactly.`,
        });
      }
    });

    const validEdges = graph.edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
    );
    const outgoingCounts = getOutgoingCounts(graph.nodes, validEdges);

    const goalNode = findGoalNode(graph.nodes, graph.goal);
    const sinks = graph.nodes.filter(
      (node) => (outgoingCounts.get(node.id) ?? 0) === 0,
    );
    const goalSink = sinks.find((node) => node.id === goalNode?.id);

    if (sinks.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message:
          "Graph has no final goal sink node. Exactly one node must have no outgoing edges, and that node must be the final goal.",
      });
    }

    if (sinks.length > 1) {
      sinks.forEach((sink) => {
        if (sink.id === goalSink?.id) {
          return;
        }

        const index = graph.nodes.indexOf(sink);
        ctx.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: `Node ${sink.id} is a dead end. Every node except the final goal node must have at least one outgoing edge leading toward the goal.`,
        });
      });
    }

    if (sinks.length === 1 && goalNode && sinks[0].id !== goalNode.id) {
      const index = graph.nodes.indexOf(sinks[0]);
      ctx.addIssue({
        code: "custom",
        path: ["nodes", index, "id"],
        message: `Node ${sinks[0].id} is a dead end. Every node except the final goal node must have at least one outgoing edge leading toward the goal.`,
      });
    }

    const sink = sinks.length === 1 ? sinks[0] : goalSink;

    if (sink) {
      const reachableNodeIds = getReachableNodeIds(graph.nodes, validEdges, sink.id);

      graph.nodes.forEach((node, index) => {
        if (!reachableNodeIds.has(node.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["nodes", index, "id"],
            message: `Node ${node.id} has no path to the goal node ${sink.id}. Add edges connecting it toward the goal.`,
          });
        }
      });
    }
  });
