export type BlueprintNodeType = "input" | "output" | "decision";

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
  | "TOPIC_WITHOUT_CONSUMER"
  | "INVALID_NODE_REFERENCE"
  | "INVALID_HANDLE_REFERENCE"
  | "CYCLE_DETECTED"
  | "MISSING_TERMINAL_DECISION";

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
        code: "INVALID_NODE_REFERENCE",
        message: `Edge '${edge.id}' references nodes that do not exist`,
        edgeId: edge.id,
      });
      continue;
    }

    if (edge.sourceHandle && !source.outputs.includes(edge.sourceHandle)) {
      errors.push({
        code: "INVALID_HANDLE_REFERENCE",
        message: `Edge '${edge.id}' references missing source handle '${edge.sourceHandle}'`,
        edgeId: edge.id,
      });
    }

    if (edge.targetHandle && !target.inputs.includes(edge.targetHandle)) {
      errors.push({
        code: "INVALID_HANDLE_REFERENCE",
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
          code: "TOPIC_WITHOUT_CONSUMER",
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

function hasTerminalDecisionNode(blueprint: Blueprint): boolean {
  const outDegree = new Map<string, number>();
  for (const node of blueprint.nodes) {
    outDegree.set(node.id, 0);
  }

  for (const edge of blueprint.edges) {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
  }

  return blueprint.nodes.some(
    (node) => node.type === "decision" && (outDegree.get(node.id) ?? 0) === 0,
  );
}

export const BlueprintUtils = {
  validate(blueprint: Blueprint): ValidationResult {
    const errors: ValidationError[] = [];

    errors.push(...validateNodeReferences(blueprint));
    errors.push(...validateTopicsHaveConsumers(blueprint));

    if (hasCycle(blueprint)) {
      errors.push({
        code: "CYCLE_DETECTED",
        message: "Blueprint graph contains a cycle",
      });
    }

    if (!hasTerminalDecisionNode(blueprint)) {
      errors.push({
        code: "MISSING_TERMINAL_DECISION",
        message: "Blueprint must include a terminal decision node",
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  },
};
