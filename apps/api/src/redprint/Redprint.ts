import { randomUUID } from "node:crypto";
import type { Subscription } from "nats";
import type { BlueprintDefinition, Decision } from "@repo/backend/blueprints/definition";
import type { NodeState, RedprintStatus } from "./types.js";
import { DecisionBuffer } from "./DecisionBuffer.js";
import { Decider } from "./Decider.js";

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

  constructor(blueprint: BlueprintDefinition) {
    this.id = randomUUID();
    this.blueprint = blueprint;
    this.createdAt = new Date().toISOString();
    this.status = "running";
    this.decision = null;
    this.subscriptions = [];

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

    const producerNodes = blueprint.nodes.filter((n) => n.role === "producer");
    this.decisionBuffer = new DecisionBuffer(producerNodes.map((n) => n.name));

    const requiredState = new Map(producerNodes.map((n) => [n.name, true] as const));
    const decisionNode = blueprint.nodes.find((n) => n.role === "decision");
    if (!decisionNode?.action) {
      throw new Error(`Blueprint "${blueprint.name}" has no decision node with an action`);
    }
    this.decider = new Decider(requiredState, decisionNode.action);
  }

  writeToKey(keyName: string, value: boolean): void {
    this.decisionBuffer.write(keyName, value);

    if (this.decisionBuffer.isDecideable()) {
      this.decideAndTakeAction();
    }
  }

  private decideAndTakeAction(): void {
    const resultSet = this.decisionBuffer.toRecord();
    const shouldAct = this.decider.executeRuleChain(resultSet);

    if (shouldAct) {
      this.decider.executeAction();
      this.status = "completed";
    }
  }
}
