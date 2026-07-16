"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import ReactFlow, { Controls, type ReactFlowInstance } from "reactflow";
import { SkillNode } from "@/components/SkillNode";
import { TerritoryLayer } from "@/components/TerritoryLayer";
import {
  layoutSkillGraph,
  type SkillFlowEdge,
  type SkillFlowGraph,
  type SkillFlowNode,
  type SkillFlowNodeData,
} from "@/lib/layout";
import { SkillGraphSchema } from "@/lib/schema";

const nodeTypes = { skill: SkillNode };
const edgeTypes = {};
const proOptions = { hideAttribution: true } as const;

const loadingPhrases = [
  "surveying the territory…",
  "charting prerequisites…",
  "marking the trailheads…",
  "placing waypoints…",
  "drawing the map…",
];

const exampleGoals = [
  "become a UI/UX designer",
  "learn machine learning",
  "become a filmmaker",
  "start a bakery",
];

const LAYER_TOLERANCE = 24;
const BLOOM_START_DELAY = 80;
const LAYER_STAGGER = 120;
const NODE_DURATION = 350;
const GOAL_DURATION = 500;
const MAX_NODE_JITTER = 60;
const EDGE_PRE_REVEAL_CLASS = "map-edge--pre-reveal";

function removePreRevealClass(className: string | undefined): string | undefined {
  const nextClassName = className
    ?.split(/\s+/)
    .filter((name) => name && name !== EDGE_PRE_REVEAL_CLASS)
    .join(" ");

  return nextClassName || undefined;
}

function LoadingSequence({ active }: { active: boolean }) {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }

    const interval = window.setInterval(() => {
      setPhraseIndex((current) => (current + 1) % loadingPhrases.length);
    }, 2500);

    return () => window.clearInterval(interval);
  }, [active]);

  return (
    <div
      className={`generation-loading${active ? " generation-loading--visible" : ""}`}
      role="status"
      aria-live="polite"
      aria-hidden={!active}
    >
      <svg
        className="generation-loading__mark"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
      </svg>
      <p key={phraseIndex} className="generation-loading__phrase">
        {loadingPhrases[phraseIndex]}
      </p>
    </div>
  );
}

function getNodeLayers(nodes: SkillFlowNode[]): SkillFlowNode[][] {
  const sortedNodes = [...nodes].sort(
    (first, second) => first.position.y - second.position.y,
  );
  const layers: Array<{ y: number; nodes: SkillFlowNode[] }> = [];

  sortedNodes.forEach((node) => {
    const layer = layers.find(
      (candidate) => Math.abs(candidate.y - node.position.y) <= LAYER_TOLERANCE,
    );

    if (layer) {
      layer.nodes.push(node);
      return;
    }

    layers.push({ y: node.position.y, nodes: [node] });
  });

  const goalNode = nodes.find((node) => node.data.isGoal);
  const nonGoalLayers = layers
    .map((layer) =>
      layer.nodes.filter((node) => node.id !== goalNode?.id),
    )
    .filter((layer) => layer.length > 0);

  return goalNode ? [...nonGoalLayers, [goalNode]] : nonGoalLayers;
}

