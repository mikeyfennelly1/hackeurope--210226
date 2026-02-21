import { tool } from "ai";
import { z } from "zod/v4";

// ─── Node type schemas ──────────────────────────────────────────
// To add a new node type:
//   1. Define its schema below
//   2. Add it to the nodeSchema discriminatedUnion
//   3. Handle it in the onToolCall callback in blueprint-chat.tsx
//   4. Describe it in the system prompt in app/api/chat/route.ts

const inputNodeSchema = z.object({
  type: z.literal("input"),
  id: z.string().describe("Unique node id, e.g. 'input-1'"),
  label: z.string().describe("Display label for this node"),
  outputs: z
    .array(z.string())
    .describe("Topics this node publishes, e.g. ['topic.orders']"),
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

// ─── Discriminated union (extend by adding to this array) ───────
const nodeSchema = z.discriminatedUnion("type", [
  inputNodeSchema,
  decisionNodeSchema,
  outputNodeSchema,
]);

const edgeSchema = z.object({
  source: z.string().describe("Source node id"),
  target: z.string().describe("Target node id"),
  sourceHandle: z
    .string()
    .optional()
    .describe("Required for decision nodes — the branch name to connect from"),
});

// ─── Input schema + exported type ───────────────────────────────
const blueprintInputSchema = z.object({
  name: z.string().describe("Blueprint name"),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

export type BlueprintToolParams = z.infer<typeof blueprintInputSchema>;

// ─── Tool definitions ───────────────────────────────────────────
export const blueprintTools = {
  create_blueprint: tool({
    description:
      "Create a complete blueprint with nodes and edges. " +
      "Node positions are auto-computed — do not include position data. " +
      "There must be exactly one decision node with an action (verb + market_id). " +
      "Every edge from a decision node must include a sourceHandle matching one of its branch names.",
    inputSchema: blueprintInputSchema,
  }),
};
