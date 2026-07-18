import { z } from "zod";

function normalizeGoalText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getGoalMatchScore(value: string, goal: string): number {
  const normalizedValue = normalizeGoalText(value);
  const normalizedGoal = normalizeGoalText(goal);

  if (!normalizedValue || !normalizedGoal) {
    return 0;
  }

  if (normalizedValue === normalizedGoal) {
    return 1;
  }

  if (
    normalizedValue.includes(normalizedGoal) ||
    normalizedGoal.includes(normalizedValue)
  ) {
    return 0.9 +
      (0.1 * Math.min(normalizedValue.length, normalizedGoal.length)) /
        Math.max(normalizedValue.length, normalizedGoal.length);
  }

  if (normalizedValue.length < 2 || normalizedGoal.length < 2) {
    return 0;
  }

  const valueBigrams = new Map<string, number>();
  for (let index = 0; index < normalizedValue.length - 1; index += 1) {
    const bigram = normalizedValue.slice(index, index + 2);
    valueBigrams.set(bigram, (valueBigrams.get(bigram) ?? 0) + 1);
  }

  let sharedBigrams = 0;
  for (let index = 0; index < normalizedGoal.length - 1; index += 1) {
    const bigram = normalizedGoal.slice(index, index + 2);
    const available = valueBigrams.get(bigram) ?? 0;

    if (available > 0) {
      sharedBigrams += 1;
      valueBigrams.set(bigram, available - 1);
    }
  }

  return (
    (2 * sharedBigrams) /
    (normalizedValue.length - 1 + (normalizedGoal.length - 1))
  );
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

export const NodeContentSchema = z
  .object({
    overview: z.string().min(1),
    project: z
      .object({
        title: z.string().min(1),
        brief: z.string().min(1),
      })
      .strict(),
    interviewQuestions: z.array(z.string().min(1)).length(5),
    estimatedEffort: z.enum(["days", "weeks", "months"]),
  })
  .strict();

export type NodeContent = z.infer<typeof NodeContentSchema>;

export const ReshapeResponseSchema = z
  .object({
    states: z.array(
      z
        .object({
          id: z.string().min(1),
          state: z.enum(["mastered", "available", "locked"]),
        })
        .strict(),
    ),
  })
  .strict();

export type ReshapeResponse = z.infer<typeof ReshapeResponseSchema>;

export function identifyGoalNode(graph: SkillGraph): SkillNode | undefined {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edges = getSanitizedEdges(graph.edges, nodeIds);
  const outgoingCounts = getOutgoingCounts(graph.nodes, edges);
  const sinks = graph.nodes.filter(
    (node) => (outgoingCounts.get(node.id) ?? 0) === 0,
  );

  if (sinks.length === 0) {
    return graph.nodes.reduce<{ node: SkillNode; score: number } | undefined>(
      (best, node) => {
        const score = getGoalMatchScore(node.label, graph.goal);
        return !best || score > best.score ? { node, score } : best;
      },
      undefined,
    )?.node;
  }

  const bestSinkMatch = sinks.reduce<
    { node: SkillNode; score: number } | undefined
  >((best, node) => {
    const score = Math.max(
      getGoalMatchScore(node.label, graph.goal),
      getGoalMatchScore(node.id, graph.goal),
    );
    return !best || score > best.score ? { node, score } : best;
  }, undefined);

  if (bestSinkMatch && bestSinkMatch.score > 0) {
    return bestSinkMatch.node;
  }

  const incomingCounts = new Map(graph.nodes.map((node) => [node.id, 0]));
  edges.forEach((edge) => {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
  });

  return sinks.reduce<SkillNode | undefined>((best, node) => {
    if (!best) {
      return node;
    }

    return (incomingCounts.get(node.id) ?? 0) >
      (incomingCounts.get(best.id) ?? 0)
      ? node
      : best;
  }, undefined);
}

export function repairGraph(graph: SkillGraph): SkillGraph {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const structurallyUsableEdges = getSanitizedEdges(graph.edges, nodeIds);
  const goalNode = identifyGoalNode({
    ...graph,
    edges: structurallyUsableEdges,
  }) ?? graph.nodes[graph.nodes.length - 1];

  let edges = structurallyUsableEdges.map((edge) =>
    edge.source === goalNode.id
      ? { ...edge, source: edge.target, target: edge.source }
      : edge,
  );

  edges = getSanitizedEdges(edges, nodeIds);
  const outgoingCounts = getOutgoingCounts(graph.nodes, edges);
  graph.nodes.forEach((node) => {
    if (
      node.id !== goalNode.id &&
      (outgoingCounts.get(node.id) ?? 0) === 0
    ) {
      edges.push({ source: node.id, target: goalNode.id, type: "requires" });
    }
  });

  edges = getSanitizedEdges(edges, nodeIds);

  for (let attempt = 0; attempt < graph.nodes.length; attempt += 1) {
    const reachableNodeIds = getReachableNodeIds(graph.nodes, edges, goalNode.id);
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
        { source: islandSink.id, target: goalNode.id, type: "requires" },
      ],
      nodeIds,
    );
  }

  const repairedGraph = {
    ...graph,
    edges,
  };
  const repairedOutgoingCounts = getOutgoingCounts(graph.nodes, edges);
  const repairedSinks = graph.nodes.filter(
    (node) => (repairedOutgoingCounts.get(node.id) ?? 0) === 0,
  );

  if (
    repairedSinks.length > 1 ||
    (repairedOutgoingCounts.get(goalNode.id) ?? 0) > 0
  ) {
    console.error(
      "repairGraph invariant failed:",
      JSON.stringify(repairedGraph, null, 2),
    );
  }

  return repairedGraph;
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

    const validEdges = getSanitizedEdges(graph.edges, nodeIds);
    const outgoingCounts = getOutgoingCounts(graph.nodes, validEdges);

    const goalNode = identifyGoalNode({ ...graph, edges: validEdges });
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