function BloomMap({ graph }: { graph: SkillFlowGraph }) {
  const [nodes, setNodes] = useState<SkillFlowNode[]>(() =>
    graph.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isPreReveal: true,
        revealDurationMs: node.data.isGoal ? GOAL_DURATION : NODE_DURATION,
      },
    })),
  );
  const [edges, setEdges] = useState<SkillFlowEdge[]>(() =>
    graph.edges.map((edge) => ({
      ...edge,
      className: [edge.className, EDGE_PRE_REVEAL_CLASS]
        .filter(Boolean)
        .join(" "),
      style: {
        ...edge.style,
        transition: "opacity 300ms ease-out",
      },
    })),
  );
  const [revealedClusters, setRevealedClusters] = useState<Set<string>>(
    () => new Set(),
  );
  const [isLegendExpanded, setIsLegendExpanded] = useState(true);
  const flowInstance = useRef<
    ReactFlowInstance<SkillFlowNodeData, SkillFlowEdge["data"]> | undefined
  >(undefined);

  useEffect(() => {
    const timeouts: number[] = [];
    const nodeAppearanceTimes = new Map<string, number>();
    const nodeJitters = new Map<string, number>();
    const layers = getNodeLayers(graph.nodes);
    let bloomCompleteAt = 0;

    layers.forEach((layer, layerIndex) => {
      layer.forEach((node) => {
        const jitter = Math.floor(Math.random() * (MAX_NODE_JITTER + 1));
        nodeJitters.set(node.id, jitter);
        const revealAt =
          BLOOM_START_DELAY + layerIndex * LAYER_STAGGER + jitter;
        const duration = node.data.isGoal ? GOAL_DURATION : NODE_DURATION;
        const appearedAt = revealAt + duration;

        nodeAppearanceTimes.set(node.id, appearedAt);
        bloomCompleteAt = Math.max(bloomCompleteAt, appearedAt);
      });
    });

    function revealLayer(layerIndex: number) {
      const layer = layers[layerIndex];
      if (!layer) {
        return;
      }

      setRevealedClusters((currentClusters) => {
        const nextClusters = new Set(currentClusters);
        layer.forEach((node) => nextClusters.add(node.data.cluster));
        return nextClusters;
      });

      layer.forEach((node) => {
        timeouts.push(
          window.setTimeout(() => {
            setNodes((currentNodes) =>
              currentNodes.map((currentNode) =>
                currentNode.id === node.id
                  ? {
                      ...currentNode,
                      data: { ...currentNode.data, isPreReveal: false },
                    }
                  : currentNode,
              ),
            );
          }, 60 + (nodeJitters.get(node.id) ?? 0)),
        );
      });

      if (layerIndex + 1 < layers.length) {
        timeouts.push(
          window.setTimeout(
            () => revealLayer(layerIndex + 1),
            LAYER_STAGGER,
          ),
        );
      }
    }

    timeouts.push(
      window.setTimeout(
        () => revealLayer(0),
        Math.max(0, BLOOM_START_DELAY - 60),
      ),
    );

    graph.edges.forEach((edge) => {
      const revealAt = Math.max(
        nodeAppearanceTimes.get(edge.source) ?? 0,
        nodeAppearanceTimes.get(edge.target) ?? 0,
      );
      bloomCompleteAt = Math.max(bloomCompleteAt, revealAt + 300);
      timeouts.push(
        window.setTimeout(() => {
          setEdges((currentEdges) =>
            currentEdges.map((currentEdge) =>
              currentEdge.id === edge.id
                ? {
                    ...currentEdge,
                    className: removePreRevealClass(currentEdge.className),
                  }
                : currentEdge,
            ),
          );
        }, revealAt),
      );
    });

    timeouts.push(
      window.setTimeout(() => {
        flowInstance.current?.fitView({ padding: 0.15, duration: 650 });
      }, bloomCompleteAt),
    );

    return () => timeouts.forEach((timeout) => window.clearTimeout(timeout));
  }, [graph]);

  useEffect(() => {
    const safetyTimeout = window.setTimeout(() => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => ({
          ...node,
          data: { ...node.data, isPreReveal: false },
        })),
      );
      setEdges((currentEdges) =>
        currentEdges.map((edge) => ({
          ...edge,
          className: removePreRevealClass(edge.className),
        })),
      );
      setRevealedClusters(
        new Set(graph.nodes.map((node) => node.data.cluster)),
      );
      flowInstance.current?.fitView({ padding: 0.15, duration: 300 });
    }, 3000);

    return () => window.clearTimeout(safetyTimeout);
  }, [graph]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      panOnDrag
      zoomOnScroll
      proOptions={proOptions}
      className="h-full w-full"
      onInit={(instance) => {
        flowInstance.current = instance;
      }}
    >
      <TerritoryLayer
        nodes={graph.nodes}
        revealedClusters={revealedClusters}
      />
      <Controls
        className="map-controls"
        position="bottom-left"
        showFitView={false}
        showInteractive={false}
      />
      <div
        className={`map-legend${
          isLegendExpanded ? "" : " map-legend--collapsed"
        }`}
        aria-label="Graph legend"
      >
        <button
          type="button"
          className="map-legend__toggle"
          onClick={() => setIsLegendExpanded((expanded) => !expanded)}
          aria-expanded={isLegendExpanded}
          aria-label={isLegendExpanded ? "Collapse legend" : "Expand legend"}
          title={isLegendExpanded ? "Collapse legend" : "Expand legend"}
        >
          ?
        </button>
        {isLegendExpanded ? (
          <div className="map-legend__content">
            <div className="map-legend__lines">
              <div className="map-legend__row">
                <span className="map-legend__line map-legend__line--solid" />
                <span>required path</span>
              </div>
              <div className="map-legend__row">
                <span className="map-legend__line map-legend__line--dashed" />
                <span>choose your route</span>
              </div>
            </div>
            <div className="map-legend__states">
              <span className="map-legend__state map-legend__state--available">
                available
              </span>
              <span className="map-legend__state map-legend__state--locked">
                locked
              </span>
              <span className="map-legend__state map-legend__state--mastered">
                mastered
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </ReactFlow>
  );
}

