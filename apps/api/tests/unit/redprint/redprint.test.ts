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
      subscribesTo: ["eth_exceeds_price_x"],
      action: {
        verb: "buy",
        market_id: "ETH-USD",
      },
    },
  ],
};

describe("RedPrint", () => {
  it("constructs a RedPrint from a BlueprintDefinition", () => {
    const redprint = new RedPrint(blueprint);
    console.log(redprint);
  });
});
