import type { NodeAction } from "@repo/backend/blueprints/definition";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("Decider");

export class Decider {
  private readonly requiredState: Map<string, boolean>;
  private readonly action: NodeAction;

  constructor(requiredState: Map<string, boolean>, action: NodeAction) {
    this.requiredState = requiredState;
    this.action = action;
    logger.debug(
      `Initialized with ${requiredState.size} rule(s) for action "${action.verb}" on token ${action.token_id}`,
    );
  }

  executeRuleChain(actualState: Record<string, boolean>): boolean {
    logger.trace(`Evaluating rule chain against state: ${JSON.stringify(actualState)}`);
    for (const [key, requiredValue] of this.requiredState) {
      if (!(key in actualState)) {
        logger.debug(`Rule chain failed: key "${key}" missing from actual state`);
        return false;
      }
      if (actualState[key] !== requiredValue) {
        logger.debug(
          `Rule chain failed: key "${key}" expected ${requiredValue} but got ${actualState[key]}`,
        );
        return false;
      }
    }
    logger.debug("Rule chain passed — all conditions met");
    return true;
  }

  executeAction(): void {
    logger.debug(`Action payload: ${JSON.stringify(this.action)}`);
    logger.info(`Executing action: ${this.action.verb} on token ${this.action.token_id}`);
  }
}
