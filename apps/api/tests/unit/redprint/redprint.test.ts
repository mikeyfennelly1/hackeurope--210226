import { describe, it } from "vitest";
import { RedPrint } from "../../../src/redprint/Redprint.js";
import type { BlueprintDefinition } from "@repo/backend/blueprints/definition";

const blueprint: BlueprintDefinition = {
  name: "eth_price_check",
  nodes: [
    {
      name: "eth_exceeds_price_x",
      role: "producer",
    },
    {
      name: "decision",
      role: "decision",
      subscribesTo: [{ node: "eth_exceeds_price_x", requiredValue: true }],
      action: {
        verb: "buy",
        market_id: "ETH-USD",
      },
    },
  ],
};

const betweenPricesBlueprint: BlueprintDefinition = {
  name: "eth_below_price_check",
  nodes: [
    {
      name: "eth_exceeds_price_x",
      role: "producer",
    },
    {
      name: "eth_below_price_y",
      role: "producer",
    },
    {
      name: "decision",
      role: "decision",
      subscribesTo: [
        { node: "eth_exceeds_price_x", requiredValue: true },
        { node: "eth_below_price_y", requiredValue: true },
      ],
      action: {
        verb: "sell",
        market_id: "ETH-USD",
      },
    },
  ],
};

describe("RedPrint", () => {
  it("constructs a RedPrint from a BlueprintDefinition", () => {
    const redprint = new RedPrint(blueprint);
    console.log(redprint);
    redprint.writeToKey("eth_exceeds_price_x", true)
    console.log(redprint);
  });

  it("triggers a sell decision when ETH is below price y", () => {
    const redprint = new RedPrint(betweenPricesBlueprint);
    redprint.writeToKey("eth_below_price_y", true);
    redprint.writeToKey("eth_exceeds_price_x", true);
    console.log(redprint);
  });
});
