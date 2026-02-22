export type InputNodeType = "manual_trigger" | "crypto_price";

export type CryptoConditionOperator = "drops_below" | "rises_above";

export type CryptoMonitorConfig = {
  symbol: string;
  condition: CryptoConditionOperator;
  targetPrice: number;
};

export type NodeRole = "producer" | "consumer" | "hybrid" | "decision";

export type ComparisonOperator = ">" | "<" | ">=" | "<=" | "==" | "!=";

export type WebhookMode = "incoming" | "outgoing";

export type WebhookConfig = {
  mode: WebhookMode;
  path?: string;
  url?: string;
};

export type Decision = "buy" | "sell";

export interface NodeAction {
  readonly verb: Decision;
  readonly token_id: string;
  readonly amount: number;
}

export interface SubscriptionRef {
  readonly node: string;
  readonly requiredValue?: boolean;
}

export interface NodeDefinition {
  readonly name: string;
  readonly label?: string;
  readonly role: NodeRole;
  readonly subscribesTo?: readonly (string | SubscriptionRef)[];
  /** Required for consumer (output) nodes. Declares the market action to execute. */
  readonly action?: NodeAction;
  readonly inputType?: InputNodeType;
  readonly cryptoMonitorConfig?: CryptoMonitorConfig;
  readonly comparisonConfig?: {
    readonly operator: ComparisonOperator;
    readonly thresholdA?: number;
    readonly thresholdB?: number;
  };
  readonly logicGateConfig?: {
    readonly gateType: "and" | "or";
  };
  readonly rateLimiterConfig?: {
    readonly maxEvents: number;
    readonly windowMs: number;
  };
  readonly marketConfig?: {
    readonly slug: string;
    readonly outcome: "yes" | "no";
  };
  readonly webhookConfig?: WebhookConfig;
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
