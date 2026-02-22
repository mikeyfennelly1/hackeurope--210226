import { describe, it } from "vitest";
import { loadEthPriceCheckBlueprint } from "../../../src/redprint/loader.js";
import { RedPrint } from "../../../src/redprint/Redprint.js";

describe("loadEthPriceCheckBlueprint", () => {
  it("loads the blueprint and constructs a RedPrint", async () => {
    const blueprint = await loadEthPriceCheckBlueprint();
    const redprint = new RedPrint(blueprint);
    console.log(redprint);
  });
});
