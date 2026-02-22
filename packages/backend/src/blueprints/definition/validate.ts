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

function detectCycle(nodes: readonly NodeDefinition[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(node.name, []);
  }
  for (const node of nodes) {
    for (const dep of node.subscribesTo ?? []) {
      adj.get(dep.node)?.push(node.name);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of nodes) {
    color.set(node.name, WHITE);
  }

  function dfs(nodeName: string): boolean {
    color.set(nodeName, GRAY);
    for (const next of adj.get(nodeName) ?? []) {
      if (color.get(next) === GRAY) {
        return true;
      }
      if (color.get(next) === WHITE && dfs(next)) {
        return true;
      }
    }
    color.set(nodeName, BLACK);
    return false;
  }

  for (const node of nodes) {
    if (color.get(node.name) === WHITE && dfs(node.name)) {
      return [...color.entries()]
        .filter(([, colorValue]) => colorValue === GRAY)
        .map(([name]) => name);
    }
  }

  return null;
}

export const BlueprintUtils = {
  validate(blueprint: BlueprintDefinition): ValidationResult {
    const errors: ValidationError[] = [];
    const nodeNames = new Set(blueprint.nodes.map((node) => node.name));

    for (let i = 0; i < blueprint.nodes.length; i++) {
      const node = blueprint.nodes[i]!;
      for (let j = 0; j < (node.subscribesTo?.length ?? 0); j++) {
        const ref = node.subscribesTo![j]!;
        if (!nodeNames.has(ref.node)) {
          errors.push({
            path: `nodes[${i}].subscribesTo[${j}]`,
            message: `References non-existent node "${ref.node}"`,
          });
        }
      }
    }

    const consumedNodes = new Set<string>();
    for (const node of blueprint.nodes) {
      for (const dep of node.subscribesTo ?? []) {
        consumedNodes.add(dep.node);
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

    const cycle = detectCycle(blueprint.nodes);
    if (cycle) {
      errors.push({
        path: "nodes",
        message: `Cycle detected involving nodes: ${cycle.join(", ")}`,
      });
    }

    const decisionNodes = blueprint.nodes.filter(
      (node) => node.role === "decision",
    );
    if (decisionNodes.length === 0) {
      errors.push({
        path: "nodes",
        message: "Blueprint must have exactly one decision node",
      });
    } else if (decisionNodes.length > 1) {
      errors.push({
        path: "nodes",
        message: `Blueprint must have exactly one decision node, found ${decisionNodes.length}: ${decisionNodes.map((node) => node.name).join(", ")}`,
      });
    } else {
      const decision = decisionNodes[0]!;
      const subscribedTo = new Set<string>();
      for (const node of blueprint.nodes) {
        for (const dep of node.subscribesTo ?? []) {
          subscribedTo.add(dep.node);
        }
      }

      if (subscribedTo.has(decision.name)) {
        errors.push({
          path: "nodes",
          message: `Decision node "${decision.name}" must be terminal — no other node should subscribe to it`,
        });
      }

      if (!decision.subscribesTo || decision.subscribesTo.length === 0) {
        errors.push({
          path: "nodes",
          message: `Decision node "${decision.name}" must subscribe to at least one other node`,
        });
      }

    }

    // Validate consumer (output) nodes have actions
    const consumerNodes = blueprint.nodes.filter(
      (node) => node.role === "consumer"
    );
    for (const consumer of consumerNodes) {
      if (!consumer.action) {
        errors.push({
          path: `nodes`,
          message: `Consumer node "${consumer.name}" must have an action`,
        });
      } else {
        if (!consumer.action.verb) {
          errors.push({
            path: `nodes`,
            message: `Consumer node "${consumer.name}" action must have a verb`,
          });
        }
        if (!consumer.action.token_id) {
          errors.push({
            path: `nodes`,
            message: `Consumer node "${consumer.name}" action must have a token_id`,
          });
        }
        if (!consumer.action.amount || consumer.action.amount <= 0) {
          errors.push({
            path: `nodes`,
            message: `Consumer node "${consumer.name}" action must have a positive amount`,
          });
        }
      }
    }

    return errors.length > 0 ? fail(errors) : ok();
  },
};
