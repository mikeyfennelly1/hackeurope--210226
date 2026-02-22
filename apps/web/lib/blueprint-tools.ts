import { tool } from "ai";
import { z } from "zod/v4";

// ─── Node type schemas ──────────────────────────────────────────
// To add a new node type:
//   1. Add its type to the `type` enum below
//   2. Add any type-specific fields as optional properties
//   3. Handle it in the onToolCall callback in blueprint-chat.tsx
//   4. Describe it in the system prompt in app/api/chat/route.ts

// ─── Flat node schema (Anthropic requires top-level type:"object") ─
const nodeSchema = z.object({
  type: z
    .enum([
      "input",
      "decision",
      "output",
      "comparison",
      "webhook",
      "logic_gate",
      "market",
      "rate_limiter",
      "signal",
    ])
    .describe("Node type"),
  id: z.string().describe("Unique node id, e.g. 'input-1'"),
  label: z.string().describe("Display label for this node"),
  inputs: z
    .array(z.string())
    .optional()
    .describe("Topics this node consumes"),
  outputs: z
    .array(z.string())
    .optional()
    .describe("Topics this node publishes or branch names"),
  // ── input node fields ──
  inputType: z
    .enum(["manual_trigger", "crypto_price"])
    .optional()
    .describe("Subtype for input nodes. Defaults to 'manual_trigger'"),
  cryptoMonitorConfig: z
    .object({
      symbol: z.string().describe("Trading pair, e.g. 'BTCUSDT'"),
      condition: z.enum(["drops_below", "rises_above"]).describe("Ignored for crypto_price — set to any value"),
      targetPrice: z.number().describe("Must be 0 for crypto_price"),
    })
    .optional()
    .describe("Required for crypto_price input nodes"),
  // ── output node fields ──
  action: z
    .object({
      verb: z.enum(["buy", "sell"]).describe("Order side"),
      token_id: z.string().describe("Polymarket token ID"),
      amount: z.number().describe("Order amount"),
    })
    .optional()
    .describe("Required for output nodes — order placement"),
  amountType: z
    .enum(["dollars", "shares"])
    .optional()
    .describe("Whether amount is in dollars or shares. Defaults to 'dollars'"),
  // ── market / output shared fields ──
  marketSlug: z
    .string()
    .optional()
    .describe("Polymarket event slug"),
  marketOutcome: z
    .enum(["yes", "no"])
    .optional()
    .describe("Which outcome to trade/display. Defaults to 'yes'"),
  marketIndex: z
    .number()
    .optional()
    .describe("Sub-market index for multi-question events. Defaults to 0"),
  // ── comparison node fields ──
  comparisonConfig: z
    .object({
      operator: z.enum([">", "<", ">=", "<=", "==", "!="]),
      thresholdA: z.number().optional().describe("Static value for input A"),
      thresholdB: z.number().optional().describe("Static value for input B"),
    })
    .optional()
    .describe("Required for comparison nodes"),
  // ── webhook node fields ──
  webhookConfig: z
    .object({
      mode: z.enum(["incoming", "outgoing"]).describe("'incoming' receives, 'outgoing' sends"),
      path: z.string().optional().describe("Endpoint path for incoming mode"),
      url: z.string().optional().describe("Target URL for outgoing mode"),
    })
    .optional()
    .describe("Required for webhook nodes"),
  // ── logic gate fields ──
  logicGateConfig: z
    .object({
      gateType: z.enum(["and", "or"]).describe("'and' requires all true, 'or' requires any true"),
    })
    .optional()
    .describe("Required for logic_gate nodes"),
  // ── rate limiter fields ──
  rateLimiterConfig: z
    .object({
      maxEvents: z.number().describe("Max events in the window"),
      windowMs: z.number().describe("Window in ms (e.g. 60000 = 1 min)"),
    })
    .optional()
    .describe("Required for rate_limiter nodes"),
  // ── signal node fields ──
  signalConfig: z
    .object({
      marketSlug: z.string().describe("Polymarket event slug to compute signals from"),
      windowSeconds: z.number().describe("Lookback window in seconds (3600=1h, 14400=4h, 86400=1d, 604800=1w)"),
      refreshMs: z.number().describe("Refresh interval in milliseconds (30000=30s, 60000=1m, 300000=5m)"),
    })
    .optional()
    .describe("Required for signal nodes"),
});

const edgeSchema = z.object({
  source: z.string().describe("Source node id"),
  target: z.string().describe("Target node id"),
  sourceHandle: z
    .string()
    .optional()
    .describe(
      "Required for decision nodes (branch name) and market nodes (one of: 'price', 'volume', 'liquidity', 'spread', 'lastTrade')"
    ),
  targetHandle: z
    .string()
    .optional()
    .describe(
      'Required for comparison nodes ("input-a" or "input-b") and logic gate nodes ("input-0", "input-1", etc.)'
    ),
});

