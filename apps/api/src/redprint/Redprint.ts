import { randomUUID } from "node:crypto";
import type { Subscription } from "nats";
import type { BlueprintDefinition, Decision, SubscriptionRef } from "@repo/backend/blueprints/definition";
import type { NodeState, RedprintStatus } from "./types.js";
import { DecisionBuffer } from "./DecisionBuffer.js";
import { Decider } from "./Decider.js";
import { getLogger } from "../utils/logger.js";

export class RedPrint {
  readonly id: string;
  readonly blueprint: BlueprintDefinition;
  readonly createdAt: string;
  status: RedprintStatus;
  nodes: Map<string, NodeState>;
  decision: Decision | null;
  subscriptions: Subscription[];
  private readonly decisionBuffer: DecisionBuffer;
  private readonly decider: Decider;
  private readonly logger;

  constructor(blueprint: BlueprintDefinition) {
    this.id = randomUUID();
    this.blueprint = blueprint;
    this.createdAt = new Date().toISOString();
    this.status = "running";
    this.decision = null;
    this.subscriptions = [];
    this.logger = getLogger(`RedPrint:${this.id.slice(0, 8)}`);

    this.nodes = new Map(
      blueprint.nodes.map((node) => [
        node.name,
        {
          name: node.name,
          label: node.label,
          role: node.role,
          status: "waiting",
          output: null,
          firedAt: null,
        },
      ]),
    );

    const decisionNode = blueprint.nodes.find((n) => n.role === "decision");
    if (!decisionNode?.action) {
      throw new Error(`Blueprint "${blueprint.name}" has no decision node with an action`);
    }

    const producerNodes = blueprint.nodes.filter((n) => n.role === "producer");
    this.decisionBuffer = new DecisionBuffer(producerNodes.map((n) => n.name));

    const requiredState = new Map(
      (decisionNode.subscribesTo ?? []).map((dep) => {
        if (typeof dep === "string") {
          return [dep, true] as const;
        }
        return [dep.node, dep.requiredValue ?? true] as const;
      }),
    );
    this.decider = new Decider(requiredState, decisionNode.action);

    this.logger.info(
      `Instantiated from blueprint "${blueprint.name}" with ${blueprint.nodes.length} node(s)`,
    );
    this.logger.debug(`Producer nodes: [${producerNodes.map((n) => n.name).join(", ")}]`);
  }

  writeToKey(keyName: string, value: boolean): void {
    this.logger.info(`Node "${keyName}" fired with output=${value}`);
    this.logger.trace(`DecisionBuffer state before write: ${JSON.stringify(this.decisionBuffer.toRecord())}`);
    this.decisionBuffer.write(keyName, value);

    if (this.decisionBuffer.isDecideable()) {
      this.logger.info("All producers have fired — evaluating decision");
      this.decideAndTakeAction();
    } else {
      this.logger.debug(`Waiting for remaining producers: [${
        this.decisionBuffer.keys.filter((k) => !(k in this.decisionBuffer.toRecord())).join(", ")
      }]`);
    }
  }

  private decideAndTakeAction(): void {
    const resultSet = this.decisionBuffer.toRecord();
    this.logger.debug(`Evaluating with result set: ${JSON.stringify(resultSet)}`);
    const shouldAct = this.decider.executeRuleChain(resultSet);

    if (shouldAct) {
      this.decider.executeAction();
      this.status = "completed";
      this.logger.info("Status → completed");
    } else {
      this.logger.info("Rule chain returned false — no action taken");
    }
  }
}
