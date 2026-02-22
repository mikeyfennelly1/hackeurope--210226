import type { Blueprint } from "@repo/backend/blueprints";
import type { BlueprintDefinition } from "@repo/backend/blueprints/definition";
import { toDefinition } from "@repo/backend/blueprints";

/**
 * Converts an array of visual Blueprints (edge-based React Flow format, as
 * produced by the frontend and stored in output.json) into BlueprintDefinitions
 * (the subscription-list model used by the runtime).
 *
 * Only node relationships are established here — each node is classified as
 * producer / consumer / hybrid / decision based on its visual type and
 * edge connectivity. No NATS subjects, monitors, or actions are set up.
 */
export function fromVisualBlueprints(blueprints: Blueprint[]): BlueprintDefinition[] {
  return blueprints.map(toDefinition);
}
