"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import ReactFlow, { Controls, type ReactFlowInstance } from "reactflow";
import { NodePanel } from "@/components/NodePanel";
import { ReshapeBar } from "@/components/ReshapeBar";
import { SkillNode } from "@/components/SkillNode";
import { TerritoryLayer } from "@/components/TerritoryLayer";
import {
  layoutSkillGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  type SkillFlowEdge,
  type SkillFlowGraph,
  type SkillFlowNode,
  type SkillFlowNodeData,
} from "@/lib/layout";
import { recomputeNodeStates } from "@/lib/node-states";
import { ReshapeResponseSchema, SkillGraphSchema } from "@/lib/schema";

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
const LAYER_STAGGER = 120;
const NODE_DURATION = 350;
const EDGE_DURATION = 300;
const EDGE_DELAY = 200;
const MAX_NODE_JITTER = 60;
const RESHAPE_STAGGER = 150;
const MANY_STATE_CHANGES = 4;
const MASTERY_STORAGE_PREFIX = "pathforge:mastered:";

function getMasteryStorageKey(goal: string): string {
  return `${MASTERY_STORAGE_PREFIX}${goal}`;
}

function readPersistedMastery(goal: string): string[] {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(getMasteryStorageKey(goal)) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function persistMastery(goal: string, masteredIds: Iterable<string>) {
  try {
    window.localStorage.setItem(
      getMasteryStorageKey(goal),
      JSON.stringify([...masteredIds]),
    );
  } catch {
    // The state still updates when storage is unavailable.
  }
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
  const [bloomTiming] = useState(() => {
    const nodeDelays = new Map<string, number>();

    getNodeLayers(graph.nodes).forEach((layer, layerIndex) => {
      layer.forEach((node) => {
        const jitter = Math.floor(Math.random() * (MAX_NODE_JITTER + 1));
        const revealDelay = layerIndex * LAYER_STAGGER + jitter;
        nodeDelays.set(node.id, revealDelay);
      });
    });

    const edgeDelays = new Map(
      graph.edges.map((edge) => [
        edge.id,
        Math.max(
          nodeDelays.get(edge.source) ?? 0,
          nodeDelays.get(edge.target) ?? 0,
        ) + EDGE_DELAY,
      ]),
    );
    const nodeCompleteAt = Math.max(0, ...nodeDelays.values()) + NODE_DURATION;
    const edgeCompleteAt = Math.max(0, ...edgeDelays.values()) + EDGE_DURATION;

    return {
      nodeDelays,
      edgeDelays,
      completeAt: Math.max(nodeCompleteAt, edgeCompleteAt),
    };
  });
  const [nodes, setNodes] = useState<SkillFlowNode[]>(() =>
    graph.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        revealDelayMs: bloomTiming.nodeDelays.get(node.id) ?? 0,
      },
    })),
  );
  const [edges] = useState<SkillFlowEdge[]>(() =>
    graph.edges.map((edge) => ({
      ...edge,
      style: {
        ...edge.style,
        animation: "edge-in 300ms ease-out backwards",
        animationDelay: `${bloomTiming.edgeDelays.get(edge.id) ?? 0}ms`,
      },
    })),
  );
  const [isLegendExpanded, setIsLegendExpanded] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const flowInstance = useRef<
    ReactFlowInstance<SkillFlowNodeData, SkillFlowEdge["data"]> | undefined
  >(undefined);
  const selectedNodeIdRef = useRef<string | null>(null);
  const reshapeTimeouts = useRef<number[]>([]);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
  );
  const prerequisiteLabels = useMemo(
    () =>
      selectedNodeId
        ? graph.edges
            .filter((edge) => edge.target === selectedNodeId)
            .map(
              (edge) =>
                graph.nodes.find((node) => node.id === edge.source)?.data.label,
            )
            .filter((label): label is string => Boolean(label))
        : [],
    [graph.edges, graph.nodes, selectedNodeId],
  );

  const closeNodePanel = useCallback(() => {
    selectedNodeIdRef.current = null;
    setSelectedNodeId(null);
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.selected ? { ...node, selected: false } : node,
      ),
    );
  }, []);

  function handleNodeClick(node: SkillFlowNode) {
    selectedNodeIdRef.current = node.id;
    setSelectedNodeId(node.id);
    setNodes((currentNodes) =>
      currentNodes.map((currentNode) => {
        const isSelected = currentNode.id === node.id;
        return currentNode.selected === isSelected
          ? currentNode
          : { ...currentNode, selected: isSelected };
      }),
    );

    window.requestAnimationFrame(() => {
      const instance = flowInstance.current;
      if (!instance) {
        return;
      }

      instance.setCenter(
        node.position.x + NODE_WIDTH / 2,
        node.position.y + NODE_HEIGHT / 2,
        { zoom: instance.getZoom(), duration: 400 },
      );
    });
  }

  function handleMasteryChange(nodeId: string, mastered: boolean) {
    const targetNode = nodes.find((node) => node.id === nodeId);
    if (!targetNode || targetNode.data.isGoal) {
      return;
    }

    const masteredIds = new Set(
      nodes
        .filter((node) => node.data.state === "mastered")
        .map((node) => node.id),
    );

    if (mastered) {
      masteredIds.add(nodeId);
    } else {
      masteredIds.delete(nodeId);
    }

    const nextStates = new Map(
      recomputeNodeStates(nodes.map((node) => node.data), graph.edges, masteredIds)
        .map((entry) => [entry.id, entry.state]),
    );

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const nextState = nextStates.get(node.id);
        return nextState && nextState !== node.data.state
          ? { ...node, data: { ...node.data, state: nextState } }
          : node;
      }),
    );
    persistMastery(graph.goal, masteredIds);
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const persistedMastery = readPersistedMastery(graph.goal);
      if (persistedMastery.length === 0) {
        return;
      }

      setNodes((currentNodes) => {
        const existingMastery = currentNodes
          .filter((node) => node.data.state === "mastered")
          .map((node) => node.id);
        const nextStates = new Map(
          recomputeNodeStates(
            currentNodes.map((node) => node.data),
            graph.edges,
            new Set([...existingMastery, ...persistedMastery]),
          ).map((entry) => [entry.id, entry.state]),
        );

        return currentNodes.map((node) => {
          const nextState = nextStates.get(node.id);
          return nextState && nextState !== node.data.state
            ? { ...node, data: { ...node.data, state: nextState } }
            : node;
        });
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [graph.edges, graph.goal]);

  async function reshapeMap(knowledge: string) {
    const response = await fetch("/api/reshape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: graph.goal,
        knowledge,
        graph: {
          nodes: nodes.map((node) => ({
            id: node.id,
            label: node.data.label,
            state: node.data.state,
          })),
          edges: graph.edges.map((edge) => ({
            source: edge.source,
            target: edge.target,
            type: edge.data?.type ?? "requires",
          })),
        },
      }),
    });
    const payload: unknown = await response.json();

    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "The map could not be redrawn.";
      throw new Error(message);
    }

    const result = ReshapeResponseSchema.parse(payload);
    const currentStates = new Map(
      nodes.map((node) => [node.id, node.data.state]),
    );
    const changedStates = result.states.filter(
      (entry) => currentStates.get(entry.id) !== entry.state,
    );
    const orderedChanges = [
      ...changedStates.filter((entry) => entry.state === "mastered"),
      ...changedStates.filter((entry) => entry.state === "available"),
      ...changedStates.filter((entry) => entry.state === "locked"),
    ];

    reshapeTimeouts.current.forEach((timeout) => window.clearTimeout(timeout));
    reshapeTimeouts.current = orderedChanges.map((change, index) =>
      window.setTimeout(() => {
        setNodes((currentNodes) =>
          currentNodes.map((node) =>
            node.id === change.id
              ? { ...node, data: { ...node.data, state: change.state } }
              : node,
          ),
        );
      }, index * RESHAPE_STAGGER),
    );

    if (orderedChanges.length >= MANY_STATE_CHANGES) {
      reshapeTimeouts.current.push(
        window.setTimeout(() => {
          flowInstance.current?.fitView({ padding: 0.15, duration: 650 });
        }, orderedChanges.length * RESHAPE_STAGGER + 250),
      );
    }
  }

  useEffect(
    () => () => {
      reshapeTimeouts.current.forEach((timeout) =>
        window.clearTimeout(timeout),
      );
    },
    [],
  );

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const fitViewTimeout = window.setTimeout(
      () => {
        if (!selectedNodeIdRef.current) {
          flowInstance.current?.fitView({
            padding: 0.15,
            duration: prefersReducedMotion ? 0 : 650,
          });
        }
      },
      prefersReducedMotion ? 0 : bloomTiming.completeAt,
    );

    return () => window.clearTimeout(fitViewTimeout);
  }, [bloomTiming.completeAt]);

  return (
    <div className="map-shell">
      <div className="map-canvas">
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
          onNodeClick={(_event, node) => handleNodeClick(node)}
          onPaneClick={closeNodePanel}
        >
          <TerritoryLayer nodes={nodes} />
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
              aria-label={
                isLegendExpanded ? "Collapse legend" : "Expand legend"
              }
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
        <ReshapeBar onSubmit={reshapeMap} />
      </div>

      {selectedNode ? (
        <NodePanel
          key={selectedNode.id}
          goal={graph.goal}
          node={selectedNode.data}
          prerequisites={prerequisiteLabels}
          onClose={closeNodePanel}
          onMasteryChange={handleMasteryChange}
        />
      ) : null}
    </div>
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
