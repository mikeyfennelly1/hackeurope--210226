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
  webhookNode: { width: 220, height: 120 },
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

  const positionMap = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const pos = g.node(node.id);
    const dims = NODE_DIMENSIONS[node.type ?? ""] ?? DEFAULT_DIMENSIONS;
    positionMap.set(node.id, {
      x: snap(pos.x - dims.width / 2),
      y: snap(pos.y - dims.height / 2),
    });
  }

  // Fix decision-node branch ordering: dagre doesn't know about source
  // handles, so targets may be placed in the wrong vertical order.  For each
  // decision node, sort its branch-connected targets so the top-most handle
  // maps to the top-most target.
  for (const node of nodes) {
    if (node.type !== "decisionNode") continue;
    const data = node.data as { outputs?: string[] };
    const branches = data?.outputs;
    if (!branches || branches.length < 2) continue;

    // Collect target node ids in branch (handle) order
    const branchTargets: { handle: string; targetId: string }[] = [];
    for (const handle of branches) {
      const edge = edges.find(
        (e) => e.source === node.id && e.sourceHandle === handle,
      );
      if (edge) branchTargets.push({ handle, targetId: edge.target });
    }
    if (branchTargets.length < 2) continue;

    // Get current Y positions assigned by dagre
    const currentYs = branchTargets
      .map((bt) => positionMap.get(bt.targetId)?.y ?? 0)
      .sort((a, b) => a - b);

    // Assign sorted Y positions in branch order (first branch → smallest Y)
    for (let i = 0; i < branchTargets.length; i++) {
      const pos = positionMap.get(branchTargets[i]!.targetId);
      if (pos) pos.y = currentYs[i]!;
    }
  }

  return nodes.map((node) => {
    const pos = positionMap.get(node.id)!;
    return { ...node, position: { x: pos.x, y: pos.y } };
  });
}
