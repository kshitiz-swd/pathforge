"use client";

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useStore } from "reactflow";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type SkillFlowNode,
} from "@/lib/layout";
import { CLUSTER_TINTS, getClusterTintMap } from "@/lib/clusters";

const TERRITORY_PADDING = 36;
const CORNER_RADIUS = 30;
const MAX_DENSITY_RATIO = 2.5;
const MAX_GRAPH_COVERAGE = 0.35;

type Point = {
  x: number;
  y: number;
};

type Territory = {
  cluster: string;
  tint: string;
  path: string;
  label: Point;
};

function cross(origin: Point, first: Point, second: Point): number {
  return (
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
  );
}

export function getConvexHull(points: Point[]): Point[] {
  const sortedPoints = [...new Map(
    points.map((point) => [`${point.x}:${point.y}`, point]),
  ).values()].sort((first, second) => first.x - second.x || first.y - second.y);

  if (sortedPoints.length <= 2) {
    return sortedPoints;
  }

  const lower: Point[] = [];
  sortedPoints.forEach((point) => {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  });

  const upper: Point[] = [];
  [...sortedPoints].reverse().forEach((point) => {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  });

  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function getPolygonArea(points: Point[]): number {
  return Math.abs(
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length];
      return area + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
}

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function moveToward(from: Point, to: Point, amount: number): Point {
  const segmentLength = distance(from, to);

  if (segmentLength === 0) {
    return from;
  }

  return {
    x: from.x + ((to.x - from.x) / segmentLength) * amount,
    y: from.y + ((to.y - from.y) / segmentLength) * amount,
  };
}

export function getRoundedHullPath(points: Point[]): string {
  if (points.length < 3) {
    return "";
  }

  const corners = points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const radius = Math.min(
      CORNER_RADIUS,
      distance(point, previous) / 2,
      distance(point, next) / 2,
    );

    return {
      point,
      start: moveToward(point, previous, radius),
      end: moveToward(point, next, radius),
    };
  });

  const commands = [
    `M ${corners[0].start.x} ${corners[0].start.y}`,
    `Q ${corners[0].point.x} ${corners[0].point.y} ${corners[0].end.x} ${corners[0].end.y}`,
  ];

  corners.slice(1).forEach((corner) => {
    commands.push(
      `L ${corner.start.x} ${corner.start.y}`,
      `Q ${corner.point.x} ${corner.point.y} ${corner.end.x} ${corner.end.y}`,
    );
  });

  commands.push(`L ${corners[0].start.x} ${corners[0].start.y} Z`);
  return commands.join(" ");
}

function getNodeSize(node: SkillFlowNode) {
  return {
    width: typeof node.style?.width === "number" ? node.style.width : NODE_WIDTH,
    height:
      typeof node.style?.height === "number" ? node.style.height : NODE_HEIGHT,
  };
}

function getGraphBoundsArea(nodes: SkillFlowNode[]): number {
  if (nodes.length === 0) {
    return 0;
  }

  const bounds = nodes.reduce(
    (current, node) => {
      const { width, height } = getNodeSize(node);
      return {
        minX: Math.min(current.minX, node.position.x),
        minY: Math.min(current.minY, node.position.y),
        maxX: Math.max(current.maxX, node.position.x + width),
        maxY: Math.max(current.maxY, node.position.y + height),
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );

  return (
    (bounds.maxX - bounds.minX + TERRITORY_PADDING * 2) *
    (bounds.maxY - bounds.minY + TERRITORY_PADDING * 2)
  );
}

function getLabelPosition(hull: Point[]): Point {
  const minY = Math.min(...hull.map((point) => point.y));
  const labelY = minY + 25;
  const intersections: number[] = [];

  hull.forEach((point, index) => {
    const next = hull[(index + 1) % hull.length];

    if (
      (point.y <= labelY && next.y > labelY) ||
      (next.y <= labelY && point.y > labelY)
    ) {
      const progress = (labelY - point.y) / (next.y - point.y);
      intersections.push(point.x + (next.x - point.x) * progress);
    }
  });

  return {
    x: (intersections.length > 0
      ? Math.min(...intersections)
      : Math.min(...hull.map((point) => point.x))) + 18,
    y: labelY,
  };
}

export function computeTerritories(nodes: SkillFlowNode[]): Territory[] {
  const tintMap = getClusterTintMap(nodes.map((node) => node.data));
  const graphBoundsArea = getGraphBoundsArea(nodes);
  const clusterNodes = new Map<string, SkillFlowNode[]>();

  nodes.forEach((node) => {
    const members = clusterNodes.get(node.data.cluster) ?? [];
    members.push(node);
    clusterNodes.set(node.data.cluster, members);
  });

  return [...clusterNodes.entries()].flatMap(([cluster, members]) => {
    const paddedCorners = members.flatMap((node) => {
      const { width, height } = getNodeSize(node);
      const left = node.position.x - TERRITORY_PADDING;
      const top = node.position.y - TERRITORY_PADDING;
      const right = node.position.x + width + TERRITORY_PADDING;
      const bottom = node.position.y + height + TERRITORY_PADDING;

      return [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ];
    });
    const hull = getConvexHull(paddedCorners);
    const hullArea = getPolygonArea(hull);
    const paddedMemberArea = members.reduce((area, node) => {
      const { width, height } = getNodeSize(node);
      return (
        area +
        (width + TERRITORY_PADDING * 2) *
          (height + TERRITORY_PADDING * 2)
      );
    }, 0);

    if (
      hull.length < 3 ||
      hullArea > paddedMemberArea * MAX_DENSITY_RATIO ||
      (graphBoundsArea > 0 && hullArea > graphBoundsArea * MAX_GRAPH_COVERAGE)
    ) {
      return [];
    }

    return [{
      cluster,
      tint: tintMap.get(cluster) ?? CLUSTER_TINTS[0],
      path: getRoundedHullPath(hull),
      label: getLabelPosition(hull),
    }];
  });
}

export function TerritoryLayer({ nodes }: { nodes: SkillFlowNode[] }) {
  const viewportNode = useStore((state) =>
    state.domNode?.querySelector(".react-flow__viewport"),
  );
  const territories = useMemo(() => computeTerritories(nodes), [nodes]);
  const revealDelaysByCluster = useMemo(() => {
    const delays = new Map<string, number>();

    nodes.forEach((node) => {
      const nodeDelay = node.data.revealDelayMs ?? 0;
      delays.set(
        node.data.cluster,
        Math.min(
          delays.get(node.data.cluster) ?? Number.POSITIVE_INFINITY,
          nodeDelay,
        ),
      );
    });

    return new Map(
      [...delays].map(([cluster, delay]) => [
        cluster,
        Math.max(0, delay - 100),
      ]),
    );
  }, [nodes]);

  if (!viewportNode) {
    return null;
  }

  return createPortal(
    <svg className="territory-layer" aria-hidden="true">
      {territories.map((territory) => (
        <g
          key={territory.cluster}
          className="territory"
          style={{
            animation: "territory-in 400ms ease-out backwards",
            animationDelay: `${revealDelaysByCluster.get(territory.cluster) ?? 0}ms`,
          }}
        >
          <path
            d={territory.path}
            fill={territory.tint}
            fillOpacity="0.35"
            stroke={territory.tint}
            strokeWidth="1"
          />
          <text
            x={territory.label.x}
            y={territory.label.y}
            className="territory__label"
          >
            {territory.cluster}
          </text>
        </g>
      ))}
    </svg>,
    viewportNode,
  );
}
