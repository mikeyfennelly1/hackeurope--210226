import type { Decision } from "./definition/types";
export type { Decision } from "./definition/types";
export { toDefinition } from "./convert";

export type BlueprintNodeType = "input" | "output" | "decision" | "market" | "comparison";

export type InputNodeType = "manual_trigger" | "crypto_monitor" | "crypto_price";

export type CryptoConditionOperator = "drops_below" | "rises_above";

export type ComparisonOperator = ">" | "<" | ">=" | "<=" | "==" | "!=";

export type ComparisonConfig = {
  operator: ComparisonOperator;
  thresholdA?: number;
  thresholdB?: number;
};

export type MarketOutcome = "yes" | "no";

export type CryptoMonitorConfig = {
  symbol: string;
  condition: CryptoConditionOperator;
  targetPrice: number;
};

export type BlueprintNode = {
  id: string;
  type: BlueprintNodeType;
  label: string;
  position: {
    x: number;
    y: number;
  };
  inputs: string[];
  outputs: string[];
  action?: { verb: Decision; token_id: string; amount: number };
  inputType?: InputNodeType;
  cryptoMonitorConfig?: CryptoMonitorConfig;
  comparisonConfig?: ComparisonConfig;
  marketSlug?: string;
  marketOutcome?: MarketOutcome;
};

export type BlueprintEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

export type Blueprint = {
  id: string;
  version: 1;
  name: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
};

export type ValidationErrorCode =
  | "Unconsumed topic"
  | "Invalid node reference"
  | "Invalid handle reference"
  | "Cycle detected"
  | "Missing terminal output"
  | "Disconnected output"
  | "Output missing action"
  | "Crypto monitor missing config"
  | "Comparison missing operator"
  | "Comparison wrong input count";

export type ValidationError = {
  code: ValidationErrorCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type ValidationWarning = {
  code: string;
  message: string;
  nodeId?: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
};

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export class BlueprintBuilder {
  private readonly id: string;
  private name: string;
  private readonly nodes: BlueprintNode[] = [];
  private readonly edges: BlueprintEdge[] = [];

  constructor(name: string, id?: string) {
    this.id = id ?? randomId("bp");
    this.name = name;
  }

  setName(name: string): BlueprintBuilder {
    this.name = name;
    return this;
  }

  addNode(node: BlueprintNode): BlueprintBuilder {
    if (this.nodes.some((item) => item.id === node.id)) {
      throw new Error(`Node with id '${node.id}' already exists`);
    }

    this.nodes.push({
      ...node,
      inputs: [...node.inputs],
      outputs: [...node.outputs],
    });
    return this;
  }

  addEdge(edge: BlueprintEdge): BlueprintBuilder {
    if (this.edges.some((item) => item.id === edge.id)) {
      throw new Error(`Edge with id '${edge.id}' already exists`);
    }

    this.edges.push({ ...edge });
    return this;
  }

  build(): Blueprint {
    return {
      id: this.id,
      version: 1,
      name: this.name,
      nodes: this.nodes.map((node) => ({
        ...node,
        inputs: [...node.inputs],
        outputs: [...node.outputs],
      })),
      edges: this.edges.map((edge) => ({ ...edge })),
    };
  }
}

function validateNodeReferences(blueprint: Blueprint): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeMap = new Map(blueprint.nodes.map((node) => [node.id, node]));

  for (const edge of blueprint.edges) {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);

    if (!source || !target) {
      errors.push({
        code: "Invalid node reference",
        message: `Edge '${edge.id}' references nodes that do not exist`,
        edgeId: edge.id,
      });
      continue;
    }

    if (edge.sourceHandle && !source.outputs.includes(edge.sourceHandle)) {
      errors.push({
        code: "Invalid handle reference",
        message: `Edge '${edge.id}' references missing source handle '${edge.sourceHandle}'`,
        edgeId: edge.id,
      });
    }

    if (edge.targetHandle && !target.inputs.includes(edge.targetHandle)) {
      errors.push({
        code: "Invalid handle reference",
        message: `Edge '${edge.id}' references missing target handle '${edge.targetHandle}'`,
        edgeId: edge.id,
      });
    }
  }

  return errors;
}

