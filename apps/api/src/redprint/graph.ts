import type { NodeDefinition } from "@repo/backend/blueprints/definition";

/**
 * Topological sort using Kahn's algorithm.
 * Returns node names in valid execution order (sources first, decision last).
 */
export function topologicalSort(
  nodes: readonly NodeDefinition[],
): string[] {
  // Build adjacency and in-degree count
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    adj.set(node.name, []);
    inDegree.set(node.name, 0);
  }

  for (const node of nodes) {
    for (const dep of node.subscribesTo ?? []) {
      adj.get(dep)!.push(node.name);
      inDegree.set(node.name, (inDegree.get(node.name) ?? 0) + 1);
    }
  }

  // Start with nodes that have no incoming edges
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adj.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return sorted;
}
