"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  BlueprintBuilder,
  type Blueprint,
} from "@repo/backend/blueprints";
import { MessageCircle, Send, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  BlueprintToolParams,
  AddNodeParams,
  UpdateNodeParams,
  AddEdgeParams,
} from "@/lib/blueprint-tools";

function chatStorageKey(blueprintId: string): string {
  return `chat:${blueprintId}`;
}

function loadChatMessages(blueprintId: string): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(chatStorageKey(blueprintId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveChatMessages(blueprintId: string, messages: UIMessage[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(chatStorageKey(blueprintId), JSON.stringify(messages));
}

function toolParamsToBlueprint(params: BlueprintToolParams): Blueprint {
  const builder = new BlueprintBuilder(params.name);

  for (const node of params.nodes) {
    builder.addNode({
      id: node.id,
      type: node.type,
      label: node.label,
      position: { x: 0, y: 0 }, // Auto-laid out by computeLayout via blueprintToFlow
      inputs: ("inputs" in node ? node.inputs : undefined) ?? [],
      outputs: ("outputs" in node ? node.outputs : undefined) ?? [],
      ...("action" in node && node.action ? { action: node.action } : {}),
      ...("inputType" in node && node.inputType
        ? { inputType: node.inputType }
        : {}),
      ...("cryptoMonitorConfig" in node && node.cryptoMonitorConfig
        ? { cryptoMonitorConfig: node.cryptoMonitorConfig }
        : {}),
      ...("comparisonConfig" in node && node.comparisonConfig
        ? { comparisonConfig: node.comparisonConfig }
        : {}),
      ...("webhookConfig" in node && node.webhookConfig
        ? { webhookConfig: node.webhookConfig }
        : {}),
    });
  }

  for (const edge of params.edges) {
    builder.addEdge({
      id: `edge-${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    });
  }

  return builder.build();
}

function blueprintToContext(bp: Blueprint): string {
  const nodes = bp.nodes.map((n) => {
    const parts = [`id="${n.id}" type="${n.type}" label="${n.label}"`];
    if (n.inputType) parts.push(`inputType="${n.inputType}"`);
    if (n.inputs.length > 0) parts.push(`inputs=[${n.inputs.join(", ")}]`);
    if (n.outputs.length > 0) parts.push(`outputs=[${n.outputs.join(", ")}]`);
    if (n.action) parts.push(`action={verb:"${n.action.verb}", token_id:"${n.action.token_id}", amount:${n.action.amount}}`);
    if (n.cryptoMonitorConfig) {
      const c = n.cryptoMonitorConfig;
      parts.push(`cryptoMonitorConfig={symbol:"${c.symbol}", condition:"${c.condition}", targetPrice:${c.targetPrice}}`);
    }
    if (n.comparisonConfig) {
      const cc = n.comparisonConfig;
      const ccParts = [`operator:"${cc.operator}"`];
      if (cc.thresholdA !== undefined) ccParts.push(`thresholdA:${cc.thresholdA}`);
      if (cc.thresholdB !== undefined) ccParts.push(`thresholdB:${cc.thresholdB}`);
      parts.push(`comparisonConfig={${ccParts.join(", ")}}`);
    }
    if (n.webhookConfig) {
      const wc = n.webhookConfig;
      const wcParts = [`mode:"${wc.mode}"`];
      if (wc.path) wcParts.push(`path:"${wc.path}"`);
      if (wc.url) wcParts.push(`url:"${wc.url}"`);
      parts.push(`webhookConfig={${wcParts.join(", ")}}`);
    }
    if (n.marketOutcome) {
      parts.push(`marketOutcome="${n.marketOutcome}"`);
    }
    return `  - ${parts.join(" ")}`;
  });
  const edges = bp.edges.map((e) => {
    const parts = [`source="${e.source}" target="${e.target}"`];
    if (e.sourceHandle) parts.push(`sourceHandle="${e.sourceHandle}"`);
    return `  - ${parts.join(" ")}`;
  });
  return `Current blueprint: "${bp.name}" (id: ${bp.id})\nNodes:\n${nodes.join("\n")}\nEdges:\n${edges.join("\n") || "  (none)"}`;
}

export type BlueprintEditCallbacks = {
  onBlueprintGenerated: (blueprint: Blueprint) => void;
  onAddNode: (params: AddNodeParams) => void;
  onUpdateNode: (params: UpdateNodeParams) => void;
  onDeleteNode: (id: string) => void;
  onAddEdge: (params: AddEdgeParams) => void;
  onDeleteEdge: (source: string, target: string, sourceHandle?: string) => void;
  onRenameBlueprint: (name: string) => void;
};

type ToolPartType =
  | "tool-create_blueprint"
  | "tool-add_node"
  | "tool-update_node"
  | "tool-delete_node"
  | "tool-add_edge"
  | "tool-delete_edge"
  | "tool-rename_blueprint";

const TOOL_PART_TYPES: ToolPartType[] = [
  "tool-create_blueprint",
  "tool-add_node",
  "tool-update_node",
  "tool-delete_node",
  "tool-add_edge",
  "tool-delete_edge",
  "tool-rename_blueprint",
];

function isToolPart(type: string): type is ToolPartType {
  return TOOL_PART_TYPES.includes(type as ToolPartType);
}

export function BlueprintChat({
  blueprintId,
  currentBlueprint,
  open,
  onClose,
  callbacks,
}: {
  blueprintId: string;
  currentBlueprint: Blueprint | null;
  open: boolean;
  onClose: () => void;
  callbacks: BlueprintEditCallbacks;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep a ref to callbacks so onToolCall closure always sees the latest
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const blueprintContext = useMemo(
    () => (currentBlueprint ? blueprintToContext(currentBlueprint) : null),
    [currentBlueprint],
  );

  const { messages, sendMessage, addToolOutput, status } = useChat({
    id: blueprintId,
    messages: loadChatMessages(blueprintId),
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    onToolCall: ({ toolCall }) => {
      const cb = callbacksRef.current;
      const name = toolCall.toolName;

      try {
        switch (name) {
          case "create_blueprint": {
            const blueprint = toolParamsToBlueprint(
              toolCall.input as BlueprintToolParams,
            );
            cb.onBlueprintGenerated(blueprint);
            addToolOutput({
              tool: "create_blueprint",
              toolCallId: toolCall.toolCallId,
              output: `Blueprint "${blueprint.name}" created with ${blueprint.nodes.length} nodes.`,
            });
            break;
          }

          case "add_node": {
            const params = toolCall.input as AddNodeParams;
            cb.onAddNode(params);
            addToolOutput({
              tool: "add_node",
              toolCallId: toolCall.toolCallId,
              output: `Node "${params.label}" (${params.id}) added.`,
            });
            break;
          }

          case "update_node": {
            const params = toolCall.input as UpdateNodeParams;
            cb.onUpdateNode(params);
            const fields = Object.keys(params).filter((k) => k !== "id");
            addToolOutput({
              tool: "update_node",
              toolCallId: toolCall.toolCallId,
              output: `Node "${params.id}" updated: ${fields.join(", ")}.`,
            });
            break;
          }

          case "delete_node": {
            const { id } = toolCall.input as { id: string };
            cb.onDeleteNode(id);
            addToolOutput({
              tool: "delete_node",
              toolCallId: toolCall.toolCallId,
              output: `Node "${id}" deleted.`,
            });
            break;
          }

          case "add_edge": {
            const params = toolCall.input as AddEdgeParams;
            cb.onAddEdge(params);
            addToolOutput({
              tool: "add_edge",
              toolCallId: toolCall.toolCallId,
              output: `Edge from "${params.source}" to "${params.target}" added.`,
            });
            break;
          }

          case "delete_edge": {
            const { source, target, sourceHandle } = toolCall.input as {
              source: string;
              target: string;
              sourceHandle?: string;
            };
            cb.onDeleteEdge(source, target, sourceHandle);
            addToolOutput({
              tool: "delete_edge",
              toolCallId: toolCall.toolCallId,
              output: `Edge from "${source}" to "${target}" deleted.`,
            });
            break;
          }

          case "rename_blueprint": {
            const { name: newName } = toolCall.input as { name: string };
            cb.onRenameBlueprint(newName);
            addToolOutput({
              tool: "rename_blueprint",
              toolCallId: toolCall.toolCallId,
              output: `Blueprint renamed to "${newName}".`,
            });
            break;
          }

          default:
            break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        addToolOutput({
          tool: name,
          toolCallId: toolCall.toolCallId,
          state: "output-error",
          errorText: `Failed: ${msg}`,
        });
      }
    },
  });

  // Persist messages to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      saveChatMessages(blueprintId, messages);
    }
  }, [messages, blueprintId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  if (!open) return null;

  const isLoading = status === "streaming" || status === "submitted";

  const handleSend = () => {
    if (!input.trim()) return;
    // Prepend current blueprint context to each user message so the LLM always knows the current state
    const text = blueprintContext
      ? `${input}\n\n---\n${blueprintContext}`
      : input;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="fixed bottom-4 left-[316px] z-50 flex w-[400px] flex-col border border-white/10 bg-[#111314] shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-[#d4602c]" />
          <span className="font-[family-name:var(--font-geist-mono)] text-xs font-medium uppercase tracking-[0.15em] text-white/80">
            Blueprint AI
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-white/30 transition hover:text-white/80"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto p-4"
        style={{ maxHeight: "400px", minHeight: "200px" }}
      >
        {messages.length === 0 && (
          <p className="text-center font-[family-name:var(--font-geist-mono)] text-xs text-white/30">
            Describe a trading pipeline and I&apos;ll create or edit the blueprint.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`text-sm ${message.role === "user" ? "text-white/90" : "text-white/50"}`}
          >
            <span className="mb-1 block font-[family-name:var(--font-geist-mono)] text-[10px] uppercase tracking-[0.18em] text-white/30">
              {message.role === "user" ? "You" : "AI"}
            </span>
            {message.parts.map((part, i) => {
              switch (part.type) {
                case "text": {
                  // Strip the blueprint context from displayed user messages
                  const text =
                    message.role === "user"
                      ? part.text.split("\n\n---\nCurrent blueprint:")[0]
                      : part.text;
                  return (
                    <p key={i} className="whitespace-pre-wrap">
                      {text}
                    </p>
                  );
                }
                default:
                  if (isToolPart(part.type)) {
                    const toolPart = part as {
                      type: string;
                      state?: string;
                      output?: unknown;
                      errorText?: string;
                    };
                    return (
                      <div
                        key={i}
                        className="mt-1 border border-[#d4602c]/30 bg-[#d4602c]/5 px-3 py-2 font-[family-name:var(--font-geist-mono)] text-xs text-[#d4602c]"
                      >
                        {toolPart.state === "output-available"
                          ? String(toolPart.output)
                          : toolPart.state === "output-error"
                            ? `Error: ${toolPart.errorText}`
                            : "Processing..."}
                      </div>
                    );
                  }
                  return null;
              }
            })}
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex items-center gap-2 font-[family-name:var(--font-geist-mono)] text-xs text-white/30">
            <Loader2 className="size-3 animate-spin" />
            Thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-white/10 p-3">
        <div className="flex gap-2">
          <input
            className="flex-1 border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm text-white/90 placeholder-white/30 outline-none focus:border-[#d4602c]/50"
            placeholder="Describe a trading pipeline..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && input.trim()) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isLoading}
          />
          <Button
            size="sm"
            variant="default"
            disabled={isLoading || !input.trim()}
            onClick={handleSend}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
