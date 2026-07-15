"use client";

import { useState, type FormEvent } from "react";
import ReactFlow, { Background, Controls } from "reactflow";
import { layoutSkillGraph, type SkillFlowGraph } from "@/lib/layout";
import { SkillGraphSchema } from "@/lib/schema";

export default function Home() {
  const [goal, setGoal] = useState("");
  const [flowGraph, setFlowGraph] = useState<SkillFlowGraph | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedGoal = goal.trim();
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

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-zinc-50 text-zinc-950">
      {flowGraph ? (
        <ReactFlow
          nodes={flowGraph.nodes}
          edges={flowGraph.edges}
          fitView
          panOnDrag
          zoomOnScroll
          className="h-full w-full"
        >
          <Background />
          <Controls />
        </ReactFlow>
      ) : (
        <div className="flex h-full items-center justify-center px-6">
          <form
            onSubmit={handleSubmit}
            className="flex w-full max-w-2xl flex-col gap-4"
          >
            <label
              htmlFor="goal"
              className="text-center text-sm font-medium text-zinc-600"
            >
              What do you want to learn?
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="goal"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="What do you want to learn?"
                className="h-12 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-4 text-base outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-200"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !goal.trim()}
                className="h-12 rounded-md bg-zinc-950 px-5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                {isLoading ? "Generating..." : "Forge"}
              </button>
            </div>
            {error ? (
              <p className="whitespace-pre-wrap text-center text-sm text-red-600">
                {error}
              </p>
            ) : null}
          </form>
        </div>
      )}
    </main>
  );
}
