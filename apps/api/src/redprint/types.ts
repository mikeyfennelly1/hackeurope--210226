import type {
  BlueprintDefinition,
  Decision,
  NodeRole,
} from "@repo/backend/blueprints/definition";
import type { Subscription } from "nats";
import type { BinancePriceMonitor } from "../services/binance-ws.js";

export type NodeStatus = "waiting" | "fired";
export type RedprintStatus = "running" | "completed" | "error";

/** Typed NATS message payload between nodes. */
export interface NatsNodePayload {
  output: boolean;
  value?: number;
}

export interface NodeState {
  readonly name: string;
  readonly label: string | undefined;
  readonly role: NodeRole;
  status: NodeStatus;
  output: unknown;
  firedAt: string | null;
  inputType?: string;
  lastPrice?: number;
  lastValue?: number;
}

export interface Redprint {
  readonly id: string;
  readonly blueprint: BlueprintDefinition;
  status: RedprintStatus;
  nodes: Map<string, NodeState>;
  decision: Decision | null;
  subscriptions: Subscription[];
  monitors: BinancePriceMonitor[];
  readonly createdAt: string;
}

/** JSON-safe representation for API responses. */
export interface RedprintJSON {
  id: string;
  blueprintName: string;
  status: RedprintStatus;
  nodes: Record<string, Omit<NodeState, "name">>;
  decision: Decision | null;
  createdAt: string;
}

export function redprintToJSON(rp: Redprint): RedprintJSON {
  const nodes: Record<string, Omit<NodeState, "name">> = {};
  for (const [name, state] of rp.nodes) {
    nodes[name] = {
      label: state.label,
      role: state.role,
      status: state.status,
      output: state.output,
      firedAt: state.firedAt,
      ...(state.inputType ? { inputType: state.inputType } : {}),
      ...(state.lastPrice !== undefined ? { lastPrice: state.lastPrice } : {}),
      ...(state.lastValue !== undefined ? { lastValue: state.lastValue } : {}),
    };
  }
  return {
    id: rp.id,
    blueprintName: rp.blueprint.name,
    status: rp.status,
    nodes,
    decision: rp.decision,
    createdAt: rp.createdAt,
  };
}
