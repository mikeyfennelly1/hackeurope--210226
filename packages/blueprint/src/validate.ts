import type {
  BlueprintDefinition,
  NodeDefinition,
  ValidationError,
  ValidationResult,
} from "./types.js";

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(errors: ValidationError[]): ValidationResult {
  return { valid: false, errors };
}

/**
 * Detects cycles in the node graph using DFS three-color algorithm.
 * Returns the names of nodes involved in a cycle, or null if acyclic.
 */
function detectCycle(nodes: readonly NodeDefinition[]): string[] | null {
  // Build adjacency: for each subscribesTo edge, the producer "feeds" the consumer.
  // Edge direction: producer → consumer (producer's output flows to consumer).
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(node.name, []);
  }
  for (const node of nodes) {
    for (const dep of node.subscribesTo ?? []) {
      adj.get(dep)!.push(node.name);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of nodes) color.set(node.name, WHITE);

  function dfs(u: string): boolean {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === GRAY) return true;
      if (color.get(v) === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  }

  for (const node of nodes) {
    if (color.get(node.name) === WHITE && dfs(node.name)) {
      return [...color.entries()]
        .filter(([, c]) => c === GRAY)
        .map(([name]) => name);
    }
  }

  return null;
}

export const BlueprintUtils = {
  /**
   * Validates a BlueprintDefinition against all schema rules:
   * 1. Every subscribesTo reference points to an existing node
   * 2. Every producer/hybrid node has at least 1 consumer
   * 3. No cyclic dependencies
   * 4. Exactly one decision node, and it is terminal (nothing subscribes to it)
   * 5. Decision nodes subscribe to at least one other node
   */
  validate(blueprint: BlueprintDefinition): ValidationResult {
    const errors: ValidationError[] = [];
    const nodeNames = new Set(blueprint.nodes.map((n) => n.name));

    // 1. Validate subscribesTo references
    for (let i = 0; i < blueprint.nodes.length; i++) {
      const node = blueprint.nodes[i]!;
      for (let j = 0; j < (node.subscribesTo?.length ?? 0); j++) {
        const ref = node.subscribesTo![j]!;
        if (!nodeNames.has(ref)) {
          errors.push({
            path: `nodes[${i}].subscribesTo[${j}]`,
            message: `References non-existent node "${ref}"`,
          });
        }
      }
    }

    // 2. Every producer/hybrid must have at least 1 consumer
    const consumedNodes = new Set<string>();
    for (const node of blueprint.nodes) {
      for (const dep of node.subscribesTo ?? []) {
        consumedNodes.add(dep);
      }
    }
    for (let i = 0; i < blueprint.nodes.length; i++) {
      const node = blueprint.nodes[i]!;
      if (
        (node.role === "producer" || node.role === "hybrid") &&
        !consumedNodes.has(node.name)
      ) {
        errors.push({
          path: `nodes[${i}]`,
          message: `Producer/hybrid node "${node.name}" has no consumers`,
        });
      }
    }

    // 3. Cycle detection
    const cycle = detectCycle(blueprint.nodes);
    if (cycle) {
      errors.push({
        path: "nodes",
        message: `Cycle detected involving nodes: ${cycle.join(", ")}`,
      });
    }

    // 4. Exactly one decision node, and it must be terminal
    const decisionNodes = blueprint.nodes.filter(
      (n) => n.role === "decision",
    );
    if (decisionNodes.length === 0) {
      errors.push({
        path: "nodes",
        message: "Blueprint must have exactly one decision node",
      });
    } else if (decisionNodes.length > 1) {
      errors.push({
        path: "nodes",
        message: `Blueprint must have exactly one decision node, found ${decisionNodes.length}: ${decisionNodes.map((n) => n.name).join(", ")}`,
      });
    } else {
      const decision = decisionNodes[0]!;
      // Check it is terminal: no other node subscribes to it
      const subscribedTo = new Set<string>();
      for (const node of blueprint.nodes) {
        for (const dep of node.subscribesTo ?? []) {
          subscribedTo.add(dep);
        }
      }
      if (subscribedTo.has(decision.name)) {
        errors.push({
          path: `nodes`,
          message: `Decision node "${decision.name}" must be terminal — no other node should subscribe to it`,
        });
      }

      // 5. Decision node must subscribe to at least one node
      if (!decision.subscribesTo || decision.subscribesTo.length === 0) {
        errors.push({
          path: `nodes`,
          message: `Decision node "${decision.name}" must subscribe to at least one other node`,
        });
      }
    }

    return errors.length > 0 ? fail(errors) : ok();
  },
};
