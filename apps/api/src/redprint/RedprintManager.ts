import { randomUUID } from "node:crypto";
import { StringCodec, type Subscription } from "nats";
import { toNatsSubject } from "@repo/backend/blueprints/definition";
import type { BlueprintDefinition, NodeDefinition } from "@repo/backend/blueprints/definition";
import { topologicalSort } from "./graph.js";
import { getConnection } from "./nats.js";
import type { NodeState, Redprint } from "./types.js";
import {
  PolymarketPriceProducer,
  PolymarketVolumeProducer,
  PolymarketLiquidityProducer,
  PolymarketSpreadProducer,
  PolymarketLastTradeProducer,
  type PolymarketProducer,
} from "../services/polymarket-ws.js";
import { PolymarketCryptoMonitor } from "../services/polymarket-crypto-ws.js";
import { getLogger } from "../utils/logger.js";
import { NodeInstance } from "./NodeInstance.js";

const logger = getLogger("RedprintManager");
const sc = StringCodec();

/**
 * Manages the lifecycle of live {@link Redprint} instances created from
 * {@link BlueprintDefinition}s.
 *
 * Each dispatched redprint is stored in memory and wired with NATS subscriptions
 * that propagate events through the execution graph until a terminal decision or
 * consumer node fires.
 *
 * @example
 * ```ts
 * const rp = redprintManager.dispatch(myBlueprint);
 * redprintManager.pushEvent(rp.id, "priceAbove50k", true);
 * const result = redprintManager.get(rp.id);
 * ```
 */
export class RedprintManager {
  private readonly store = new Map<string, Redprint>();

  /**
   * Creates a live {@link Redprint} from a {@link BlueprintDefinition} and
   * immediately begins listening for events.
   *
   * All nodes are initialised in `"waiting"` state. NATS subscriptions are
   * registered for every consumer/hybrid/decision node so that upstream events
   * propagate through the graph automatically. Market producer nodes are
   * auto-started via Polymarket WebSocket producers.
   *
   * @param blueprint - The blueprint definition to instantiate.
   * @returns The newly created and running {@link Redprint}.
   */
  dispatch(blueprint: BlueprintDefinition): Redprint {
    const id = randomUUID();
    logger.info(`>>> DISPATCH CALLED - blueprint="${blueprint.name}" nodes=${blueprint.nodes.length}`);
    logger.trace(`dispatch() — blueprint="${blueprint.name}" nodes=${blueprint.nodes.length}`);
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
      logger.trace(`[${id.slice(0, 8)}] Initialized node state: "${node.name}" role=${node.role}${node.inputType ? ` inputType=${node.inputType}` : ""}`);
    }

    const subscriptions: Subscription[] = [];
    const monitors: (PolymarketProducer | PolymarketCryptoMonitor)[] = [];

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

    this.store.set(id, redprint);
    logger.debug(`Blueprint "${blueprint.name}" has ${blueprint.nodes.length} node(s)`);
    logger.trace(`[${id.slice(0, 8)}] Redprint stored — store size now ${this.store.size}`);

    // Resolve execution order
    const order = topologicalSort(blueprint.nodes);
    logger.trace(`Topological order: [${order.join(" → ")}]`);

    // Build a lookup: node name → NodeDefinition
    const nodeDefs = new Map(blueprint.nodes.map((n) => [n.name, n] as const));

    logger.trace(`[${id.slice(0, 8)}] Calling configureGraphSubscriptions`);
    this.configureGraphSubscriptions(order, nodeDefs, redprint);
    logger.trace(`[${id.slice(0, 8)}] configureGraphSubscriptions complete — ${subscriptions.length} subscription(s) registered`);

    // Auto-wire market node producers
    const marketProducers = blueprint.nodes.filter(
      (n) => n.role === "producer" && n.inputType === "market" && n.marketConfig,
    );
    logger.debug(`[${id.slice(0, 8)}] Wiring ${marketProducers.length} market producer(s)`);

