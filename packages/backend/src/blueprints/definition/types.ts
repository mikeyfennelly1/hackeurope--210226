export type NodeRole = "producer" | "consumer" | "hybrid" | "decision";

export type Decision = "buy" | "sell";

export interface NodeAction {
  readonly verb: Decision;
  readonly market_id: string;
}

export interface NodeDefinition {
  readonly name: string;
  readonly role: NodeRole;
  readonly subscribesTo?: readonly string[];
  /** Required for decision nodes. Declares the market action to execute. */
  readonly action?: NodeAction;
}

export interface BlueprintDefinition {
  readonly name: string;
  readonly nodes: readonly NodeDefinition[];
}

export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}
