export type NodeRole = "producer" | "consumer" | "hybrid" | "decision";

export type Decision = "buy" | "sell";

export interface NodeAction {
  readonly verb: Decision;
  readonly market_id: string;
}

export type XMonitorType =
  | "keyword_match"
  | "sentiment_analysis"
  | "account_monitor";

export interface XMonitorConfig {
  readonly monitorType: XMonitorType;
  readonly account?: string;
  readonly keywords?: string[];
  readonly sentimentTarget?: "positive" | "negative";
  readonly topic?: string;
  readonly pollIntervalSeconds?: number;
}

export interface NodeDefinition {
  readonly name: string;
  readonly label?: string;
  readonly role: NodeRole;
  readonly subscribesTo?: readonly string[];
  /** Required for decision nodes. Declares the market action to execute. */
  readonly action?: NodeAction;
  readonly inputType?: "manual_trigger" | "crypto_monitor" | "x_monitor";
  readonly cryptoMonitorConfig?: {
    readonly symbol: string;
    readonly condition: "drops_below" | "rises_above";
    readonly targetPrice: number;
  };
  readonly xMonitorConfig?: XMonitorConfig;
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
