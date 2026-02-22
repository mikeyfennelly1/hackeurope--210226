import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Blueprint } from "@repo/backend/blueprints";
import { fromVisualBlueprints } from "../../../src/redprint/fromVisual.js";

const OUTPUT_JSON_PATH = new URL("../../../output.json", import.meta.url);

describe("fromVisualBlueprints", () => {
  it("converts output.json blueprints into BlueprintDefinitions and prints them", async () => {
    const raw = await readFile(OUTPUT_JSON_PATH, "utf-8");
    const visualBlueprints: Blueprint[] = JSON.parse(raw);

    const definitions = fromVisualBlueprints(visualBlueprints);

    expect(definitions).toHaveLength(visualBlueprints.length);

    for (const def of definitions) {
      console.log(`\n--- POST /api/redprints body for "${def.name}" ---`);
      console.log(JSON.stringify(def, null, 2));
    }
  });
});