export default function Home() {
  const [goal, setGoal] = useState("");
  const [flowGraph, setFlowGraph] = useState<SkillFlowGraph | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateGraph(requestedGoal: string) {
    const trimmedGoal = requestedGoal.trim();
    if (!trimmedGoal) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/generate-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: trimmedGoal }),
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Failed to generate graph.";
        const details =
          typeof payload === "object" &&
          payload !== null &&
          "details" in payload &&
          typeof payload.details === "string"
            ? payload.details
            : null;

        throw new Error(details ? `${message}\n\n${details}` : message);
      }

      const graph = SkillGraphSchema.parse(payload);
      const nextFlowGraph = await layoutSkillGraph(graph);
      setFlowGraph(nextFlowGraph);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to generate graph.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void generateGraph(goal);
  }

  function handleExampleGoal(exampleGoal: string) {
    setGoal(exampleGoal);
    void generateGraph(exampleGoal);
  }

  return (
    <main className="app-shell relative h-screen w-screen overflow-hidden text-[var(--ink)]">
      {flowGraph ? (
        <BloomMap graph={flowGraph} />
      ) : (
        <div
          className={`landing-screen generation-form${isLoading ? " generation-form--hidden" : ""}`}
        >
          <svg
            className="landing-compass-rose"
            viewBox="0 0 420 420"
            aria-hidden="true"
          >
            <circle cx="210" cy="210" r="52.5" />
            <circle cx="210" cy="210" r="105" />
            <circle cx="210" cy="210" r="157.5" />
            <circle cx="210" cy="210" r="209.5" />
          </svg>
          <div className="landing-composition">
            <header className="landing-header">
              <h1 className="landing-wordmark">PathForge</h1>
              <p className="landing-thesis">
                Courses give you a syllabus. This gives you a map.
              </p>
            </header>
            <form onSubmit={handleSubmit} className="landing-form">
              <div className="landing-input-group">
                <input
                  id="goal"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  placeholder="Where do you want to go?"
                  className="landing-input"
                  aria-label="Learning goal"
                  disabled={isLoading}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={isLoading || !goal.trim()}
                  className="landing-forge-button"
                >
                  Forge
                </button>
              </div>
              <div className="landing-examples" aria-label="Example goals">
                {exampleGoals.map((exampleGoal) => (
                  <button
                    key={exampleGoal}
                    type="button"
                    className="landing-example-chip"
                    onClick={() => handleExampleGoal(exampleGoal)}
                    disabled={isLoading}
                  >
                    {exampleGoal}
                  </button>
                ))}
              </div>
              {error ? (
                <p className="landing-error">{error}</p>
              ) : null}
            </form>
          </div>
          <footer className="landing-footer">
            drawn by AI · built for the Codex hackathon
          </footer>
        </div>
      )}
      <LoadingSequence active={isLoading && !flowGraph} />
    </main>
  );
}
