"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import type { SkillFlowNodeData } from "@/lib/layout";

export function SkillNode({ data }: NodeProps<SkillFlowNodeData>) {
  const stateClassName = data.isGoal
    ? "skill-node--goal"
    : `skill-node--${data.state}`;
  const isPreReveal = data.isPreReveal === true;

  return (
    <div
      className={`skill-node-reveal${isPreReveal ? " skill-node-reveal--pre" : ""}`}
      style={{ transitionDuration: `${data.revealDurationMs ?? 350}ms` }}
    >
      <div className={`skill-node ${stateClassName}`}>
        <Handle
          type="target"
          position={Position.Top}
          className="skill-node__handle"
        />
        <div className="skill-node__label">
          <span
            className="skill-node__cluster-dot"
            style={{ backgroundColor: data.clusterTint }}
            aria-hidden="true"
          />
          {data.state === "mastered" ? (
            <span className="skill-node__check" aria-hidden="true">
              ✓
            </span>
          ) : null}
          <span>{data.label}</span>
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="skill-node__handle"
        />
      </div>
    </div>
  );
}
