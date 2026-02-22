import type { NatsConnection } from "nats";
import type { NodeInstance } from "../NodeInstance.js";
import type { Redprint } from "../types.js";

/**
 * Describes a value that holds enough configuration to produce a
 * {@link NodeInstance} when given the runtime dependencies of a running
 * redprint.
 */
export interface NodeInstantiable {
  init(): void;
  toNodeInstance(redprint: Redprint, nc: NatsConnection): NodeInstance;
}