// ─── Input schema + exported type ───────────────────────────────
const blueprintInputSchema = z.object({
  name: z.string().describe("Blueprint name"),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

export type BlueprintToolParams = z.infer<typeof blueprintInputSchema>;
export type AddNodeParams = z.infer<typeof nodeSchema>;
export type AddEdgeParams = z.infer<typeof edgeSchema>;

// ─── Update node schema (all fields optional except id) ─────────
const updateNodeSchema = z.object({
  id: z.string().describe("The id of the node to update"),
  label: z.string().optional().describe("New display label"),
  inputs: z.array(z.string()).optional().describe("New input topics"),
  outputs: z.array(z.string()).optional().describe("New output topics or branch names"),
  action: z
    .object({
      verb: z.enum(["buy", "sell"]),
      token_id: z.string(),
      amount: z.number(),
    })
    .optional()
    .describe("Updated action for output nodes"),
  inputType: z
    .enum(["manual_trigger", "crypto_price"])
    .optional()
    .describe("Change the input node subtype"),
  cryptoMonitorConfig: z
    .object({
      symbol: z.string(),
      condition: z.enum(["drops_below", "rises_above"]),
      targetPrice: z.number(),
    })
    .optional()
    .describe("Updated crypto monitor configuration"),
  comparisonConfig: z
    .object({
      operator: z.enum([">", "<", ">=", "<=", "==", "!="]),
      thresholdA: z.number().optional().describe("Static value for input A"),
      thresholdB: z.number().optional().describe("Static value for input B"),
    })
    .optional()
    .describe("Updated comparison config (operator and/or thresholds)"),
  webhookConfig: z
    .object({
      mode: z.enum(["incoming", "outgoing"]),
      path: z.string().optional().describe("Endpoint path for incoming mode"),
      url: z.string().optional().describe("Target URL for outgoing mode"),
    })
    .optional()
    .describe("Updated webhook configuration"),
  logicGateConfig: z
    .object({
      gateType: z.enum(["and", "or", "nand", "xor"]),
    })
    .optional()
    .describe("Updated logic gate config (gate type)"),
  rateLimiterConfig: z
    .object({
      maxEvents: z.number(),
      windowMs: z.number(),
    })
    .optional()
    .describe("Updated rate limiter configuration"),
  marketSlug: z
    .string()
    .optional()
    .describe("Updated Polymarket event slug"),
  marketOutcome: z
    .enum(["yes", "no"])
    .optional()
    .describe("Updated market outcome selection"),
  marketIndex: z
    .number()
    .optional()
    .describe("Updated sub-market index"),
  amountType: z
    .enum(["dollars", "shares"])
    .optional()
    .describe("Updated amount type for output nodes"),
  signalConfig: z
    .object({
      marketSlug: z.string(),
      windowSeconds: z.number(),
      refreshMs: z.number(),
    })
    .optional()
    .describe("Updated signal config (market slug, window, refresh interval)"),
});

export type UpdateNodeParams = z.infer<typeof updateNodeSchema>;

// ─── Tool definitions ───────────────────────────────────────────
export const blueprintTools = {
  create_blueprint: tool({
    description:
      "Create a complete blueprint with nodes and edges. " +
      "Use this when the user wants a brand-new blueprint from scratch. " +
      "Node positions are auto-computed — do not include position data. " +
      "Output nodes require an action (verb, token_id, amount) for order placement. " +
      "Every edge from a decision node must include a sourceHandle matching one of its branch names.",
    inputSchema: blueprintInputSchema,
  }),

  add_node: tool({
    description:
      "Add a single node to the current blueprint. " +
      "Use this when the user wants to add a new node without recreating the whole blueprint. " +
      "The node will be auto-positioned on the canvas.",
    inputSchema: nodeSchema,
  }),

  update_node: tool({
    description:
      "Update properties of an existing node in the current blueprint. " +
      "Only include fields that need to change — omitted fields stay the same. " +
      "The `id` field is required to identify which node to update.",
    inputSchema: updateNodeSchema,
  }),

  delete_node: tool({
    description:
      "Delete a node from the current blueprint by its id. " +
      "All edges connected to the node are also removed.",
    inputSchema: z.object({
      id: z.string().describe("The id of the node to delete"),
    }),
  }),

  add_edge: tool({
    description:
      "Add an edge (connection) between two nodes in the current blueprint. " +
      "For edges from a decision node, `sourceHandle` is required and must match a branch name.",
    inputSchema: edgeSchema,
  }),

  delete_edge: tool({
    description:
      "Delete an edge from the current blueprint. Specify the source and target node ids " +
      "(and optionally sourceHandle for decision nodes) to identify which edge to remove.",
    inputSchema: z.object({
      source: z.string().describe("Source node id of the edge to delete"),
      target: z.string().describe("Target node id of the edge to delete"),
      sourceHandle: z
        .string()
        .optional()
        .describe("Source handle to disambiguate when multiple edges exist between the same nodes"),
    }),
  }),

  rename_blueprint: tool({
    description: "Rename the current blueprint.",
    inputSchema: z.object({
      name: z.string().describe("The new name for the blueprint"),
    }),
  }),

  search_markets: tool({
    description:
      "Search Polymarket for events matching a query. " +
      "Use this to find the correct marketSlug and token IDs before creating market or output nodes. " +
      "Returns matching events with their slugs, token IDs, and current prices.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Search query, e.g. 'Trump', 'Bitcoin', 'Fed rate'"),
    }),
  }),

  validate_blueprint: tool({
    description:
      "Validate the current blueprint and check for errors. " +
      "You MUST call this after making any edits (add_node, update_node, delete_node, add_edge, delete_edge) to verify the blueprint is valid and runnable. " +
      "If there are errors, fix them using edit tools and then call validate_blueprint again. " +
      "Do NOT respond to the user until validation passes with zero errors.",
    inputSchema: z.object({}),
  }),
};
