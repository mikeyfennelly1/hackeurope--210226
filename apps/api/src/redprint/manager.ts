import { randomUUID } from "node:crypto";
import { StringCodec, type Subscription } from "nats";
import { toNatsSubject } from "@repo/backend/blueprints/definition";
import type { BlueprintDefinition } from "@repo/backend/blueprints/definition";
import { topologicalSort } from "./graph.js";
import { getConnection } from "./nats.js";
import type { NatsNodePayload, NodeState, Redprint } from "./types.js";
import { BinancePriceMonitor } from "../services/binance-ws.js";
import { getLogger } from "../utils/logger.js";
import { polymarketService } from "../services/polymarket.service.js";
import { OrderSide } from "../types/common.types.js";
import { getMarketParams } from "../utils/polymarket.js";

const logger = getLogger("RedprintManager");
const sc = StringCodec();

const store = new Map<string, Redprint>();

function evaluateComparison(operator: string, a: number, b: number): boolean {
  switch (operator) {
    case ">": return a > b;
    case "<": return a < b;
    case ">=": return a >= b;
    case "<=": return a <= b;
    case "==": return a === b;
    case "!=": return a !== b;
    default: return false;
  }
}

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
    for (const upstream of nodeDef.subscribesTo) {
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
          const output = JSON.parse(payload) as NatsNodePayload;

          // Update upstream node state
          const upstreamState = redprint.nodes.get(upstream);
          if (upstreamState && upstreamState.status === "waiting") {
            upstreamState.status = "fired";
            upstreamState.output = output.output;
            upstreamState.firedAt = new Date().toISOString();
            if (output.value !== undefined) {
              upstreamState.lastValue = output.value;
            }
            logger.trace(
              `[${id.slice(0, 8)}] Upstream node "${upstream}" state updated to fired (output=${output.output}${output.value !== undefined ? `, value=${output.value}` : ""})`,
            );
          }

          // Check if ALL upstream deps of this node have fired
          const allFired = nodeDef.subscribesTo!.every((dep) => {
            const depState = redprint.nodes.get(dep);
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
          } else if (nodeDef.comparisonConfig) {
            // Comparison node: evaluate operator on upstream values and/or thresholds
            const deps = nodeDef.subscribesTo ?? [];
            const config = nodeDef.comparisonConfig;

            let aVal: number;
            let bVal: number;

            if (config.thresholdA !== undefined && config.thresholdB !== undefined) {
              // Both thresholds set (unlikely but valid)
              aVal = config.thresholdA;
              bVal = config.thresholdB;
            } else if (config.thresholdA !== undefined) {
              // A is a threshold, B comes from the single upstream node
              aVal = config.thresholdA;
              const bState = redprint.nodes.get(deps[0] ?? "");
              bVal = bState?.lastValue ?? 0;
            } else if (config.thresholdB !== undefined) {
              // B is a threshold, A comes from the single upstream node
              const aState = redprint.nodes.get(deps[0] ?? "");
              aVal = aState?.lastValue ?? 0;
              bVal = config.thresholdB;
            } else {
              // Both from upstream (original behavior — A first, B second)
              const aState = redprint.nodes.get(deps[0] ?? "");
              const bState = redprint.nodes.get(deps[1] ?? "");
              aVal = aState?.lastValue ?? 0;
              bVal = bState?.lastValue ?? 0;
            }

            const result = evaluateComparison(config.operator, aVal, bVal);
            nodeState.output = result;
            nodeState.lastValue = result ? 1 : 0;
            logger.info(
              `[${id.slice(0, 8)}] Comparison "${nodeName}": ${aVal} ${config.operator} ${bVal} = ${result}`,
            );

            const nodeSubject = toNatsSubject(id, nodeName);
            nc.publish(nodeSubject, sc.encode(JSON.stringify({ output: result })));
          } else if (nodeDef.role === "consumer" && nodeDef.action) {
            // Consumer (output) node: place order if all upstreams are true
            const allUpstreamsTrue = nodeDef.subscribesTo?.every((dep) => {
              return redprint.nodes.get(dep)?.output === true;
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

  // Auto-wire crypto monitor and crypto price producer nodes
  for (const nodeDef of blueprint.nodes) {
    if (
      nodeDef.role === "producer" &&
      (nodeDef.inputType === "crypto_monitor" || nodeDef.inputType === "crypto_price") &&
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
          nodeState.lastValue = price;
          logger.trace(
            `[${id.slice(0, 8)}] CryptoMonitor "${nodeDef.name}": ${config.symbol} @ $${price}`,
          );

          // Stream mode: fire on first price tick when no target price is set
          if (config.targetPrice === 0 && nodeState.status === "waiting") {
            nodeState.status = "fired";
            nodeState.output = true;
            nodeState.firedAt = new Date().toISOString();
            logger.info(
              `[${id.slice(0, 8)}] CryptoMonitor "${nodeDef.name}": stream mode — fired with price $${price}`,
            );
            const subject = toNatsSubject(id, nodeDef.name);
            nc.publish(subject, sc.encode(JSON.stringify({ output: true, value: price })));
          }
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
            nc.publish(subject, sc.encode(JSON.stringify({ output: true, value: price })));
          }
        },
      );

      monitor.start();
      monitors.push(monitor);
    }
  }

  // Auto-wire market producer nodes — fetch price server-side and fire
  for (const nodeDef of blueprint.nodes) {
    if (nodeDef.role === "producer" && nodeDef.marketConfig) {
      const marketConfig = nodeDef.marketConfig;
      (async () => {
        try {
          const res = await fetch(
            `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(marketConfig.slug)}`,
          );
          if (!res.ok) throw new Error(`Gamma API returned ${res.status}`);
          const events = (await res.json()) as Array<{ markets: Array<{ outcomePrices: string | string[] }> }>;
          const event = events[0];
          const market = event?.markets?.[0];
          if (!market) throw new Error("No market found");

          const outcomePrices = typeof market.outcomePrices === "string"
            ? (JSON.parse(market.outcomePrices) as string[])
            : market.outcomePrices;

          const priceIndex = marketConfig.outcome === "no" ? 1 : 0;
          const price = parseFloat(outcomePrices[priceIndex] ?? "0");

          const nodeState = redprint.nodes.get(nodeDef.name);
          if (nodeState && nodeState.status === "waiting") {
            nodeState.status = "fired";
            nodeState.output = true;
            nodeState.lastPrice = price;
            nodeState.lastValue = price;
            nodeState.firedAt = new Date().toISOString();

            const subject = toNatsSubject(id, nodeDef.name);
            nc.publish(subject, sc.encode(JSON.stringify({ output: true, value: price })));
            logger.info(
              `[${id.slice(0, 8)}] Market node "${nodeDef.name}" fired with ${marketConfig.outcome} price: ${price}`,
            );
          }
        } catch (err) {
          logger.error(
            `[${id.slice(0, 8)}] Market node "${nodeDef.name}" fetch failed: ${(err as Error).message}`,
          );
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
