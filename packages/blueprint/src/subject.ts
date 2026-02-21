import type { BlueprintDefinition } from "./types.js";

/**
 * Derives the NATS subject for a node within a blueprint.
 * Convention: `<blueprint_name>.<node_name>`
 */
export function toNatsSubject(
  blueprintName: string,
  nodeName: string,
): string {
  return `${blueprintName}.${nodeName}`;
}

/**
 * Returns a map of node name → NATS subject for every node
 * that can publish (producer or hybrid).
 */
export function resolveSubjects(
  blueprint: BlueprintDefinition,
): ReadonlyMap<string, string> {
  const subjects = new Map<string, string>();
  for (const node of blueprint.nodes) {
    if (node.role === "producer" || node.role === "hybrid") {
      subjects.set(node.name, toNatsSubject(blueprint.name, node.name));
    }
  }
  return subjects;
}
