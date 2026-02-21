import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

/** Grid size matching the React Flow Background gap. */
export const GRID_SIZE = 22;

/** Snap a value to the nearest grid line. */
function snap(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/**
 * Estimated node dimensions for dagre layout.
 * Decision nodes are taller because they render branch rows.
 */
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  inputNode: { width: 220, height: 120 },
  outputNode: { width: 220, height: 120 },
  decisionNode: { width: 240, height: 200 },
};

const DEFAULT_DIMENSIONS = { width: 220, height: 120 };

/**
 * Compute a left-to-right dagre layout for the given nodes and edges.
 * Returns a new array of nodes with updated positions (does not mutate input).
 */
export function computeLayout<N extends Node>(
  nodes: N[],
  edges: Edge[],
): N[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: "LR",
    nodesep: 60,
    ranksep: 200,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    const dims =
      NODE_DIMENSIONS[node.type ?? ""] ?? DEFAULT_DIMENSIONS;
    g.setNode(node.id, { width: dims.width, height: dims.height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const dims =
      NODE_DIMENSIONS[node.type ?? ""] ?? DEFAULT_DIMENSIONS;

    // Dagre returns center coordinates; React Flow uses top-left.
    // Snap to grid so nodes align with the background.
    return {
      ...node,
      position: {
        x: snap(pos.x - dims.width / 2),
        y: snap(pos.y - dims.height / 2),
      },
    };
  });
}
