import type { NatsConnection } from "nats";
import type { NodeDefinition } from "@repo/backend/blueprints/definition";
import { NodeInstance } from "../NodeInstance.js";
import type { Redprint } from "../types.js";
import type { NodeInstantiable } from "./NodeInstantiable.js";

/**
 * A {@link NodeInstantiable} that represents a Polymarket prediction market
 * node, acting as a producer of market data (price, volume, etc.) within a
 * redprint graph.
 */
export class Market implements NodeInstantiable {
  constructor(
    private readonly name: string,
    private readonly marketSlug: string,
    private readonly marketOutcome: "yes" | "no",
    private readonly label?: string,
  ) {}

  init(): void {}

  toNodeInstance(redprint: Redprint, nc: NatsConnection): NodeInstance {
    const nodeDef: NodeDefinition = {
      name: this.name,
      label: this.label,
      role: "producer",
      marketConfig: {
        slug: this.marketSlug,
        outcome: this.marketOutcome,
      },
    };
    return new NodeInstance(nodeDef, redprint, nc);
  }
}
