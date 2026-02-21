import { randomUUID } from "node:crypto";
import { StringCodec, type Subscription } from "nats";
import { toNatsSubject } from "@repo/backend/blueprints/definition";
import type { BlueprintDefinition } from "@repo/backend/blueprints/definition";
import { topologicalSort } from "./graph.js";
import { getConnection } from "./nats.js";
import type { NodeState, Redprint } from "./types.js";

const sc = StringCodec();

const store = new Map<string, Redprint>();

/**
 * Creates a live Redprint from a BlueprintDefinition.
 * Wires NATS subscriptions so events propagate through the graph.
 */
export function dispatch(blueprint: BlueprintDefinition): Redprint {
  const nc = getConnection();
  const id = randomUUID();

  // Initialize node states
  const nodes = new Map<string, NodeState>();
  for (const node of blueprint.nodes) {
    nodes.set(node.name, {
      name: node.name,
      role: node.role,
      status: "waiting",
      output: null,
      firedAt: null,
    });
  }

  const subscriptions: Subscription[] = [];

  const redprint: Redprint = {
    id,
    blueprint,
    status: "running",
    nodes,
    decision: null,
    subscriptions,
    createdAt: new Date().toISOString(),
  };

  store.set(id, redprint);

  // Resolve execution order
  const order = topologicalSort(blueprint.nodes);

  // Build a lookup: node name → NodeDefinition
  const nodeDefs = new Map(blueprint.nodes.map((n) => [n.name, n] as const));

  // For each node that consumes (consumer/hybrid/decision), subscribe to upstream subjects.
  // When ALL upstream nodes have fired (Positive), fire this node.
  for (const nodeName of order) {
    const nodeDef = nodeDefs.get(nodeName)!;
    if (!nodeDef.subscribesTo || nodeDef.subscribesTo.length === 0) continue;

    // Subscribe to each upstream subject
    for (const upstream of nodeDef.subscribesTo) {
      // Subject is scoped to this redprint instance: <redprint_id>.<node_name>
      const subject = toNatsSubject(id, upstream);
      const sub = nc.subscribe(subject);
      subscriptions.push(sub);

      // Process messages async
      (async () => {
        for await (const msg of sub) {
          const payload = sc.decode(msg.data);
          const output = JSON.parse(payload) as { output: boolean };

          // Update upstream node state
          const upstreamState = redprint.nodes.get(upstream);
          if (upstreamState && upstreamState.status === "waiting") {
            upstreamState.status = "fired";
            upstreamState.output = output.output;
            upstreamState.firedAt = new Date().toISOString();
          }

          // Check if ALL upstream deps of this node have fired
          const allFired = nodeDef.subscribesTo!.every((dep) => {
            const depState = redprint.nodes.get(dep);
            return depState?.status === "fired";
          });

          if (!allFired) continue;

          // Fire this node
          const nodeState = redprint.nodes.get(nodeName);
          if (!nodeState || nodeState.status === "fired") continue;

          nodeState.status = "fired";
          nodeState.output = true;
          nodeState.firedAt = new Date().toISOString();

          if (nodeDef.role === "decision") {
            // Terminal: record the decision and complete
            redprint.decision = nodeDef.action?.verb ?? null;
            redprint.status = "completed";
            console.log(
              `Redprint ${id} completed: ${redprint.decision} on ${nodeDef.action?.market_id}`,
            );
          } else {
            // Publish Positive to this node's subject so downstream can fire
            const nodeSubject = toNatsSubject(id, nodeName);
            nc.publish(nodeSubject, sc.encode(JSON.stringify({ output: true })));
          }
        }
      })();
    }
  }

  return redprint;
}

/**
 * Push an event (Positive) to a specific node in a running redprint.
 * This is the HTTP entry point for triggering producer/switch nodes.
 */
export function pushEvent(
  redprintId: string,
  nodeName: string,
  output: boolean,
): void {
  const redprint = store.get(redprintId);
  if (!redprint) throw new Error(`Redprint "${redprintId}" not found`);
  if (redprint.status !== "running")
    throw new Error(`Redprint "${redprintId}" is not running`);

  const nodeState = redprint.nodes.get(nodeName);
  if (!nodeState) throw new Error(`Node "${nodeName}" not found in redprint`);

  const nc = getConnection();

  // Mark the node as fired
  nodeState.status = "fired";
  nodeState.output = output;
  nodeState.firedAt = new Date().toISOString();

  // Publish Positive to this node's NATS subject so downstream consumers fire
  const subject = toNatsSubject(redprintId, nodeName);
  nc.publish(subject, sc.encode(JSON.stringify({ output })));
}

export function get(id: string): Redprint | undefined {
  return store.get(id);
}

export function list(): Redprint[] {
  return [...store.values()];
}

export function teardown(id: string): boolean {
  const redprint = store.get(id);
  if (!redprint) return false;

  // Unsubscribe all NATS subscriptions
  for (const sub of redprint.subscriptions) {
    sub.unsubscribe();
  }

  redprint.status = "completed";
  return store.delete(id);
}
