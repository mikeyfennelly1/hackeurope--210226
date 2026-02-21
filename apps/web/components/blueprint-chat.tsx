"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  BlueprintBuilder,
  type Blueprint,
} from "@repo/backend/blueprints";
import { MessageCircle, Send, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BlueprintToolParams } from "@/lib/blueprint-tools";

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
      inputs: "inputs" in node ? node.inputs : [],
      outputs: "outputs" in node ? node.outputs : [],
      ...("action" in node && node.action ? { action: node.action } : {}),
      ...("inputType" in node && node.inputType
        ? { inputType: node.inputType }
        : {}),
      ...("cryptoMonitorConfig" in node && node.cryptoMonitorConfig
        ? { cryptoMonitorConfig: node.cryptoMonitorConfig }
        : {}),
    });
  }

  for (const edge of params.edges) {
    builder.addEdge({
      id: `edge-${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    });
  }

  return builder.build();
}

export function BlueprintChat({
  blueprintId,
  open,
  onClose,
  onBlueprintGenerated,
}: {
  blueprintId: string;
  open: boolean;
  onClose: () => void;
  onBlueprintGenerated: (blueprint: Blueprint) => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, addToolOutput, status } = useChat({
    id: blueprintId,
    messages: loadChatMessages(blueprintId),
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName === "create_blueprint") {
        try {
          const blueprint = toolParamsToBlueprint(
            toolCall.input as BlueprintToolParams,
          );
          onBlueprintGenerated(blueprint);
          addToolOutput({
            tool: "create_blueprint",
            toolCallId: toolCall.toolCallId,
            output: `Blueprint "${blueprint.name}" created with ${blueprint.nodes.length} nodes.`,
          });
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Unknown error";
          addToolOutput({
            tool: "create_blueprint",
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText: `Failed to create blueprint: ${msg}`,
          });
        }
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

  return (
    <div className="fixed bottom-4 left-[316px] z-50 flex w-[400px] flex-col border border-white/10 bg-[#0d0f0f] shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-[#5a7a6a]" />
          <span className="text-sm font-medium text-[#e0e5e2]">
            Blueprint AI
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-[#5c635e] transition hover:text-[#c8ccc9]"
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
          <p className="text-center text-xs text-[#5c635e]">
            Describe a trading pipeline and I&apos;ll create the blueprint.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`text-sm ${message.role === "user" ? "text-[#e0e5e2]" : "text-[#8a918c]"}`}
          >
            <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-[#5c635e]">
              {message.role === "user" ? "You" : "AI"}
            </span>
            {message.parts.map((part, i) => {
              switch (part.type) {
                case "text":
                  return (
                    <p key={i} className="whitespace-pre-wrap">
                      {part.text}
                    </p>
                  );
                case "tool-create_blueprint":
                  return (
                    <div
                      key={i}
                      className="mt-1 border border-[#5a7a6a]/30 bg-[#1a1f1d] px-3 py-2 text-xs text-[#5a7a6a]"
                    >
                      {part.state === "output-available"
                        ? String(part.output)
                        : part.state === "output-error"
                          ? `Error: ${part.errorText}`
                          : "Generating blueprint..."}
                    </div>
                  );
                default:
                  return null;
              }
            })}
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex items-center gap-2 text-xs text-[#5c635e]">
            <Loader2 className="size-3 animate-spin" />
            Thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-white/10 p-3">
        <div className="flex gap-2">
          <input
            className="flex-1 border border-white/10 bg-[#161a19] px-3 py-2 text-sm text-[#e0e5e2] placeholder-[#5c635e] outline-none focus:border-[#5a7a6a]"
            placeholder="Describe a trading pipeline..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && input.trim()) {
                e.preventDefault();
                sendMessage({ text: input });
                setInput("");
              }
            }}
            disabled={isLoading}
          />
          <Button
            size="sm"
            variant="default"
            disabled={isLoading || !input.trim()}
            onClick={() => {
              if (input.trim()) {
                sendMessage({ text: input });
                setInput("");
              }
            }}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
