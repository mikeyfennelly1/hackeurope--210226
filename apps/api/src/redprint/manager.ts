import { randomUUID } from "node:crypto";
import { StringCodec, type Subscription } from "nats";
import { toNatsSubject } from "@repo/backend/blueprints/definition";
import type { BlueprintDefinition } from "@repo/backend/blueprints/definition";
import { topologicalSort } from "./graph.js";
import { getConnection } from "./nats.js";
import type { NodeState, Redprint } from "./types.js";
import { BinancePriceMonitor } from "../services/binance-ws.js";
import { getLogger } from "../utils/logger.js";
import { polymarketService } from "../services/polymarket.service.js";
import { OrderSide } from "../types/common.types.js";
import { getMarketParams } from "../utils/polymarket.js";

const logger = getLogger("RedprintManager");
const sc = StringCodec();

const store = new Map<string, Redprint>();

/**
 * Creates a live Redprint from a BlueprintDefinition.
 * Wires NATS subscriptions so events propagate through the graph.
 */
export function dispatch(blueprint: BlueprintDefinition): Redprint {
  const nc = getConnection();
  const id = randomUUID();
  logger.info(`Dispatching new redprint from blueprint "${blueprint.name}" [id=${id}]`);

  // Initialize node states
  const nodes = new Map<string, NodeState>();
  for (const node of blueprint.nodes) {
    nodes.set(node.name, {
      name: node.name,
      label: node.label,
      role: node.role,
      status: "waiting",
      output: null,
      firedAt: null,
      ...(node.inputType ? { inputType: node.inputType } : {}),
    });
  }

  const subscriptions: Subscription[] = [];
  const monitors: BinancePriceMonitor[] = [];

  const redprint: Redprint = {
    id,
    blueprint,
    status: "running",
    nodes,
    decision: null,
    subscriptions,
    monitors,
    createdAt: new Date().toISOString(),
  };

  store.set(id, redprint);

  logger.debug(`Blueprint "${blueprint.name}" has ${blueprint.nodes.length} node(s)`);

  // Resolve execution order
  const order = topologicalSort(blueprint.nodes);
  logger.trace(`Topological order: [${order.join(" → ")}]`);

  // Build a lookup: node name → NodeDefinition
  const nodeDefs = new Map(blueprint.nodes.map((n) => [n.name, n] as const));

  // For each node that consumes (consumer/hybrid/decision), subscribe to upstream subjects.
  // When ALL upstream nodes have fired (Positive), fire this node.
  for (const nodeName of order) {
    const nodeDef = nodeDefs.get(nodeName)!;
    if (!nodeDef.subscribesTo || nodeDef.subscribesTo.length === 0) continue;

    // Subscribe to each upstream subject
    for (const upstreamDep of nodeDef.subscribesTo) {
      const upstream = typeof upstreamDep === 'string' ? upstreamDep : upstreamDep.node;
      // Subject is scoped to this redprint instance: <redprint_id>.<node_name>
      const subject = toNatsSubject(id, upstream);
      logger.debug(`[${id.slice(0, 8)}] Subscribing "${nodeName}" to NATS subject "${subject}"`);
      const sub = nc.subscribe(subject);
      subscriptions.push(sub);

      // Process messages async
      (async () => {
        for await (const msg of sub) {
          logger.debug(`[${id.slice(0, 8)}] ${nodeName} received message on ${subject}`);
          const payload = sc.decode(msg.data);
          const output = JSON.parse(payload) as { output: boolean };

          // Update upstream node state
          const upstreamState = redprint.nodes.get(upstream);
          if (upstreamState && upstreamState.status === "waiting") {
            upstreamState.status = "fired";
            upstreamState.output = output.output;
            upstreamState.firedAt = new Date().toISOString();
            logger.trace(
              `[${id.slice(0, 8)}] Upstream node "${upstream}" state updated to fired (output=${output.output})`,
            );
          }

          // Check if ALL upstream deps of this node have fired
          const allFired = nodeDef.subscribesTo!.every((dep) => {
            const depNode = typeof dep === 'string' ? dep : dep.node;
            const depState = redprint.nodes.get(depNode);
            return depState?.status === "fired";
          });

          if (!allFired) {
            logger.debug(
              `[${id.slice(0, 8)}] Node "${nodeName}" waiting — not all dependencies fired yet`,
            );
            continue;
          }

          // Fire this node
          const nodeState = redprint.nodes.get(nodeName);
          if (!nodeState || nodeState.status === "fired") continue;

          nodeState.status = "fired";
          nodeState.output = true;
          nodeState.firedAt = new Date().toISOString();
          logger.info(`[${id.slice(0, 8)}] Node "${nodeName}" fired`);

          if (nodeDef.role === "decision") {
            // Terminal: record the decision and complete
            redprint.decision = nodeDef.action?.verb ?? null;
            redprint.status = "completed";
            // Clean up all crypto monitors on natural completion
            for (const monitor of redprint.monitors) {
              monitor.close();
            }
            logger.info(
              `[${id.slice(0, 8)}] Completed — decision: ${redprint.decision}`,
            );
          } else if (nodeDef.role === "consumer" && nodeDef.action) {
            // Consumer (output) node: place order if all upstreams are true
            const allUpstreamsTrue = nodeDef.subscribesTo?.every((dep) => {
              const depNode = typeof dep === 'string' ? dep : dep.node;
              return redprint.nodes.get(depNode)?.output === true;
            });

            if (allUpstreamsTrue) {
              const { verb, token_id, amount } = nodeDef.action;

              logger.info(
                `[${id.slice(0, 8)}] Placing ${verb} order for ${amount} on token ${token_id}`,
              );

              // Fetch market params and place order
              getMarketParams(token_id)
                .then((params) => {
                  if (!params) {
                    logger.error(`[${id.slice(0, 8)}] Failed to fetch market params for ${token_id}`);
                    return;
                  }

                  return polymarketService.placeOrder({
                    tokenId: token_id,
                    side: verb === "buy" ? OrderSide.BUY : OrderSide.SELL,
                    amount,
                  });
                })
                .then((result) => {
                  if (result) {
                    logger.info(`[${id.slice(0, 8)}] Order placed - orderId: ${result.orderId}`);
                  }
                })
                .catch((error) => {
                  logger.error(`[${id.slice(0, 8)}] Order failed - ${error.message}`);
                });
            } else {
              logger.info(
                `[${id.slice(0, 8)}] Output node ${nodeName} skipped - upstream condition was false`,
              );
            }
          } else {
            // Publish Positive to this node's subject so downstream can fire
            const nodeSubject = toNatsSubject(id, nodeName);
            logger.debug(
              `[${id.slice(0, 8)}] Publishing Positive from "${nodeName}" to subject "${nodeSubject}"`,
            );
            nc.publish(nodeSubject, sc.encode(JSON.stringify({ output: true })));
          }
        }
      })();
    }
  }

  // Auto-wire crypto monitor producer nodes
  for (const nodeDef of blueprint.nodes) {
    if (
      nodeDef.role === "producer" &&
      nodeDef.inputType === "crypto_monitor" &&
      nodeDef.cryptoMonitorConfig
    ) {
      const config = nodeDef.cryptoMonitorConfig;
      const monitor = new BinancePriceMonitor({
        symbol: config.symbol,
        operator: config.condition,
        targetPrice: config.targetPrice,
      });

      monitor.on("price", ({ price }: { price: number }) => {
        const nodeState = redprint.nodes.get(nodeDef.name);
        if (nodeState) {
          nodeState.lastPrice = price;
          logger.trace(
            `[${id.slice(0, 8)}] CryptoMonitor "${nodeDef.name}": ${config.symbol} @ $${price}`,
          );
        }
      });

      monitor.on(
        "condition_met",
        ({ price }: { symbol: string; price: number }) => {
          logger.info(
            `[${id.slice(0, 8)}] CryptoMonitor "${nodeDef.name}": ${config.symbol} condition met at $${price} — firing node`,
          );
          const nodeState = redprint.nodes.get(nodeDef.name);
          if (nodeState && nodeState.status === "waiting") {
            nodeState.status = "fired";
            nodeState.output = true;
            nodeState.firedAt = new Date().toISOString();

            const subject = toNatsSubject(id, nodeDef.name);
            nc.publish(subject, sc.encode(JSON.stringify({ output: true })));
          }
        },
      );

      monitor.start();
      monitors.push(monitor);
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

  logger.info(`[${redprintId.slice(0, 8)}] Pushing event to node "${nodeName}" (output=${output})`);

  // Mark the node as fired
  nodeState.status = "fired";
  nodeState.output = output;
  nodeState.firedAt = new Date().toISOString();

  // Publish Positive to this node's NATS subject so downstream consumers fire
  const subject = toNatsSubject(redprintId, nodeName);
  logger.debug(`[${redprintId.slice(0, 8)}] Publishing to NATS subject "${subject}"`);
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
  if (!redprint) {
    logger.warn(`Teardown requested for unknown redprint [id=${id}]`);
    return false;
  }

  logger.info(`Tearing down redprint [id=${id.slice(0, 8)}]`);

  // Unsubscribe all NATS subscriptions
  for (const sub of redprint.subscriptions) {
    sub.unsubscribe();
  }
  logger.debug(`[${id.slice(0, 8)}] Unsubscribed ${redprint.subscriptions.length} NATS subscription(s)`);

  // Close all crypto price monitors
  for (const monitor of redprint.monitors) {
    monitor.close();
  }
  logger.debug(`[${id.slice(0, 8)}] Closed ${redprint.monitors.length} crypto monitor(s)`);

  redprint.status = "completed";
  return store.delete(id);
}
