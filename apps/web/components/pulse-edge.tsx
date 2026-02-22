"use client";

import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { usePulse } from "./pulse-context";

export function PulseEdge({
  id,
  source,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
}: EdgeProps) {
  const { pulsingNodes } = usePulse();
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const pulseEntries = pulsingNodes.get(source) ?? [];

  const dimStyle = {
    ...style,
    stroke: selected ? "rgba(255, 255, 255, 0.6)" : "rgba(255, 255, 255, 0.12)",
    strokeWidth: selected ? 1.5 : 1,
    transition: "stroke 0.1s ease, stroke-width 0.1s ease",
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={dimStyle} markerEnd={markerEnd} />
      {pulseEntries.map((entry) => (
        <g key={entry.key}>
          {/* Aftertrail glow */}
          <rect
            x="-8"
            y="-3"
            width="16"
            height="6"
            rx="3"
            fill="#d4602c"
            opacity="0.3"
            style={{
              offsetPath: `path('${edgePath}')`,
              offsetRotate: "auto",
              animation: "pulse-travel 0.5s ease-in-out forwards",
              filter: "blur(4px)",
            }}
          />
          {/* Main pill */}
          <rect
            x="-5"
            y="-1.5"
            width="10"
            height="3"
            rx="1.5"
            fill="#d4602c"
            style={{
              offsetPath: `path('${edgePath}')`,
              offsetRotate: "auto",
              animation: "pulse-travel 0.5s ease-in-out forwards",
              filter:
                "drop-shadow(-6px 0 3px rgba(212,96,44,0.5)) drop-shadow(-14px 0 6px rgba(212,96,44,0.2))",
            }}
          />
        </g>
      ))}
    </>
  );
}
