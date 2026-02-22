"use client";

import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { usePulse } from "./pulse-context";

export function PulseEdge({
  id,
  source,
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

  const pulseKey = pulsingNodes.get(source);

  const dimStyle = {
    ...style,
    stroke: "rgba(255, 255, 255, 0.12)",
    strokeWidth: 1,
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={dimStyle} markerEnd={markerEnd} />
      {pulseKey !== undefined && (
        <rect
          key={pulseKey}
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
          }}
        />
      )}
    </>
  );
}
