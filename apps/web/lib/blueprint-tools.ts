import { tool } from "ai";
import { z } from "zod/v4";

// ─── Node type schemas ──────────────────────────────────────────
// To add a new node type:
//   1. Define its schema below
//   2. Add it to the nodeSchema discriminatedUnion
//   3. Handle it in the onToolCall callback in blueprint-chat.tsx
//   4. Describe it in the system prompt in app/api/chat/route.ts

const manualTriggerSchema = z.object({
  type: z.literal("input"),
  inputType: z
    .literal("manual_trigger")
    .optional()
    .describe("Defaults to manual_trigger when omitted"),
  id: z.string().describe("Unique node id, e.g. 'input-1'"),
  label: z.string().describe("Display label for this node"),
  outputs: z
    .array(z.string())
    .describe("Topics this node publishes, e.g. ['topic.orders']"),
});

const cryptoMonitorSchema = z.object({
  type: z.literal("input"),
  inputType: z.literal("crypto_monitor"),
  id: z.string().describe("Unique node id, e.g. 'crypto-1'"),
  label: z.string().describe("Display label, e.g. 'BTC Price Monitor'"),
  outputs: z
    .array(z.string())
    .describe("Topics this node publishes, e.g. ['topic.orders']"),
  cryptoMonitorConfig: z.object({
    symbol: z
      .string()
      .describe("Trading pair, e.g. 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'"),
    condition: z.enum(["drops_below", "rises_above"]),
    targetPrice: z.number().describe("Target price threshold in USD"),
  }),
});

const cryptoPriceSchema = z.object({
  type: z.literal("input"),
  inputType: z.literal("crypto_price"),
  id: z.string().describe("Unique node id, e.g. 'crypto-price-1'"),
  label: z.string().describe("Display label, e.g. 'BTC Price'"),
  outputs: z
    .array(z.string())
    .describe("Topics this node publishes, e.g. ['topic.orders']"),
  cryptoMonitorConfig: z.object({
    symbol: z
      .string()
      .describe("Trading pair, e.g. 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'"),
    condition: z.enum(["drops_below", "rises_above"]).describe("Ignored for crypto_price — set to any value"),
    targetPrice: z.literal(0).describe("Must be 0 — crypto_price streams live price without a condition"),
  }),
});

const decisionNodeSchema = z.object({
  type: z.literal("decision"),
  id: z.string().describe("Unique node id, e.g. 'decision-1'"),
  label: z.string().describe("Display label for this node"),
  inputs: z
    .array(z.string())
    .describe("Topics this node consumes, e.g. ['topic.orders']"),
  outputs: z
    .array(z.string())
    .describe("Branch names, e.g. ['bullish', 'bearish']"),
  action: z.object({
    verb: z.enum(["buy", "sell"]),
    market_id: z
      .string()
      .describe("Polymarket condition ID or market slug"),
  }),
});

const outputNodeSchema = z.object({
  type: z.literal("output"),
  id: z.string().describe("Unique node id, e.g. 'output-1'"),
  label: z.string().describe("Display label for this node"),
  inputs: z
    .array(z.string())
    .describe("Topics this node consumes, e.g. ['topic.orders']"),
});

const comparisonNodeSchema = z.object({
  type: z.literal("comparison"),
  id: z.string().describe("Unique node id, e.g. 'comparison-1'"),
  label: z.string().describe("Display label for this node"),
  inputs: z
    .array(z.string())
    .describe("Must be ['input-a', 'input-b']"),
  outputs: z
    .array(z.string())
    .describe("Output topics (usually empty — boolean output via handle)"),
  comparisonConfig: z.object({
    operator: z.enum([">", "<", ">=", "<=", "==", "!="]),
    thresholdA: z.number().optional().describe("Static value for input A (use instead of connecting a node to input-a)"),
    thresholdB: z.number().optional().describe("Static value for input B (use instead of connecting a node to input-b)"),
  }),
});

// ─── Node union (extend by adding to this array) ────────────────
const nodeSchema = z.union([
  cryptoMonitorSchema,
  cryptoPriceSchema,
  manualTriggerSchema,
  decisionNodeSchema,
  outputNodeSchema,
  comparisonNodeSchema,
]);

const edgeSchema = z.object({
  source: z.string().describe("Source node id"),
  target: z.string().describe("Target node id"),
  sourceHandle: z
    .string()
    .optional()
    .describe("Required for decision nodes — the branch name to connect from"),
  targetHandle: z
    .string()
    .optional()
    .describe('Required for comparison nodes — "input-a" or "input-b"'),
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
      market_id: z.string(),
    })
    .optional()
    .describe("Updated action for decision nodes"),
  inputType: z
    .enum(["manual_trigger", "crypto_monitor", "crypto_price"])
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
});

export type UpdateNodeParams = z.infer<typeof updateNodeSchema>;

// ─── Tool definitions ───────────────────────────────────────────
export const blueprintTools = {
  create_blueprint: tool({
    description:
      "Create a complete blueprint with nodes and edges. " +
      "Use this when the user wants a brand-new blueprint from scratch. " +
      "Node positions are auto-computed — do not include position data. " +
      "There must be exactly one decision node with an action (verb + market_id). " +
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
};
