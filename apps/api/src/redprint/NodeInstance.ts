import { StringCodec, type NatsConnection, type Subscription } from "nats";
import type { NodeDefinition } from "@repo/backend/blueprints/definition";
import { toNatsSubject } from "@repo/backend/blueprints/definition";
import type { Redprint } from "./types.js";
import { getLogger } from "../utils/logger.js";
import { polymarketService } from "../services/polymarket.service.js";
import { OrderSide } from "../types/common.types.js";
import { getMarketParams } from "../utils/polymarket.js";

const logger = getLogger("NodeInstance");
const sc = StringCodec();

/** Resolves a `subscribesTo` entry to its upstream node name. */
function resolveUpstream(dep: unknown): string {
  return typeof dep === "string" ? dep : (dep as { node: string }).node;
}

/**
 * Encapsulates the per-node NATS subscription logic for a single node within
 * a running {@link Redprint}.
 *
 * Each instance subscribes to its upstream dependencies and reacts when all
 * of them have fired, delegating to the appropriate handler based on the
 * node's role (`"decision"`, `"consumer"`, or intermediate).
 */
export class NodeInstance {
  private readonly id: string;
  private readonly nodeName: string;

  /**
   * @param nodeDef - The blueprint definition of the node this instance represents.
   * @param redprint - The live redprint whose node states are mutated as events fire.
   * @param nc - The active NATS connection used to subscribe and publish.
   */
  constructor(
    private readonly nodeDef: NodeDefinition,
    private readonly redprint: Redprint,
    private readonly nc: NatsConnection,
  ) {
    this.id = redprint.id;
    this.nodeName = nodeDef.name;
  }

  /**
   * Subscribes to each upstream subject declared in `nodeDef.subscribesTo` and
   * starts a {@link listen} coroutine for each one.
   *
   * No-ops if the node has no upstream dependencies.
   */
  initializeSubscriptions(): void {
    if (!this.nodeDef.subscribesTo || this.nodeDef.subscribesTo.length === 0) {
      logger.trace(
        `[${this.id.slice(0, 8)}] Skipping "${this.nodeName}" — no upstream subscriptions (role=${this.nodeDef.role})`,
      );
      return;
    }

    logger.trace(
      `[${this.id.slice(0, 8)}] Wiring "${this.nodeName}" (role=${this.nodeDef.role}) — subscribes to: [${this.nodeDef.subscribesTo.map(resolveUpstream).join(", ")}]`,
    );

    for (const upstreamDep of this.nodeDef.subscribesTo) {
      const upstream = resolveUpstream(upstreamDep);
      const subject = toNatsSubject(this.id, upstream);
      logger.debug(`[${this.id.slice(0, 8)}] Subscribing "${this.nodeName}" to NATS subject "${subject}"`);
      const sub = this.nc.subscribe(subject);
      this.redprint.subscriptions.push(sub);
      void this.listen(sub, upstream);
    }
  }

