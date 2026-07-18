"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import type { SkillFlowNodeData } from "@/lib/layout";

export function SkillNode({ data, selected }: NodeProps<SkillFlowNodeData>) {
  const stateClassName = data.isGoal
    ? "skill-node--goal"
    : `skill-node--${data.state}`;

  return (
    <div
      className="skill-node-reveal"
      style={{
        animation:
          "node-in 350ms cubic-bezier(0.22,1,0.36,1) backwards",
        animationDelay: `${data.revealDelayMs ?? 0}ms`,
      }}
    >
      <div
        className={`skill-node ${stateClassName}${selected ? " skill-node--selected" : ""}`}
      >
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