function validateTopicsHaveConsumers(blueprint: Blueprint): ValidationError[] {
  const errors: ValidationError[] = [];
  const allInputs = new Set<string>();

  for (const node of blueprint.nodes) {
    for (const topic of node.inputs) {
      allInputs.add(topic);
    }
  }

  for (const node of blueprint.nodes) {
    for (const topic of node.outputs) {
      const isTopic = topic.startsWith("topic.");
      if (isTopic && !allInputs.has(topic)) {
        errors.push({
          code: "Unconsumed topic",
          message: `Topic '${topic}' has no consumers`,
          nodeId: node.id,
        });
      }
    }
  }

  return errors;
}

function hasCycle(blueprint: Blueprint): boolean {
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of blueprint.nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of blueprint.edges) {
    if (!adjacency.has(edge.source) || !inDegree.has(edge.target)) {
      continue;
    }

    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  let visitedCount = 0;
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      break;
    }

    visitedCount += 1;
    for (const next of adjacency.get(nodeId) ?? []) {
      const nextDegree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
      }
    }
  }

  return visitedCount !== blueprint.nodes.length;
}

function hasTerminalOutputNode(blueprint: Blueprint): boolean {
  const outDegree = new Map<string, number>();
  for (const node of blueprint.nodes) {
    outDegree.set(node.id, 0);
  }

  for (const edge of blueprint.edges) {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
  }

  return blueprint.nodes.some(
    (node) => node.type === "output" && (outDegree.get(node.id) ?? 0) === 0,
  );
}

function validateOutputsConnected(blueprint: Blueprint): ValidationError[] {
  const errors: ValidationError[] = [];
  const connectedTargets = new Set(blueprint.edges.map((edge) => edge.target));

  for (const node of blueprint.nodes) {
    if (node.type === "output" && !connectedTargets.has(node.id)) {
      errors.push({
        code: "Disconnected output",
        message: `Output node '${node.label}' has no incoming connections`,
        nodeId: node.id,
      });
    }
  }

  return errors;
}

export const BlueprintUtils = {
  validate(blueprint: Blueprint): ValidationResult {
    const errors: ValidationError[] = [];

    errors.push(...validateNodeReferences(blueprint));
    errors.push(...validateTopicsHaveConsumers(blueprint));
    errors.push(...validateOutputsConnected(blueprint));

    if (hasCycle(blueprint)) {
      errors.push({
        code: "Cycle detected",
        message: "Blueprint graph contains a cycle",
      });
    }

    if (!hasTerminalOutputNode(blueprint)) {
      errors.push({
        code: "Missing terminal output",
        message: "Blueprint must include a terminal output node",
      });
    }

    for (const node of blueprint.nodes) {
      if (node.type === "output" && (!node.action?.verb || !node.action?.token_id || !node.action?.amount)) {
        errors.push({
          code: "Output missing action",
          message: `Output node '${node.label}' must have an action with verb, token_id, and amount`,
          nodeId: node.id,
        });
      }
    }

    for (const node of blueprint.nodes) {
      if (
        node.type === "input" &&
        node.inputType === "crypto_monitor" &&
        (!node.cryptoMonitorConfig?.symbol ||
          !node.cryptoMonitorConfig?.condition ||
          !node.cryptoMonitorConfig?.targetPrice ||
          node.cryptoMonitorConfig.targetPrice <= 0)
      ) {
        errors.push({
          code: "Crypto monitor missing config",
          message: `Crypto monitor node '${node.label}' must have a symbol, condition, and positive target price`,
          nodeId: node.id,
        });
      }
    }

    for (const node of blueprint.nodes) {
      if (node.type === "comparison") {
        if (!node.comparisonConfig?.operator) {
          errors.push({
            code: "Comparison missing operator",
            message: `Comparison node '${node.label}' must have an operator configured`,
            nodeId: node.id,
          });
        }
        const incomingCount = blueprint.edges.filter((e) => e.target === node.id).length;
        const hasThresholdA = node.comparisonConfig?.thresholdA !== undefined;
        const hasThresholdB = node.comparisonConfig?.thresholdB !== undefined;
        const totalInputs = incomingCount + (hasThresholdA ? 1 : 0) + (hasThresholdB ? 1 : 0);
        if (totalInputs < 2) {
          errors.push({
            code: "Comparison wrong input count",
            message: `Comparison node '${node.label}' needs 2 inputs — use incoming connections and/or set threshold values (has ${totalInputs})`,
            nodeId: node.id,
          });
        }
        if (incomingCount > 2) {
          errors.push({
            code: "Comparison wrong input count",
            message: `Comparison node '${node.label}' has too many incoming connections (${incomingCount}, max 2)`,
            nodeId: node.id,
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  },
};