  /**
   * Consumes messages from a single upstream NATS subscription.
   *
   * On each message, it updates the upstream node's state then checks whether
   * all of this node's dependencies have fired. Once they have, it fires this
   * node and — depending on its role — either:
   * - **`"decision"`** — records the decision and marks the redprint complete.
   * - **`"consumer"`** — places a Polymarket order if all upstream outputs are `true`.
   * - **all others** — publishes a Positive event downstream so dependents can fire.
   *
   * @param sub - The NATS subscription to consume messages from.
   * @param upstream - The name of the upstream node this subscription belongs to.
   */
  private async listen(sub: Subscription, upstream: string): Promise<void> {
    for await (const msg of sub) {
      logger.debug(`[${this.id.slice(0, 8)}] "${this.nodeName}" received message on "${toNatsSubject(this.id, upstream)}"`);
      const payload = sc.decode(msg.data);
      const output = JSON.parse(payload) as { output: boolean };
      logger.trace(`[${this.id.slice(0, 8)}] Decoded payload from "${upstream}": output=${output.output}`);

      // Update upstream node state
      const upstreamState = this.redprint.nodes.get(upstream);
      if (upstreamState && upstreamState.status === "waiting") {
        upstreamState.status = "fired";
        upstreamState.output = output.output;
        upstreamState.firedAt = new Date().toISOString();
        logger.trace(
          `[${this.id.slice(0, 8)}] Upstream node "${upstream}" state updated to fired (output=${output.output})`,
        );
      } else {
        logger.trace(
          `[${this.id.slice(0, 8)}] Upstream node "${upstream}" state not updated — status=${upstreamState?.status ?? "not found"}`,
        );
      }

      // Check if ALL upstream deps of this node have fired
      const depStatuses = this.nodeDef.subscribesTo!.map((dep) => {
        const depNode = resolveUpstream(dep);
        const depState = this.redprint.nodes.get(depNode);
        return { node: depNode, status: depState?.status ?? "not found" };
      });
      logger.trace(
        `[${this.id.slice(0, 8)}] Dependency status for "${this.nodeName}": ${depStatuses.map((d) => `${d.node}=${d.status}`).join(", ")}`,
      );

      const allFired = depStatuses.every((d) => d.status === "fired");

      if (!allFired) {
        logger.debug(`[${this.id.slice(0, 8)}] Node "${this.nodeName}" waiting — not all dependencies fired yet`);
        continue;
      }

      // Fire this node
      const nodeState = this.redprint.nodes.get(this.nodeName);
      if (!nodeState || nodeState.status === "fired") {
        logger.trace(`[${this.id.slice(0, 8)}] Node "${this.nodeName}" already fired — skipping`);
        continue;
      }

      nodeState.status = "fired";
      nodeState.output = true;
      nodeState.firedAt = new Date().toISOString();
      logger.info(`[${this.id.slice(0, 8)}] Node "${this.nodeName}" fired`);

      if (this.nodeDef.role === "decision") {
        this.redprint.decision = this.nodeDef.action?.verb ?? null;
        this.redprint.status = "completed";
        logger.trace(`[${this.id.slice(0, 8)}] Decision node "${this.nodeName}" closing ${this.redprint.monitors.length} monitor(s)`);
        for (const monitor of this.redprint.monitors) {
          monitor.close();
        }
        logger.info(`[${this.id.slice(0, 8)}] Completed — decision: ${this.redprint.decision}`);
      } else if (this.nodeDef.role === "consumer" && this.nodeDef.action) {
        const allUpstreamsTrue = this.nodeDef.subscribesTo?.every((dep) => {
          return this.redprint.nodes.get(resolveUpstream(dep))?.output === true;
        });
        logger.trace(`[${this.id.slice(0, 8)}] Consumer "${this.nodeName}" — allUpstreamsTrue=${allUpstreamsTrue}`);

        if (allUpstreamsTrue) {
          const { verb, token_id, amount } = this.nodeDef.action;
          logger.info(`[${this.id.slice(0, 8)}] Placing ${verb} order for ${amount} on token ${token_id}`);
          getMarketParams(token_id)
            .then((params) => {
              if (!params) {
                logger.error(`[${this.id.slice(0, 8)}] Failed to fetch market params for ${token_id}`);
                return;
              }
              logger.debug(`[${this.id.slice(0, 8)}] Market params fetched for token ${token_id} — submitting order`);
              return polymarketService.placeOrder({
                tokenId: token_id,
                side: verb === "buy" ? OrderSide.BUY : OrderSide.SELL,
                amount,
              });
            })
            .then((result) => {
              if (result) {
                logger.info(`[${this.id.slice(0, 8)}] Order placed - orderId: ${result.orderId}`);
              }
            })
            .catch((error) => {
              logger.error(`[${this.id.slice(0, 8)}] Order failed - ${error.message}`);
            });
        } else {
          logger.info(`[${this.id.slice(0, 8)}] Output node ${this.nodeName} skipped - upstream condition was false`);
        }
      } else {
        const nodeSubject = toNatsSubject(this.id, this.nodeName);
        logger.debug(`[${this.id.slice(0, 8)}] Publishing Positive from "${this.nodeName}" to subject "${nodeSubject}"`);
        this.nc.publish(nodeSubject, sc.encode(JSON.stringify({ output: true })));
      }
    }
  }
}
