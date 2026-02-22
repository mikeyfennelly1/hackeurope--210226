import type { NodeAction } from "@repo/backend/blueprints/definition";

export class Decider {
  private readonly requiredState: Map<string, boolean>;
  private readonly action: NodeAction;

  constructor(requiredState: Map<string, boolean>, action: NodeAction) {
    this.requiredState = requiredState;
    this.action = action;
  }

  executeRuleChain(actualState: Record<string, boolean>): boolean {
    for (const [key, requiredValue] of this.requiredState) {
      // return false if the key isn't even in the actual state
      if (!(key in actualState)) return false;

      // if the value exist, but isn't the required value, return false
      if (actualState[key] !== requiredValue) return false;
    }
    return true;
  }

  executeAction(): void {
    console.log(
      `Executing action: ${this.action.verb} on market ${this.action.market_id}`,
    );
  }
}
