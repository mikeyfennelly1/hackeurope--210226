export type NodeRole = "producer" | "consumer" | "hybrid" | "decision";

export type ComparisonOperator = ">" | "<" | ">=" | "<=" | "==" | "!=";

export type Decision = "buy" | "sell";

export interface NodeAction {
  readonly verb: Decision;
  readonly market_id: string;
}

export interface NodeSubscription {
  readonly node: string;
  readonly requiredValue: boolean;
}

export interface NodeDefinition {
  readonly name: string;
  readonly label?: string;
  readonly role: NodeRole;
  readonly subscribesTo?: readonly NodeSubscription[];
  /** Required for decision nodes. Declares the market action to execute. */
  readonly action?: NodeAction;
  readonly inputType?: "manual_trigger" | "crypto_monitor" | "crypto_price";
  readonly cryptoMonitorConfig?: {
    readonly symbol: string;
    readonly condition: "drops_below" | "rises_above";
    readonly targetPrice: number;
  };
  readonly comparisonConfig?: {
    readonly operator: ComparisonOperator;
    readonly thresholdA?: number;
    readonly thresholdB?: number;
  };
  readonly marketConfig?: {
    readonly slug: string;
    readonly outcome: "yes" | "no";
  };
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
