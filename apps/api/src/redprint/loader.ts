import { readFile } from "node:fs/promises";
import type { BlueprintDefinition } from "@repo/backend/blueprints/definition";

const BLUEPRINT_PATH = new URL(
  "../../blueprints/eth_price_check.json",
  import.meta.url,
);

export async function loadEthPriceCheckBlueprint(): Promise<BlueprintDefinition> {
  const raw = await readFile(BLUEPRINT_PATH, "utf-8");
  return JSON.parse(raw) as BlueprintDefinition;
}
