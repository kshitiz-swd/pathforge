export const CLUSTER_TINTS = [
  "#E8DFD0",
  "#DCE4DA",
  "#E4DCE0",
  "#D8E0E6",
  "#E6E0D2",
  "#DEE6E2",
] as const;

export function getClusterTintMap(
  nodes: Array<{ cluster: string }>,
): Map<string, string> {
  const clusterTints = new Map<string, string>();

  nodes.forEach((node) => {
    if (!clusterTints.has(node.cluster)) {
      clusterTints.set(
        node.cluster,
        CLUSTER_TINTS[clusterTints.size % CLUSTER_TINTS.length],
      );
    }
  });

  return clusterTints;
}

export function darkenHexColor(hex: string, amount = 0.2): string {
  const channels = [1, 3, 5].map((start) =>
    Math.round(Number.parseInt(hex.slice(start, start + 2), 16) * (1 - amount)),
  );

  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}
