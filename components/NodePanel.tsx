"use client";

import { useEffect, useState } from "react";
import type { SkillFlowNodeData } from "@/lib/layout";
import { NodeContentSchema, type NodeContent } from "@/lib/schema";

type NodePanelProps = {
  goal: string;
  node: SkillFlowNodeData;
  prerequisites: string[];
  onClose: () => void;
  onMasteryChange: (nodeId: string, mastered: boolean) => void;
};

function NodePanelSkeleton() {
  return (
    <div className="node-panel__skeleton" aria-hidden="true">
      <div className="node-panel__skeleton-section">
        <span className="node-panel__skeleton-line node-panel__skeleton-line--short" />
        <span className="node-panel__skeleton-line" />
        <span className="node-panel__skeleton-line" />
        <span className="node-panel__skeleton-line node-panel__skeleton-line--medium" />
      </div>
      <div className="node-panel__skeleton-section">
        <span className="node-panel__skeleton-line node-panel__skeleton-line--short" />
        <span className="node-panel__skeleton-line node-panel__skeleton-line--medium" />
        <span className="node-panel__skeleton-line" />
        <span className="node-panel__skeleton-line" />
        <span className="node-panel__skeleton-line node-panel__skeleton-line--medium" />
      </div>
      <div className="node-panel__skeleton-section">
        <span className="node-panel__skeleton-line node-panel__skeleton-line--short" />
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className="node-panel__skeleton-line" />
        ))}
      </div>
    </div>
  );
}

function getResponseError(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return "Failed to generate learning content.";
}

export function NodePanel({
  goal,
  node,
  prerequisites,
  onClose,
  onMasteryChange,
}: NodePanelProps) {
  const [content, setContent] = useState<NodeContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function loadContent() {
      try {
        const response = await fetch("/api/node-content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal,
            nodeId: node.id,
            label: node.label,
            description: node.description,
            prerequisites,
          }),
        });
        const payload: unknown = await response.json();

        if (!response.ok) {
          throw new Error(getResponseError(payload));
        }

        if (isActive) {
          setContent(NodeContentSchema.parse(payload));
        }
      } catch (requestError) {
        if (!isActive) {
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to generate learning content.",
        );
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadContent();
    return () => {
      isActive = false;
    };
  }, [goal, node.id, node.label, node.description, prerequisites]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <aside
      className="node-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="node-panel-title"
    >
      <header className="node-panel__header">
        <div className="node-panel__heading-copy">
          <p className="node-panel__cluster">{node.cluster}</p>
          <h2 id="node-panel-title" className="node-panel__title">
            {node.label}
          </h2>
          <span className={`node-panel__state node-panel__state--${node.state}`}>
            {node.state}
          </span>
        </div>
        <button
          type="button"
          className="node-panel__close"
          onClick={onClose}
          aria-label="Close skill details"
        >
          ×
        </button>
      </header>

      <div className="node-panel__body" aria-live="polite">
        {isLoading ? <NodePanelSkeleton /> : null}

        {!isLoading && error ? (
          <div className="node-panel__error" role="alert">
            <p>Unable to chart this field note.</p>
            <span>{error}</span>
          </div>
        ) : null}

        {!isLoading && content ? (
          <>
            <section className="node-panel__section">
              <h3>Overview</h3>
              <p>{content.overview}</p>
            </section>

            {node.state === "locked" ? (
              <div className="node-panel__locked-notice">
                <p className="node-panel__locked-heading">
                  This territory is still ahead of you.
                </p>
                <p className="node-panel__locked-copy">
                  Master the trail behind it to unlock the field exercise and
                  interview questions.
                </p>
                <div className="node-panel__locked-teasers">
                  <p>
                    <span aria-hidden="true">🔒︎</span>
                    Field exercise: {content.project.title}
                  </p>
                  <p>
                    <span aria-hidden="true">🔒︎</span>5 interview questions
                  </p>
                </div>
              </div>
            ) : (
              <>
                <section className="node-panel__section">
                  <h3>Field exercise</h3>
                  <h4>{content.project.title}</h4>
                  <p>{content.project.brief}</p>
                </section>

                <section className="node-panel__section">
                  <h3>What you&apos;ll be asked</h3>
                  <ol className="node-panel__questions">
                    {content.interviewQuestions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ol>
                </section>
              </>
            )}

            <p className="node-panel__effort">
              typical effort: {content.estimatedEffort}
            </p>
          </>
        ) : null}
      </div>

      {!node.isGoal && node.state !== "locked" ? (
        <footer className="node-panel__mastery-control">
          {node.state === "available" ? (
            <button
              type="button"
              className="node-panel__mastery-button node-panel__mastery-button--primary"
              onClick={() => onMasteryChange(node.id, true)}
            >
              Mark as mastered
            </button>
          ) : null}

          {node.state === "mastered" ? (
            <button
              type="button"
              className="node-panel__mastery-button node-panel__mastery-button--secondary"
              onClick={() => onMasteryChange(node.id, false)}
            >
              Mark as not mastered
            </button>
          ) : null}
        </footer>
      ) : null}
    </aside>
  );
}