    for (const nodeDef of marketProducers) {
      const config = nodeDef.marketConfig!;
      const outputs = nodeDef.outputs ?? ["price", "volume", "liquidity", "spread", "lastTrade"];

      for (const outputId of outputs) {
        let producer: PolymarketProducer;
        const producerConfig = { tokenId: config.tokenId ?? "", marketSlug: config.slug };

        switch (outputId) {
          case "price": {
            producer = new PolymarketPriceProducer(producerConfig);
            producer.on("price", ({ price }: { price: number }) => {
              const nodeState = redprint.nodes.get(nodeDef.name);
              if (nodeState) {
                nodeState.lastValue = price;
              }
              const subject = toNatsSubject(id, `${nodeDef.name}.price`);
              logger.debug(`[${id.slice(0, 8)}] Publishing price=${price} to "${subject}"`);
              getConnection().publish(subject, sc.encode(JSON.stringify({ output: true, value: price })));
            });
            break;
          }
          case "volume": {
            producer = new PolymarketVolumeProducer(producerConfig);
            producer.on("volume", ({ volume }: { volume: number }) => {
              const subject = toNatsSubject(id, `${nodeDef.name}.volume`);
              logger.debug(`[${id.slice(0, 8)}] Publishing volume=${volume} to "${subject}"`);
              getConnection().publish(subject, sc.encode(JSON.stringify({ output: true, value: volume })));
            });
            break;
          }
          case "liquidity": {
            producer = new PolymarketLiquidityProducer(producerConfig);
            producer.on("liquidity", ({ liquidity }: { liquidity: number }) => {
              const subject = toNatsSubject(id, `${nodeDef.name}.liquidity`);
              logger.debug(`[${id.slice(0, 8)}] Publishing liquidity=${liquidity} to "${subject}"`);
              getConnection().publish(subject, sc.encode(JSON.stringify({ output: true, value: liquidity })));
            });
            break;
          }
          case "spread": {
            producer = new PolymarketSpreadProducer(producerConfig);
            producer.on("spread", ({ spread }: { spread: number }) => {
              const subject = toNatsSubject(id, `${nodeDef.name}.spread`);
              logger.debug(`[${id.slice(0, 8)}] Publishing spread=${spread} to "${subject}"`);
              getConnection().publish(subject, sc.encode(JSON.stringify({ output: true, value: spread })));
            });
            break;
          }
          case "lastTrade": {
            producer = new PolymarketLastTradeProducer(producerConfig);
            producer.on("lastTrade", ({ price }: { price: number }) => {
              const subject = toNatsSubject(id, `${nodeDef.name}.lastTrade`);
              logger.debug(`[${id.slice(0, 8)}] Publishing lastTrade=${price} to "${subject}"`);
              getConnection().publish(subject, sc.encode(JSON.stringify({ output: true, value: price })));
            });
            break;
          }
          default:
            continue;
        }

        producer.start();
        monitors.push(producer);
        logger.trace(`[${id.slice(0, 8)}] Market producer "${nodeDef.name}.${outputId}" started`);
      }
    }

    // Auto-wire crypto monitor producer nodes
    // Debug: log all nodes to see what's in the blueprint
    for (const n of blueprint.nodes) {
      if (n.inputType === "crypto_price") {
        logger.info(`[${id.slice(0, 8)}] Found crypto node "${n.name}": role=${n.role} inputType=${n.inputType} cryptoMonitorConfig=${JSON.stringify(n.cryptoMonitorConfig)}`);
      }
    }
    const cryptoProducers = blueprint.nodes.filter(
      (n) => n.role === "producer" && n.inputType === "crypto_price" && n.cryptoMonitorConfig,
    );
    logger.debug(`[${id.slice(0, 8)}] Wiring ${cryptoProducers.length} crypto producer(s)`);

    for (const nodeDef of cryptoProducers) {
      const config = nodeDef.cryptoMonitorConfig!;
      logger.trace(
        `[${id.slice(0, 8)}] Starting CryptoMonitor for "${nodeDef.name}": symbol=${config.symbol} condition=${config.condition} targetPrice=${config.targetPrice}`,
      );

      const monitor = new PolymarketCryptoMonitor({
        symbol: config.symbol,
        operator: config.condition,
        targetPrice: config.targetPrice,
      });

      monitor.on("price", ({ price }: { price: number }) => {
        const nodeState = redprint.nodes.get(nodeDef.name);
        if (nodeState) {
          nodeState.lastPrice = price;
        }
        // Publish price to NATS on every tick
        const subject = toNatsSubject(id, `${nodeDef.name}.price`);
        logger.debug(`[${id.slice(0, 8)}] Publishing crypto price=${price} to "${subject}"`);
        getConnection().publish(subject, sc.encode(JSON.stringify({ output: true, value: price })));
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
            logger.debug(`[${id.slice(0, 8)}] Publishing condition_met event to subject "${subject}"`);
            getConnection().publish(subject, sc.encode(JSON.stringify({ output: true })));
          }
        },
      );

