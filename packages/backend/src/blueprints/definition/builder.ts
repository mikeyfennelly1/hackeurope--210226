import type { BlueprintDefinition, NodeDefinition } from "./types";
import { BlueprintUtils } from "./validate";

export class BlueprintBuilder {
  private readonly name: string;
  private readonly nodes: NodeDefinition[] = [];

  constructor(name: string) {
    this.name = name;
  }

  addNode(node: NodeDefinition): this {
    this.nodes.push(node);
    return this;
  }

  build(): BlueprintDefinition {
    const definition: BlueprintDefinition = {
      name: this.name,
      nodes: [...this.nodes],
    };

    const result = BlueprintUtils.validate(definition);
    if (!result.valid) {
      const messages = result.errors.map(
        (error) => `  ${error.path}: ${error.message}`,
      );
      throw new Error(
        `Invalid blueprint "${this.name}":\n${messages.join("\n")}`,
      );
    }

    return definition;
  }
}
