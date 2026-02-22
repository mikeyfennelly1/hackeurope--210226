import type { BlueprintDefinition } from "./types.js";

export function toNatsSubject(blueprintName: string, nodeName: string): string {
  return `${blueprintName}.${nodeName}`;
}

export function toNatsSubjectWithHandle(
  blueprintId: string,
  nodeName: string,
  handle: string,
): string {
  return `${blueprintId}.${nodeName}.${handle}`;
}

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
