import type { Blueprint } from "./index";
import type {
  BlueprintDefinition,
  NodeDefinition,
  NodeRole,
} from "./definition/types";

/**
 * Converts a visual Blueprint (edge-based React Flow model)
 * into a BlueprintDefinition (subscription-list model for the runtime).
 */
export function toDefinition(blueprint: Blueprint): BlueprintDefinition {
  // Build sets of nodes that have outgoing edges
  const hasOutgoing = new Set<string>();
  // Build map: target node id → list of source node ids
  const incomingEdges = new Map<string, string[]>();

  for (const edge of blueprint.edges) {
    hasOutgoing.add(edge.source);
    const incoming = incomingEdges.get(edge.target);
    if (incoming) {
      incoming.push(edge.source);
    } else {
      incomingEdges.set(edge.target, [edge.source]);
    }
  }

  const nodes: NodeDefinition[] = blueprint.nodes.map((node) => {
    // Map visual type → runtime role
    let role: NodeRole;
    if (node.type === "input") {
      role = "producer";
    } else if (node.type === "decision") {
      role = "decision";
    } else if (node.type === "comparison") {
      role = "hybrid";
    } else if (node.type === "logic_gate") {
      role = "hybrid";
    } else if (node.type === "rate_limiter") {
      role = "hybrid";
    } else if (node.type === "market") {
      role = "producer";
    } else if (node.type === "webhook") {
      if (node.webhookConfig?.mode === "outgoing") {
        role = hasOutgoing.has(node.id) ? "hybrid" : "consumer";
      } else {
        role = "producer";
      }
    } else {
      // "output" nodes: hybrid if they have outgoing edges, consumer otherwise
      role = hasOutgoing.has(node.id) ? "hybrid" : "consumer";
    }

    // subscribesTo = IDs of nodes with edges pointing into this node
    let subscribesTo = incomingEdges.get(node.id);

    // For comparison nodes, ensure input-a comes before input-b in subscribesTo
    if (node.type === "comparison" && subscribesTo && subscribesTo.length === 2) {
      const edgesForNode = blueprint.edges.filter((e) => e.target === node.id);
      const sorted = [...edgesForNode].sort((a, b) => {
        if (a.targetHandle === "input-a") return -1;
        if (b.targetHandle === "input-a") return 1;
        return 0;
      });
      subscribesTo = sorted.map((e) => e.source);
    }

    // For logic gate nodes, sort by handle index (input-0, input-1, ...)
    if (node.type === "logic_gate" && subscribesTo && subscribesTo.length > 1) {
      const edgesForNode = blueprint.edges.filter((e) => e.target === node.id);
      const sorted = [...edgesForNode].sort((a, b) => {
        const idxA = parseInt(a.targetHandle?.replace("input-", "") ?? "0", 10);
        const idxB = parseInt(b.targetHandle?.replace("input-", "") ?? "0", 10);
        return idxA - idxB;
      });
      subscribesTo = sorted.map((e) => e.source);
    }

    const def: NodeDefinition = {
      name: node.id,
      label: node.label,
      role,
      ...(subscribesTo && subscribesTo.length > 0
        ? { subscribesTo }
        : {}),
      ...(node.action ? { action: node.action } : {}),
      ...(node.inputType ? { inputType: node.inputType } : {}),
      ...(node.cryptoMonitorConfig
        ? { cryptoMonitorConfig: node.cryptoMonitorConfig }
        : {}),
      ...(node.comparisonConfig
        ? { comparisonConfig: node.comparisonConfig }
        : {}),
      ...(node.type === "market" && node.marketSlug
        ? { marketConfig: { slug: node.marketSlug, outcome: node.marketOutcome ?? "yes" } }
        : {}),
      ...(node.logicGateConfig
        ? { logicGateConfig: node.logicGateConfig }
        : {}),
      ...(node.rateLimiterConfig
        ? { rateLimiterConfig: node.rateLimiterConfig }
        : {}),
      ...(node.type === "webhook" && node.webhookConfig
        ? { webhookConfig: node.webhookConfig }
        : {}),
    };

    return def;
  });

  return {
    name: blueprint.name,
    nodes,
  };
}