      monitor.start();
      monitors.push(monitor);
      logger.trace(`[${id.slice(0, 8)}] CryptoMonitor "${nodeDef.name}" started`);
    }

    logger.trace(`[${id.slice(0, 8)}] dispatch() complete — returning redprint`);
    return redprint;
  }

  /**
   * Registers NATS subscriptions for every node that declares upstream
   * dependencies (`subscribesTo`). When all dependencies have fired, the node
   * is triggered and — depending on its role — either propagates the event
   * downstream, places a Polymarket order (consumer), or finalises the
   * redprint with a decision.
   *
   * @param topologicalNodeOrder - Topologically-sorted list of node names, guaranteeing
   *   producers are processed before their dependents.
   * @param nodeDefs - Lookup map from node name to its full `NodeDefinition`.
   * @param redprint - The live redprint whose node states are mutated as
   *   events fire.
   */
  private configureGraphSubscriptions(
    topologicalNodeOrder: string[],
    nodeDefs: Map<string, NodeDefinition>,
    redprint: Redprint,
  ): void {
    const { id } = redprint;
    const nc = getConnection();
    logger.trace(`[${id.slice(0, 8)}] configureGraphSubscriptions() — processing ${topologicalNodeOrder.length} node(s) in order`);

    for (const nodeName of topologicalNodeOrder) {
      const nodeDef = nodeDefs.get(nodeName)!;
      new NodeInstance(nodeDef, redprint, nc).initializeSubscriptions();
    }

    logger.trace(`[${id.slice(0, 8)}] configureGraphSubscriptions() done`);
  }

  /**
   * Externally triggers a node in a running redprint by publishing an event
   * to its NATS subject.
   *
   * This is the HTTP entry-point for manually firing producer or switch nodes
   * (e.g. from a REST API call). Downstream subscribers will react as if the
   * node had fired naturally.
   *
   * @param redprintId - ID of the target redprint.
   * @param nodeName - Name of the node to fire.
   * @param output - The boolean output value to attach to the node's state and
   *   forward to downstream subscribers.
   * @throws {Error} If the redprint does not exist, is not in `"running"` state,
   *   or the named node cannot be found.
   */
  pushEvent(redprintId: string, nodeName: string, output: boolean): void {
    logger.trace(`pushEvent() — redprintId=${redprintId.slice(0, 8)} node="${nodeName}" output=${output}`);

    const redprint = this.store.get(redprintId);
    if (!redprint) throw new Error(`Redprint "${redprintId}" not found`);
    if (redprint.status !== "running")
      throw new Error(`Redprint "${redprintId}" is not running`);

    const nodeState = redprint.nodes.get(nodeName);
    if (!nodeState) throw new Error(`Node "${nodeName}" not found in redprint`);

    logger.trace(`[${redprintId.slice(0, 8)}] Node "${nodeName}" current state: status=${nodeState.status} output=${nodeState.output}`);
    const nc = getConnection();

    logger.info(`[${redprintId.slice(0, 8)}] Pushing event to node "${nodeName}" (output=${output})`);

    // Mark the node as fired
    nodeState.status = "fired";
    nodeState.output = output;
    nodeState.firedAt = new Date().toISOString();
    logger.debug(`[${redprintId.slice(0, 8)}] Node "${nodeName}" marked as fired`);

    // Publish Positive to this node's NATS subject so downstream consumers fire
    const subject = toNatsSubject(redprintId, nodeName);
    logger.debug(`[${redprintId.slice(0, 8)}] Publishing to NATS subject "${subject}"`);
    nc.publish(subject, sc.encode(JSON.stringify({ output })));
    logger.trace(`[${redprintId.slice(0, 8)}] pushEvent() complete`);
  }

  /**
   * Retrieves a stored {@link Redprint} by ID.
   *
   * @param id - The redprint ID.
   * @returns The {@link Redprint} if found, `undefined` otherwise.
   */
  get(id: string): Redprint | undefined {
    logger.trace(`get() — id=${id.slice(0, 8)}`);
    const redprint = this.store.get(id);
    logger.trace(`get() — ${redprint ? `found blueprint="${redprint.blueprint.name}" status=${redprint.status}` : "not found"}`);
    return redprint;
  }

  /**
   * Returns all redprints currently held in the store, regardless of status.
   *
   * @returns An array of every {@link Redprint} in memory.
   */
  list(): Redprint[] {
    logger.debug(`list() called — store currently holds ${this.store.size} entry(ies)`);
    const entries = [...this.store.values()];
    for (const r of entries) {
      logger.debug(`  redprint id=${r.id} blueprint="${r.blueprint.name}" status=${r.status} nodes=[${[...r.nodes.keys()].join(", ")}]`);
    }
    return entries;
  }

  /**
   * Gracefully shuts down a redprint: unsubscribes all NATS subscriptions,
   * closes all market producers, marks the redprint as `"completed"`,
   * and removes it from the store.
   *
   * @param id - The ID of the redprint to tear down.
   * @returns `true` if the redprint was found and deleted, `false` if it did
   *   not exist.
   */
  teardown(id: string): boolean {
    logger.trace(`teardown() — id=${id.slice(0, 8)}`);

    const redprint = this.store.get(id);
    if (!redprint) {
      logger.warn(`Teardown requested for unknown redprint [id=${id}]`);
      return false;
    }

    logger.info(`Tearing down redprint [id=${id.slice(0, 8)}]`);
    logger.debug(`[${id.slice(0, 8)}] Teardown — blueprint="${redprint.blueprint.name}" status=${redprint.status} subs=${redprint.subscriptions.length} monitors=${redprint.monitors.length}`);

    // Unsubscribe all NATS subscriptions
    for (const sub of redprint.subscriptions) {
      sub.unsubscribe();
    }
    logger.debug(`[${id.slice(0, 8)}] Unsubscribed ${redprint.subscriptions.length} NATS subscription(s)`);

    // Close all market producers
    for (const monitor of redprint.monitors) {
      monitor.close();
    }
    logger.debug(`[${id.slice(0, 8)}] Closed ${redprint.monitors.length} market producer(s)`);

    redprint.status = "completed";
    const deleted = this.store.delete(id);
    logger.trace(`[${id.slice(0, 8)}] teardown() complete — deleted=${deleted} store size now ${this.store.size}`);
    return deleted;
  }
}

export const redprintManager = new RedprintManager();
