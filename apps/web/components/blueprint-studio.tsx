"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  addEdge,
  Background,
  ConnectionLineType,
  type Connection,
  type EdgeChange,
  type Edge,
  Handle,
  type NodeChange,
  type Node,
  type NodeProps,
  type OnConnectEnd,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
  useViewport,
} from "@xyflow/react";
import {
  BlueprintBuilder,
  BlueprintUtils,
  toDefinition,
  type Blueprint,
  type ComparisonOperator,
  type CryptoConditionOperator,
  type CryptoMonitorConfig,
  type Decision,
  type InputNodeType,
  type MarketOutcome,
} from "@repo/backend/blueprints";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Ellipsis,
  GitBranch,
  Loader2,
  MessageCircle,
  Pencil,
  Play,
  Plus,
  Square,
  Scale,
  Trash2,
  TrendingUp,
  Zap,
} from "lucide-react";

import "@xyflow/react/dist/style.css";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { BlueprintChat, type BlueprintEditCallbacks } from "@/components/blueprint-chat";
import type { AddNodeParams, UpdateNodeParams, AddEdgeParams } from "@/lib/blueprint-tools";
import { CryptoMonitorNode } from "@/components/crypto-monitor-node";
import { MarketNode, MARKET_OUTPUT_IDS } from "@/components/market-node";
import { PulseProvider } from "@/components/pulse-context";
import { PulseEdge } from "@/components/pulse-edge";
import { computeLayout, GRID_SIZE } from "@/lib/auto-layout";

const STORAGE_KEY = "blueprints:v1";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type FlowNodeType = "inputNode" | "outputNode" | "decisionNode" | "marketNode" | "comparisonNode";

export type FlowNodeData = {
  label: string;
  inputs: string[];
  outputs: string[];
  action?: { verb: Decision; token_id: string; amount: number };
  hasError?: boolean;
  inputType?: InputNodeType;
  cryptoMonitorConfig?: CryptoMonitorConfig;
  marketSlug?: string;
  comparisonConfig?: { operator: ComparisonOperator; thresholdA?: number; thresholdB?: number };
  marketOutcome?: MarketOutcome;
};

type RedprintNodeState = {
  name: string;
  label?: string;
  role: string;
  status: string;
  firedAt?: string;
  inputType?: string;
  lastPrice?: number;
};

type RedprintJSON = {
  id: string;
  name: string;
  status: string;
  nodes: RedprintNodeState[];
  decision?: string | null;
  createdAt: string;
};

type ApiRedprintResponse = {
  id: string;
  blueprintName: string;
  status: string;
  nodes: Record<string, { label?: string; role: string; status: string; output: unknown; firedAt: string | null; inputType?: string; lastPrice?: number }>;
  decision: string | null;
  createdAt: string;
};

function apiResponseToRedprint(raw: ApiRedprintResponse): RedprintJSON {
  return {
    id: raw.id,
    name: raw.blueprintName,
    status: raw.status,
    nodes: Object.entries(raw.nodes).map(([name, state]) => ({
      name,
      label: state.label,
      role: state.role,
      status: state.status,
      firedAt: state.firedAt ?? undefined,
      inputType: state.inputType,
      lastPrice: state.lastPrice,
    })),
    decision: raw.decision,
    createdAt: raw.createdAt,
  };
}

type BlueprintError = ReturnType<
  typeof BlueprintUtils.validate
>["errors"][number];

type ContextMenu =
  | { type: "pane"; screenX: number; screenY: number; flowX: number; flowY: number }
  | { type: "connection"; screenX: number; screenY: number; flowX: number; flowY: number; fromNodeId: string; fromHandleId: string | null; fromHandleType: "source" | "target" }
  | { type: "node"; screenX: number; screenY: number; nodeId: string };

const PHANTOM_NODE_ID = "__phantom__";
const PHANTOM_EDGE_ID = "__phantom_edge__";

function createStarterBlueprint(name: string): Blueprint {
  return new BlueprintBuilder(name)
    .addNode({
      id: "input-1",
      type: "input",
      label: "Input",
      position: { x: 80, y: 240 },
      inputs: [],
      outputs: ["topic.orders"],
    })
    .addNode({
      id: "decision-1",
      type: "decision",
      label: "Decision",
      position: { x: 400, y: 220 },
      inputs: ["topic.orders"],
      outputs: ["approved", "rejected"],
    })
    .addNode({
      id: "output-1",
      type: "output",
      label: "Output",
      position: { x: 760, y: 240 },
      inputs: ["topic.orders"],
      outputs: [],
    })
    .addEdge({ id: "edge-1", source: "input-1", target: "decision-1" })
    .addEdge({ id: "edge-2", source: "decision-1", target: "output-1", sourceHandle: "approved" })
    .build();
}

function toFlowNodeType(
  type: Blueprint["nodes"][number]["type"],
): FlowNodeType {
  if (type === "input") return "inputNode";
  if (type === "output") return "outputNode";
  if (type === "market") return "marketNode";
  if (type === "comparison") return "comparisonNode";
  return "decisionNode";
}

function toBlueprintNodeType(
  type: FlowNodeType,
): Blueprint["nodes"][number]["type"] {
  if (type === "inputNode") return "input";
  if (type === "outputNode") return "output";
  if (type === "marketNode") return "market";
  if (type === "comparisonNode") return "comparison";
  return "decision";
}

function blueprintToFlow(blueprint: Blueprint): {
  nodes: Node<FlowNodeData, FlowNodeType>[];
  edges: Edge[];
} {
  const nodes: Node<FlowNodeData, FlowNodeType>[] = blueprint.nodes.map((node) => ({
    id: node.id,
    type: toFlowNodeType(node.type),
    position: node.position,
    data: {
      label: node.label,
      inputs: [...node.inputs],
      outputs: [...node.outputs],
      action: node.action,
      inputType: node.inputType,
      cryptoMonitorConfig: node.cryptoMonitorConfig,
      comparisonConfig: node.comparisonConfig,
      marketSlug: node.marketSlug,
      marketOutcome: node.marketOutcome,
    },
  }));

  const edges: Edge[] = blueprint.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: "pulse",
    animated: false,
  }));

  // Auto-layout when all nodes sit at (0,0) — e.g. AI-generated blueprints
  const needsLayout =
    nodes.length > 1 &&
    nodes.every((n) => n.position.x === 0 && n.position.y === 0);

  return { nodes: needsLayout ? computeLayout(nodes, edges) : nodes, edges };
}

function flowToBlueprint(
  blueprint: Blueprint,
  nodes: Node<FlowNodeData, FlowNodeType>[],
  edges: Edge[],
): Blueprint {
  return {
    ...blueprint,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: toBlueprintNodeType(node.type ?? "outputNode"),
      label: node.data.label,
      position: node.position,
      inputs: [...node.data.inputs],
      outputs: [...node.data.outputs],
      ...(node.data.action ? { action: node.data.action } : {}),
      ...(node.data.inputType ? { inputType: node.data.inputType } : {}),
      ...(node.data.cryptoMonitorConfig
        ? { cryptoMonitorConfig: node.data.cryptoMonitorConfig }
        : {}),
      ...(node.data.comparisonConfig
        ? { comparisonConfig: node.data.comparisonConfig }
        : {}),
      ...(node.data.marketSlug ? { marketSlug: node.data.marketSlug } : {}),
      ...(node.data.marketOutcome
        ? { marketOutcome: node.data.marketOutcome }
        : {}),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
    })),
  };
}

function saveBlueprints(blueprints: Blueprint[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blueprints));
}

function loadBlueprints(): Blueprint[] {
  if (typeof window === "undefined")
    return [createStarterBlueprint("Order Blueprint")];

  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return [createStarterBlueprint("Order Blueprint")];
  }

  try {
    const parsed = JSON.parse(stored) as Blueprint[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createStarterBlueprint("Order Blueprint")];
    }

    return parsed;
  } catch {
    return [createStarterBlueprint("Order Blueprint")];
  }
}

function BaseNode({
  label,
  icon,
  subtitle,
  hasError,
  selected,
  children,
}: {
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  hasError?: boolean;
  selected?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-w-[220px] border border-white/20 bg-[#111314] font-[family-name:var(--font-geist-mono)] shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
      {/* Corner brackets — orange, indicate selection */}
      <div className={`absolute h-3 w-3 border-l border-t border-[#d4602c] transition-all ${selected ? "-left-1.5 -top-1.5" : "-left-px -top-px"}`} />
      <div className={`absolute h-3 w-3 border-r border-t border-[#d4602c] transition-all ${selected ? "-right-1.5 -top-1.5" : "-right-px -top-px"}`} />
      <div className={`absolute h-3 w-3 border-b border-l border-[#d4602c] transition-all ${selected ? "-bottom-1.5 -left-1.5" : "-bottom-px -left-px"}`} />
      <div className={`absolute h-3 w-3 border-b border-r border-[#d4602c] transition-all ${selected ? "-bottom-1.5 -right-1.5" : "-bottom-px -right-px"}`} />

      {/* Wavy error border — SVG displacement filter distorts a red outline */}
      {hasError && (
        <>
          <svg className="absolute h-0 w-0 overflow-hidden" aria-hidden="true">
            <defs>
              <filter id="wavy-error">
                <feTurbulence type="turbulence" baseFrequency="0.04 0.07" numOctaves="3" seed="2" result="turb">
                  <animate attributeName="seed" values="2;10;2" dur="3s" repeatCount="indefinite" />
                </feTurbulence>
                <feDisplacementMap in="SourceGraphic" in2="turb" scale="6" xChannelSelector="R" yChannelSelector="G" />
              </filter>
            </defs>
          </svg>
          <div
            className="pointer-events-none absolute -inset-[3px] border-2 border-[#c45c5c]"
            style={{ filter: "url(#wavy-error)" }}
          />
        </>
      )}

      {/* Noise overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: "128px 128px",
        }}
      />

      <div className="relative">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <span className="text-[#d4602c]">{icon}</span>
          <p className="text-[9px] font-medium uppercase tracking-[0.25em] text-white/40">
            {subtitle}
          </p>
        </div>

        {/* Label */}
        <div className="border-b border-white/10 px-3 py-2.5">
          <p className="text-[13px] font-bold leading-tight tracking-tight text-white/90">{label}</p>
        </div>

        {/* Content */}
        <div className="px-3 py-2">
          {children}
        </div>
      </div>

      {/* Scanlines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 3px)",
        }}
      />
    </div>
  );
}

function InputNode(props: NodeProps<Node<FlowNodeData, "inputNode">>) {
  const { data, selected } = props;
  if (data.inputType === "crypto_monitor" || data.inputType === "crypto_price") {
    return <CryptoMonitorNode {...props} />;
  }

  return (
    <BaseNode
      label={data.label}
      subtitle="Manual Trigger"
      icon={<Zap className="size-3.5" />}
      hasError={data.hasError}
      selected={selected}
    >
      <Handle type="source" position={Position.Right} />
      <div className="text-[8px] uppercase tracking-[0.25em] text-white/30">
        Publishes
      </div>
      <p className="mt-0.5 text-[10px] text-white/50">
        {data.outputs.join(", ") || "none"}
      </p>
    </BaseNode>
  );
}

function OutputNode({ data, selected }: NodeProps<Node<FlowNodeData, "outputNode">>) {
  return (
    <BaseNode
      label={data.label}
      subtitle="Output"
      icon={<CheckCircle2 className="size-3.5" />}
      hasError={data.hasError}
      selected={selected}
    >
      <Handle type="target" position={Position.Left} />
      <div className="text-[8px] uppercase tracking-[0.25em] text-white/30">
        Consumes
      </div>
      <p className="mt-0.5 text-[10px] text-white/50">
        {data.inputs.join(", ") || "none"}
      </p>
    </BaseNode>
  );
}

function DecisionNode({ data, selected }: NodeProps<Node<FlowNodeData, "decisionNode">>) {
  return (
    <BaseNode
      label={data.label}
      subtitle="Decision"
      icon={<GitBranch className="size-3.5" />}
      hasError={data.hasError}
      selected={selected}
    >
      <Handle type="target" position={Position.Left} />
      <div className="text-[8px] uppercase tracking-[0.25em] text-white/30">
        Consumes
      </div>
      <p className="mt-0.5 text-[10px] text-white/50">
        {data.inputs.join(", ") || "none"}
      </p>
      <div className="mt-2 text-[8px] uppercase tracking-[0.25em] text-white/30">
        Branches
      </div>
      <div className="mt-1 space-y-1">
        {data.outputs.map((branch) => (
          <div
            key={branch}
            className="relative flex items-center border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-white/60"
          >
            {branch}
            <Handle
              id={branch}
              type="source"
              position={Position.Right}
              style={{ top: "50%" }}
            />
          </div>
        ))}
      </div>
    </BaseNode>
  );
}

function ComparisonNode({ data, selected }: NodeProps<Node<FlowNodeData, "comparisonNode">>) {
  const op = data.comparisonConfig?.operator ?? ">";
  const thA = data.comparisonConfig?.thresholdA;
  const thB = data.comparisonConfig?.thresholdB;
  const labelA = thA !== undefined ? `$${thA.toLocaleString()}` : "A";
  const labelB = thB !== undefined ? `$${thB.toLocaleString()}` : "B";
  return (
    <BaseNode
      label={data.label}
      subtitle="Comparison"
      icon={<Scale className="size-3.5" />}
      hasError={data.hasError}
      selected={selected}
    >
      <Handle type="target" position={Position.Left} id="input-a" style={{ top: "35%" }} />
      <Handle type="target" position={Position.Left} id="input-b" style={{ top: "65%" }} />
      <Handle type="source" position={Position.Right} />
      {(thA !== undefined || thB !== undefined) && (
        <div className="mb-0.5 flex justify-between text-[9px]">
          {thA !== undefined && <span className="text-[#e8a838]">A = ${thA.toLocaleString()}</span>}
          {thB !== undefined && <span className="ml-auto text-[#e8a838]">B = ${thB.toLocaleString()}</span>}
        </div>
      )}
      <div className="flex items-center justify-center py-1">
        <span className="text-[20px] font-bold leading-none text-[#d4602c]">{op}</span>
      </div>
      <div className="flex justify-between text-[9px] text-white/30">
        <span>{labelA} {op} {labelB}</span>
        <span className="text-[#d4602c]/60">bool</span>
      </div>
    </BaseNode>
  );
}

function PhantomNode() {
  return (
    <div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
    </div>
  );
}

function ToolbarField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-[family-name:var(--font-geist-mono)] text-[8px] uppercase tracking-[0.25em] text-white/30">
        {label}
      </span>
      {children}
    </div>
  );
}

type PolymarketMarket = {
  question: string;
  yesTokenId: string;
  noTokenId: string;
  volume24hr: number;
};

function FloatingNodeToolbar({
  node,
  errors,
  onUpdate,
  onDelete,
}: {
  node: Node<FlowNodeData, FlowNodeType>;
  errors: BlueprintError[];
  onUpdate: (patch: Partial<FlowNodeData>) => void;
  onDelete: () => void;
}) {
  const { flowToScreenPosition, getNode } = useReactFlow();
  const { zoom } = useViewport();
  const [markets, setMarkets] = useState<PolymarketMarket[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(false);

  // Fetch top markets for output nodes
  useEffect(() => {
    if (node.type === "outputNode" && markets.length === 0 && !marketsLoading) {
      setMarketsLoading(true);
      fetch("/api/polymarket?top=15")
        .then((res) => res.json())
        .then((data) => setMarkets(data))
        .catch(() => setMarkets([]))
        .finally(() => setMarketsLoading(false));
    }
  }, [node.type, markets.length, marketsLoading]);

  const internalNode = getNode(node.id);
  const nodeWidth = internalNode?.measured?.width ?? 200;
  const screenPos = flowToScreenPosition({
    x: node.position.x + nodeWidth / 2,
    y: node.position.y,
  });
  const nodeErrors = errors.filter((e) => e.nodeId === node.id);

  const nodeTypeLabel =
    node.type === "inputNode" ? "INPUT"
    : node.type === "outputNode" ? "OUTPUT"
    : node.type === "decisionNode" ? "DECISION"
    : node.type === "comparisonNode" ? "COMPARISON"
    : "MARKET";

  return (
    <div
      className="fixed z-50 flex flex-col items-center"
      style={{
        left: screenPos.x,
        top: screenPos.y,
        transform: `translate(-50%, -100%) scale(${zoom})`,
        transformOrigin: "center bottom",
        paddingBottom: 8,
      }}
    >
      {nodeErrors.length > 0 && (
        <div className="mb-1 space-y-1">
          {nodeErrors.map((error) => (
            <div
              key={`${error.code}-${error.nodeId ?? ""}`}
              className="border border-[#c45c5c]/30 bg-[#111314] px-2 py-1 font-[family-name:var(--font-geist-mono)] text-[10px] text-[#c45c5c]"
            >
              {error.message}
            </div>
          ))}
        </div>
      )}
      <div className="border border-white/10 bg-[#111314] font-[family-name:var(--font-geist-mono)] shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
          <span className="text-[9px] uppercase tracking-[0.2em] text-[#d4602c]">
            {nodeTypeLabel}
          </span>
          <button
            onClick={onDelete}
            className="text-white/30 transition-colors hover:text-[#c45c5c]"
          >
            <Trash2 className="size-3" />
          </button>
        </div>

        {/* Fields */}
        <div className="flex flex-col gap-2 px-3 py-2">
          {/* Label — all nodes */}
          <ToolbarField label="Label">
            <Input
              className="h-6 w-56 text-[11px]"
              value={node.data.label}
              onChange={(e) => onUpdate({ label: e.target.value })}
              placeholder="Node label"
            />
          </ToolbarField>

          {/* Input node: outputs (publishes) */}
          {node.type === "inputNode" && (
            <ToolbarField label="Publishes">
              <Input
                className="h-6 w-56 text-[11px]"
                value={node.data.outputs.join(", ")}
                onChange={(e) =>
                  onUpdate({
                    outputs: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="topic.orders, topic.events"
              />
            </ToolbarField>
          )}

          {/* Input node: crypto price fields (symbol only) */}
          {node.type === "inputNode" && node.data.inputType === "crypto_price" && (
            <ToolbarField label="Symbol">
              <select
                className="h-6 w-56 border border-white/10 bg-[#0a0a0a] px-1.5 text-[11px] text-white/80 outline-none"
                value={node.data.cryptoMonitorConfig?.symbol ?? "BTCUSDT"}
                onChange={(e) =>
                  onUpdate({
                    cryptoMonitorConfig: {
                      symbol: e.target.value,
                      condition: "drops_below" as CryptoConditionOperator,
                      targetPrice: 0,
                    },
                  })
                }
              >
                <option value="BTCUSDT">BTC / USDT</option>
                <option value="ETHUSDT">ETH / USDT</option>
                <option value="SOLUSDT">SOL / USDT</option>
                <option value="DOGEUSDT">DOGE / USDT</option>
                <option value="XRPUSDT">XRP / USDT</option>
              </select>
            </ToolbarField>
          )}

          {/* Input node: crypto monitor fields */}
          {node.type === "inputNode" && node.data.inputType === "crypto_monitor" && (
            <>
              <ToolbarField label="Symbol">
                <select
                  className="h-6 w-56 border border-white/10 bg-[#0a0a0a] px-1.5 text-[11px] text-white/80 outline-none"
                  value={node.data.cryptoMonitorConfig?.symbol ?? "BTCUSDT"}
                  onChange={(e) =>
                    onUpdate({
                      cryptoMonitorConfig: {
                        ...(node.data.cryptoMonitorConfig ?? {
                          condition: "drops_below" as CryptoConditionOperator,
                          targetPrice: 0,
                        }),
                        symbol: e.target.value,
                      },
                    })
                  }
                >
                  <option value="BTCUSDT">BTC / USDT</option>
                  <option value="ETHUSDT">ETH / USDT</option>
                  <option value="SOLUSDT">SOL / USDT</option>
                  <option value="DOGEUSDT">DOGE / USDT</option>
                  <option value="XRPUSDT">XRP / USDT</option>
                </select>
              </ToolbarField>
              <ToolbarField label="Condition">
                <select
                  className="h-6 w-56 border border-white/10 bg-[#0a0a0a] px-1.5 text-[11px] text-white/80 outline-none"
                  value={node.data.cryptoMonitorConfig?.condition ?? "drops_below"}
                  onChange={(e) =>
                    onUpdate({
                      cryptoMonitorConfig: {
                        ...(node.data.cryptoMonitorConfig ?? {
                          symbol: "BTCUSDT",
                          targetPrice: 0,
                        }),
                        condition: e.target.value as CryptoConditionOperator,
                      },
                    })
                  }
                >
                  <option value="drops_below">Drops below</option>
                  <option value="rises_above">Rises above</option>
                </select>
              </ToolbarField>
              <ToolbarField label="Target Price">
                <Input
                  className="h-6 w-56 text-[11px]"
                  type="number"
                  value={node.data.cryptoMonitorConfig?.targetPrice ?? ""}
                  onChange={(e) =>
                    onUpdate({
                      cryptoMonitorConfig: {
                        ...(node.data.cryptoMonitorConfig ?? {
                          symbol: "BTCUSDT",
                          condition: "drops_below" as CryptoConditionOperator,
                        }),
                        targetPrice: parseFloat(e.target.value) || 0,
                      },
                    })
                  }
                  placeholder="Target $"
                />
              </ToolbarField>
            </>
          )}

          {/* Output node: inputs (consumes) + action */}
          {node.type === "outputNode" && (
            <>
              <ToolbarField label="Consumes">
                <Input
                  className="h-6 w-56 text-[11px]"
                  value={node.data.inputs.join(", ")}
                  onChange={(e) =>
                    onUpdate({
                      inputs: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="topic.orders"
                />
              </ToolbarField>
              <div className="border-t border-white/[0.06] pt-2">
                <span className="mb-1 block text-[8px] uppercase tracking-[0.25em] text-white/30">
                  Order Action
                </span>
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-1.5">
                    <select
                      className="h-6 w-20 border border-white/10 bg-[#0a0a0a] px-1.5 text-[11px] text-white/80 outline-none"
                      value={node.data.action?.verb ?? "buy"}
                      onChange={(e) =>
                        onUpdate({
                          action: {
                            verb: e.target.value as Decision,
                            token_id: node.data.action?.token_id ?? "",
                            amount: node.data.action?.amount ?? 0,
                          },
                        })
                      }
                    >
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </select>
                    <Input
                      className="h-6 w-20 text-[11px]"
                      type="number"
                      min={0}
                      value={node.data.action?.amount ?? 0}
                      onChange={(e) =>
                        onUpdate({
                          action: {
                            verb: node.data.action?.verb ?? "buy",
                            token_id: node.data.action?.token_id ?? "",
                            amount: Number(e.target.value) || 0,
                          },
                        })
                      }
                      placeholder="Amount"
                    />
                  </div>
                  <select
                    className="h-6 w-full border border-white/10 bg-[#0a0a0a] px-1.5 text-[11px] text-white/80 outline-none"
                    value={node.data.action?.token_id ?? ""}
                    onChange={(e) =>
                      onUpdate({
                        action: {
                          verb: node.data.action?.verb ?? "buy",
                          token_id: e.target.value,
                          amount: node.data.action?.amount ?? 0,
                        },
                      })
                    }
                  >
                    <option value="">
                      {marketsLoading ? "Loading markets..." : "Select market"}
                    </option>
                    {markets.map((m) => (
                      <option key={m.yesTokenId} value={m.yesTokenId}>
                        {m.question.slice(0, 40)}{m.question.length > 40 ? "..." : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Decision node: inputs, branches, action */}
          {node.type === "decisionNode" && (
            <>
              <ToolbarField label="Consumes">
                <Input
                  className="h-6 w-56 text-[11px]"
                  value={node.data.inputs.join(", ")}
                  onChange={(e) =>
                    onUpdate({
                      inputs: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="topic.orders"
                />
              </ToolbarField>
              <ToolbarField label="Branches">
                <Input
                  className="h-6 w-56 text-[11px]"
                  value={node.data.outputs.join(", ")}
                  onChange={(e) =>
                    onUpdate({
                      outputs: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="approved, rejected"
                />
              </ToolbarField>
            </>
          )}

          {/* Market node: slug + outcome */}
          {node.type === "marketNode" && (
            <>
              <ToolbarField label="Event Slug">
                <Input
                  className="h-6 w-56 text-[11px]"
                  value={node.data.marketSlug ?? ""}
                  onChange={(e) => onUpdate({ marketSlug: e.target.value })}
                  placeholder="e.g. kraken-ipo-in-2025"
                />
              </ToolbarField>
              <ToolbarField label="Outcome Price">
                <select
                  className="h-6 w-56 border border-white/10 bg-[#0a0a0a] px-1.5 text-[11px] text-white/80 outline-none"
                  value={node.data.marketOutcome ?? "yes"}
                  onChange={(e) =>
                    onUpdate({ marketOutcome: e.target.value as MarketOutcome })
                  }
                >
                  <option value="yes">YES price</option>
                  <option value="no">NO price</option>
                </select>
              </ToolbarField>
            </>
          )}

          {/* Comparison node: operator + thresholds */}
          {node.type === "comparisonNode" && (
            <>
              <ToolbarField label="Operator">
                <select
                  className="h-6 w-56 border border-white/10 bg-[#0a0a0a] px-1.5 text-[11px] text-white/80 outline-none"
                  value={node.data.comparisonConfig?.operator ?? ">"}
                  onChange={(e) =>
                    onUpdate({
                      comparisonConfig: {
                        ...node.data.comparisonConfig,
                        operator: e.target.value as ComparisonOperator,
                      },
                    })
                  }
                >
                  <option value=">">&gt; Greater than</option>
                  <option value="<">&lt; Less than</option>
                  <option value=">=">&gt;= Greater or equal</option>
                  <option value="<=">&lt;= Less or equal</option>
                  <option value="==">== Equal</option>
                  <option value="!=">!= Not equal</option>
                </select>
              </ToolbarField>
              <ToolbarField label="Threshold A (static value)">
                <Input
                  className="h-6 w-56 text-[11px]"
                  type="number"
                  value={node.data.comparisonConfig?.thresholdA ?? ""}
                  onChange={(e) =>
                    onUpdate({
                      comparisonConfig: {
                        ...node.data.comparisonConfig,
                        operator: node.data.comparisonConfig?.operator ?? ">",
                        thresholdA: e.target.value ? parseFloat(e.target.value) : undefined,
                      },
                    })
                  }
                  placeholder="Leave empty if connected"
                />
              </ToolbarField>
              <ToolbarField label="Threshold B (static value)">
                <Input
                  className="h-6 w-56 text-[11px]"
                  type="number"
                  value={node.data.comparisonConfig?.thresholdB ?? ""}
                  onChange={(e) =>
                    onUpdate({
                      comparisonConfig: {
                        ...node.data.comparisonConfig,
                        operator: node.data.comparisonConfig?.operator ?? ">",
                        thresholdB: e.target.value ? parseFloat(e.target.value) : undefined,
                      },
                    })
                  }
                  placeholder="Leave empty if connected"
                />
              </ToolbarField>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type ConnectionInfo = {
  fromNodeId: string;
  fromHandleId: string | null;
  fromHandleType: "source" | "target";
};

type NodeOption = {
  type: FlowNodeType;
  inputSubType?: InputNodeType;
  label: string;
  icon: React.ReactNode;
  hasTarget: boolean;
  hasSource: boolean;
};

const INPUT_NODE_OPTIONS: NodeOption[] = [
  { type: "inputNode", inputSubType: "crypto_monitor", label: "Crypto Monitor", icon: <TrendingUp className="size-3 text-[#d4602c]" />, hasTarget: false, hasSource: true },
  { type: "inputNode", inputSubType: "crypto_price", label: "Crypto Price", icon: <TrendingUp className="size-3 text-[#d4602c]" />, hasTarget: false, hasSource: true },
  { type: "marketNode", label: "Market", icon: <BarChart3 className="size-3 text-[#d4602c]" />, hasTarget: false, hasSource: true },
];

const OTHER_NODE_OPTIONS: NodeOption[] = [
  { type: "decisionNode", label: "Decision", icon: <GitBranch className="size-3 text-[#d4602c]" />, hasTarget: true, hasSource: true },
  { type: "comparisonNode", label: "Comparison", icon: <Scale className="size-3 text-[#d4602c]" />, hasTarget: true, hasSource: true },
  { type: "outputNode", label: "Output", icon: <CheckCircle2 className="size-3 text-[#d4602c]" />, hasTarget: true, hasSource: false },
];

const ALL_NODE_OPTIONS: NodeOption[] = [...INPUT_NODE_OPTIONS, ...OTHER_NODE_OPTIONS];

const DROPDOWN_CONTENT_CLASS =
  "border-white/10 bg-[#111314] shadow-[0_8px_24px_rgba(0,0,0,0.35)]";

const DROPDOWN_ITEM_CLASS =
  "text-white/80 focus:bg-white/5 focus:text-white/80 data-[highlighted]:bg-white/5 data-[highlighted]:text-white/80";

const DROPDOWN_SUBTRIGGER_CLASS =
  "text-white/80 focus:bg-white/5 focus:text-white/80 data-[state=open]:bg-white/5 data-[state=open]:text-white/80 data-[highlighted]:bg-white/5 data-[highlighted]:text-white/80";

const DROPDOWN_ITEM_DESTRUCTIVE_CLASS =
  "text-[#c45c5c] focus:bg-[#c45c5c]/10 focus:text-[#c45c5c] data-[highlighted]:bg-[#c45c5c]/10 data-[highlighted]:text-[#c45c5c]";

function ConnectionNodePicker({
  menu,
  onAddNode,
  onClose,
}: {
  menu: Extract<ContextMenu, { type: "connection" }>;
  onAddNode: (
    type: FlowNodeType,
    position: { x: number; y: number },
    connectFrom: ConnectionInfo,
    inputSubType?: InputNodeType,
  ) => void;
  onClose: () => void;
}) {
  // Subscribe to viewport so we re-render (and reposition) on pan/zoom
  useViewport();
  const { flowToScreenPosition } = useReactFlow();
  const screenPos = flowToScreenPosition({ x: menu.flowX, y: menu.flowY });

  const { getNode } = useReactFlow();
  const fromNode = getNode(menu.fromNodeId);
  const fromNodeType = fromNode?.type as FlowNodeType | undefined;

  const connectFrom: ConnectionInfo = {
    fromNodeId: menu.fromNodeId,
    fromHandleId: menu.fromHandleId,
    fromHandleType: menu.fromHandleType,
  };

  const options = ALL_NODE_OPTIONS.filter((opt) => {
    const handleMatch = connectFrom.fromHandleType === "source" ? opt.hasTarget : opt.hasSource;
    if (!handleMatch) return false;
    // Don't offer the same node type as the source
    if (opt.type === fromNodeType) return false;
    return true;
  });

  return (
    <DropdownMenu open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DropdownMenuTrigger asChild>
        <div
          className="fixed size-0"
          style={{ left: screenPos.x, top: screenPos.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={0}
        className={`min-w-[120px] ${DROPDOWN_CONTENT_CLASS}`}
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {options.map((opt) => (
          <DropdownMenuItem
            key={`${opt.type}-${opt.inputSubType ?? ""}`}
            className={DROPDOWN_ITEM_CLASS}
            onClick={() => {
              onAddNode(opt.type, { x: menu.flowX, y: menu.flowY }, connectFrom, opt.inputSubType);
              onClose();
            }}
          >
            {opt.icon}
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CanvasContextMenu({
  menu,
  onAddNode,
  onDeleteNode,
  onClose,
}: {
  menu: Exclude<ContextMenu, { type: "connection" }>;
  onAddNode: (
    type: FlowNodeType,
    position: { x: number; y: number },
    connectFrom?: ConnectionInfo,
    inputSubType?: InputNodeType,
  ) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
}) {
  return (
    <DropdownMenu open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DropdownMenuTrigger asChild>
        <div
          className="fixed size-0"
          style={{ left: menu.screenX, top: menu.screenY }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={0}
        className={`min-w-[140px] ${DROPDOWN_CONTENT_CLASS}`}
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {menu.type === "pane" ? (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={DROPDOWN_SUBTRIGGER_CLASS}>
                <ArrowRight className="size-3 text-[#d4602c]" />
                Input
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={DROPDOWN_CONTENT_CLASS}>
                {INPUT_NODE_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={`${opt.type}-${opt.inputSubType ?? ""}`}
                    className={DROPDOWN_ITEM_CLASS}
                    onClick={() => {
                      onAddNode(opt.type, { x: menu.flowX, y: menu.flowY }, undefined, opt.inputSubType);
                      onClose();
                    }}
                  >
                    {opt.icon}
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {OTHER_NODE_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={`${opt.type}-${opt.inputSubType ?? ""}`}
                className={DROPDOWN_ITEM_CLASS}
                onClick={() => {
                  onAddNode(opt.type, { x: menu.flowX, y: menu.flowY }, undefined, opt.inputSubType);
                  onClose();
                }}
              >
                {opt.icon}
                {opt.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : (
          <DropdownMenuItem
            className={DROPDOWN_ITEM_DESTRUCTIVE_CLASS}
            onClick={() => {
              onDeleteNode(menu.nodeId);
              onClose();
            }}
          >
            <Trash2 className="size-3" />
            Delete node
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BlueprintStudioInner() {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string>("");
  const [nodes, setNodes] = useState<Node<FlowNodeData, FlowNodeType>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [validationErrors, setValidationErrors] = useState<BlueprintError[]>(
    [],
  );
  const [status, setStatus] = useState<"saved" | "invalid">("saved");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [activeRedprint, setActiveRedprint] = useState<RedprintJSON | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [deletingBlueprintId, setDeletingBlueprintId] = useState<string | null>(null);
  const [renamingBlueprintId, setRenamingBlueprintId] = useState<string | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const { screenToFlowPosition, fitView } = useReactFlow();

  const skipNextPaneClickRef = useRef(false);
  const isDraggingNodeRef = useRef(false);
  const wasSelectedBeforeDragRef = useRef(false);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const screenToFlowPositionRef = useRef(screenToFlowPosition);
  screenToFlowPositionRef.current = screenToFlowPosition;

  const selectedBlueprint = useMemo(
    () => blueprints.find((item) => item.id === selectedBlueprintId) ?? null,
    [blueprints, selectedBlueprintId],
  );

  const errorNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const error of validationErrors) {
      if (error.nodeId) ids.add(error.nodeId);
    }
    return ids;
  }, [validationErrors]);

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          hasError: errorNodeIds.has(node.id),
        },
      })),
    [nodes, errorNodeIds],
  );

  useEffect(() => {
    const loaded = loadBlueprints();
    setBlueprints(loaded);
    setSelectedBlueprintId(loaded[0]?.id ?? "");
  }, []);

  useEffect(() => {
    const bp = blueprints.find((item) => item.id === selectedBlueprintId) ?? null;
    if (!bp) return;
    const flow = blueprintToFlow(bp);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    const result = BlueprintUtils.validate(bp);
    setValidationErrors(result.errors);
    setStatus(result.valid ? "saved" : "invalid");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync flow state when switching blueprints
  }, [selectedBlueprintId]);

  const persistCurrent = useCallback(
    (nextNodes: Node<FlowNodeData, FlowNodeType>[], nextEdges: Edge[]) => {
      if (!selectedBlueprint) return;

      const updated = flowToBlueprint(selectedBlueprint, nextNodes, nextEdges);
      const result = BlueprintUtils.validate(updated);
      setValidationErrors(result.errors);
      setStatus(result.valid ? "saved" : "invalid");

      setBlueprints((current) => {
        const next = current.map((item) =>
          item.id === updated.id ? updated : item,
        );
        if (result.valid) {
          saveBlueprints(next);
        }
        return next;
      });
    },
    [selectedBlueprint],
  );

  const persistRef = useRef(persistCurrent);
  persistRef.current = persistCurrent;

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<FlowNodeData, FlowNodeType>>[]) => {
      // Ignore changes to the phantom node
      let filtered = changes.filter(
        (c) => !("id" in c && c.id === PHANTOM_NODE_ID),
      );
      // Suppress selection changes while dragging (prevents re-select after drop)
      if (isDraggingNodeRef.current) {
        filtered = filtered.filter((c) => c.type !== "select");
      }
      if (filtered.length === 0) return;
      const next = applyNodeChanges(filtered, nodesRef.current);
      setNodes(next);
      nodesRef.current = next;
      const hasDataChange = filtered.some((c) => c.type !== "select");
      if (hasDataChange) {
        persistRef.current(next, edgesRef.current);
      }
    },
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const filtered = changes.filter(
        (c) => !("id" in c && c.id === PHANTOM_EDGE_ID),
      );
      if (filtered.length === 0) return;
      const next = applyEdgeChanges(filtered, edgesRef.current);
      setEdges(next);
      edgesRef.current = next;
      persistRef.current(nodesRef.current, next);
    },
    [],
  );

  const dispatchBlueprint = async () => {
    if (!selectedBlueprint || status !== "saved") return;
    setDispatching(true);
    try {
      const definition = toDefinition(selectedBlueprint);
      const res = await fetch(`${API_URL}/api/redprints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(definition),
      });
      if (!res.ok) throw new Error(`Dispatch failed: ${res.status}`);
      const raw = (await res.json()) as ApiRedprintResponse;
      setActiveRedprint(apiResponseToRedprint(raw));
    } catch (err) {
      console.error("Dispatch error:", err);
    } finally {
      setDispatching(false);
    }
  };

  const pushEvent = async (nodeName: string) => {
    if (!activeRedprint) return;
    try {
      await fetch(
        `${API_URL}/api/redprints/${activeRedprint.id}/nodes/${nodeName}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ output: true }),
        },
      );
    } catch (err) {
      console.error("Push event error:", err);
    }
  };

  const teardownRedprint = async () => {
    if (!activeRedprint) return;
    try {
      await fetch(`${API_URL}/api/redprints/${activeRedprint.id}`, {
        method: "DELETE",
      });
      setActiveRedprint(null);
    } catch (err) {
      console.error("Teardown error:", err);
    }
  };

  useEffect(() => {
    if (!activeRedprint || activeRedprint.status !== "running") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/redprints/${activeRedprint.id}`,
        );
        if (res.ok) {
          const raw = (await res.json()) as ApiRedprintResponse;
          setActiveRedprint(apiResponseToRedprint(raw));
        }
      } catch {
        /* ignore polling errors */
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRedprint?.id, activeRedprint?.status]);

  const addNodeByType = (
    type: FlowNodeType,
    atPosition?: { x: number; y: number },
    connectFrom?: ConnectionInfo,
    inputSubType?: InputNodeType,
  ) => {
    let position: { x: number; y: number };

    if (atPosition) {
      position = atPosition;
    } else {
      const flowElement = document.querySelector(
        ".react-flow",
      ) as HTMLElement | null;
      const fallbackX = window.innerWidth / 2;
      const fallbackY = window.innerHeight / 2;
      const bounds = flowElement?.getBoundingClientRect();
      const center = screenToFlowPosition({
        x: bounds ? bounds.left + bounds.width / 2 : fallbackX,
        y: bounds ? bounds.top + bounds.height / 2 : fallbackY,
      });
      const anchor = nodes[nodes.length - 1];
      position = anchor
        ? { x: anchor.position.x + 260, y: anchor.position.y + 24 }
        : { x: center.x, y: center.y };
    }

    const isCryptoMonitor = type === "inputNode" && inputSubType === "crypto_monitor";
    const isCryptoPrice = type === "inputNode" && inputSubType === "crypto_price";
    const isCrypto = isCryptoMonitor || isCryptoPrice;
    const id = `${type}-${Date.now()}`;
    const node: Node<FlowNodeData, FlowNodeType> = {
      id,
      type,
      position,
      data: {
        label: isCryptoMonitor
          ? "BTC Price Monitor"
          : isCryptoPrice
            ? "BTC Price"
            : type === "decisionNode"
              ? "New Decision"
              : type === "inputNode"
                ? "New Input"
                : type === "comparisonNode"
                  ? "Compare"
                  : type === "marketNode"
                    ? "Market"
                    : "New Output",
        inputs: type === "inputNode" || type === "marketNode"
          ? []
          : type === "comparisonNode"
            ? ["input-a", "input-b"]
            : ["topic.orders"],
        outputs:
          type === "decisionNode"
            ? ["branch-a", "branch-b"]
            : type === "marketNode"
              ? [...MARKET_OUTPUT_IDS]
              : type === "outputNode" || type === "comparisonNode"
                ? []
                : ["topic.orders"],
        ...(type === "inputNode"
          ? { inputType: inputSubType ?? "manual_trigger" }
          : {}),
        ...(isCrypto
          ? {
              cryptoMonitorConfig: {
                symbol: "BTCUSDT",
                condition: "drops_below" as CryptoConditionOperator,
                targetPrice: 0,
              },
            }
          : {}),
        ...(type === "comparisonNode"
          ? { comparisonConfig: { operator: ">" as ComparisonOperator } }
          : {}),
        ...(type === "marketNode" ? { marketSlug: "" } : {}),
      },
    };

    const nextNodes = [...nodes, node];
    setNodes(nextNodes);
    nodesRef.current = nextNodes;
    setSelectedNodeId(id);

    let nextEdges = edgesRef.current;
    if (connectFrom) {
      // Dragged from a source handle → new node is the target
      // Dragged from a target handle → new node is the source
      const edge: Edge =
        connectFrom.fromHandleType === "source"
          ? {
              id: `edge-${Date.now()}`,
              source: connectFrom.fromNodeId,
              target: id,
              sourceHandle: connectFrom.fromHandleId,
              type: "pulse",
            }
          : {
              id: `edge-${Date.now()}`,
              source: id,
              target: connectFrom.fromNodeId,
              targetHandle: connectFrom.fromHandleId,
              type: "pulse",
            };
      nextEdges = addEdge(edge, edgesRef.current);
      setEdges(nextEdges);
      edgesRef.current = nextEdges;
    }

    persistCurrent(nextNodes, nextEdges);
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      if (
        !connection.source ||
        !connection.target ||
        connection.source === connection.target
      ) {
        return;
      }

      const sourceNode = nodesRef.current.find((node) => node.id === connection.source);
      if (sourceNode?.type === "decisionNode" && !connection.sourceHandle) {
        return;
      }

      const nextEdges = addEdge(
        {
          ...connection,
          id: `edge-${Date.now()}`,
          sourceHandle: connection.sourceHandle ?? undefined,
          targetHandle: connection.targetHandle ?? undefined,
          type: "pulse",
        },
        edgesRef.current,
      );
      setEdges(nextEdges);
      edgesRef.current = nextEdges;
      persistRef.current(nodesRef.current, nextEdges);
    },
    [],
  );

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      if (connectionState.toNode) return;
      if (!connectionState.fromNode) return;

      const clientX = "changedTouches" in event ? (event.changedTouches[0]?.clientX ?? 0) : event.clientX;
      const clientY = "changedTouches" in event ? (event.changedTouches[0]?.clientY ?? 0) : event.clientY;
      const flowPos = screenToFlowPositionRef.current({ x: clientX, y: clientY });

      skipNextPaneClickRef.current = true;

      setContextMenu({
        type: "connection",
        screenX: clientX,
        screenY: clientY,
        flowX: flowPos.x,
        flowY: flowPos.y,
        fromNodeId: connectionState.fromNode.id,
        fromHandleId: connectionState.fromHandle?.id ?? null,
        fromHandleType: (connectionState.fromHandle?.type as "source" | "target") ?? "source",
      });
    },
    [],
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;

  const updateSelectedNode = (patch: Partial<FlowNodeData>) => {
    if (!selectedNodeId) return;
    const nextNodes = nodes.map((node) => {
      if (node.id !== selectedNodeId) return node;
      return {
        ...node,
        data: {
          ...node.data,
          ...patch,
        },
      };
    });
    setNodes(nextNodes);
    updateNodeInternals(selectedNodeId);
    persistCurrent(nextNodes, edges);
  };

  const deleteNodeById = (nodeId: string) => {
    const nextNodes = nodes.filter((node) => node.id !== nodeId);
    const nextEdges = edges.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    );
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    setNodes(nextNodes);
    setEdges(nextEdges);
    persistCurrent(nextNodes, nextEdges);
  };

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    deleteNodeById(selectedNodeId);
  };

  const createBlueprint = () => {
    const next = [
      ...blueprints,
      createStarterBlueprint(`Blueprint ${blueprints.length + 1}`),
    ];
    setBlueprints(next);
    setSelectedBlueprintId(next[next.length - 1]?.id ?? "");
    saveBlueprints(next);
  };

  const handleBlueprintFromChat = useCallback(
    (blueprint: Blueprint) => {
      const next = [...blueprints, blueprint];
      setBlueprints(next);
      setSelectedBlueprintId(blueprint.id);
      saveBlueprints(next);
      requestAnimationFrame(() => {
        fitView({ duration: 260, padding: 0.24 });
      });
    },
    [blueprints, fitView],
  );

  const handleChatAddNode = useCallback(
    (params: AddNodeParams) => {
      const t = params.type as string;
      const nodeType: FlowNodeType =
        t === "input"
          ? "inputNode"
          : t === "decision"
            ? "decisionNode"
            : t === "comparison"
              ? "comparisonNode"
              : t === "market"
                ? "marketNode"
                : "outputNode";

      const inputType = "inputType" in params ? (params.inputType as string) : undefined;
      const isCrypto =
        params.type === "input" &&
        (inputType === "crypto_monitor" || inputType === "crypto_price");

      const node: Node<FlowNodeData, FlowNodeType> = {
        id: params.id,
        type: nodeType,
        position: { x: 0, y: 0 }, // will be auto-laid out
        data: {
          label: params.label,
          inputs: "inputs" in params ? params.inputs : [],
          outputs: "outputs" in params ? params.outputs : [],
          ...("action" in params && params.action ? { action: params.action } : {}),
          ...("inputType" in params && params.inputType
            ? { inputType: params.inputType }
            : {}),
          ...(isCrypto && "cryptoMonitorConfig" in params && params.cryptoMonitorConfig
            ? { cryptoMonitorConfig: params.cryptoMonitorConfig }
            : {}),
          ...("comparisonConfig" in params &&
            params.comparisonConfig &&
            typeof params.comparisonConfig === "object" &&
            "operator" in (params.comparisonConfig as Record<string, unknown>)
            ? { comparisonConfig: params.comparisonConfig as { operator: ComparisonOperator } }
            : {}),
        },
      };

      const nextNodes = [...nodesRef.current, node];
      // Auto-layout all nodes when a new one is added at (0,0)
      const laid = computeLayout(nextNodes, edgesRef.current);
      setNodes(laid);
      nodesRef.current = laid;
      persistRef.current(laid, edgesRef.current);
      requestAnimationFrame(() => {
        fitView({ duration: 260, padding: 0.24 });
      });
    },
    [fitView],
  );

  const handleChatUpdateNode = useCallback((params: UpdateNodeParams) => {
    const nextNodes = nodesRef.current.map((node) => {
      if (node.id !== params.id) return node;
      return {
        ...node,
        data: {
          ...node.data,
          ...(params.label !== undefined ? { label: params.label } : {}),
          ...(params.inputs !== undefined ? { inputs: params.inputs } : {}),
          ...(params.outputs !== undefined ? { outputs: params.outputs } : {}),
          ...(params.action !== undefined ? { action: params.action } : {}),
          ...(params.inputType !== undefined ? { inputType: params.inputType } : {}),
          ...(params.cryptoMonitorConfig !== undefined
            ? { cryptoMonitorConfig: params.cryptoMonitorConfig }
            : {}),
        },
      };
    });
    setNodes(nextNodes);
    nodesRef.current = nextNodes;
    updateNodeInternals(params.id);
    persistRef.current(nextNodes, edgesRef.current);
  }, [updateNodeInternals]);

  const handleChatDeleteNode = useCallback((id: string) => {
    const nextNodes = nodesRef.current.filter((n) => n.id !== id);
    const nextEdges = edgesRef.current.filter(
      (e) => e.source !== id && e.target !== id,
    );
    if (selectedNodeId === id) setSelectedNodeId(null);
    setNodes(nextNodes);
    setEdges(nextEdges);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    persistRef.current(nextNodes, nextEdges);
  }, [selectedNodeId]);

  const handleChatAddEdge = useCallback((params: AddEdgeParams) => {
    const edge: Edge = {
      id: `edge-${params.source}-${params.target}-${Date.now()}`,
      source: params.source,
      target: params.target,
      ...(params.sourceHandle ? { sourceHandle: params.sourceHandle } : {}),
      ...(params.targetHandle ? { targetHandle: params.targetHandle } : {}),
      type: "pulse",
    };
    const nextEdges = addEdge(edge, edgesRef.current);
    setEdges(nextEdges);
    edgesRef.current = nextEdges;
    persistRef.current(nodesRef.current, nextEdges);
  }, []);

  const handleChatDeleteEdge = useCallback(
    (source: string, target: string, sourceHandle?: string) => {
      const nextEdges = edgesRef.current.filter((e) => {
        if (e.source !== source || e.target !== target) return true;
        if (sourceHandle && e.sourceHandle !== sourceHandle) return true;
        return false;
      });
      setEdges(nextEdges);
      edgesRef.current = nextEdges;
      persistRef.current(nodesRef.current, nextEdges);
    },
    [],
  );

  const renameBlueprint = useCallback(
    (name: string) => {
      if (!selectedBlueprint) return;
      const next = blueprints.map((blueprint) =>
        blueprint.id === selectedBlueprint.id
          ? { ...blueprint, name }
          : blueprint,
      );
      setBlueprints(next);
      saveBlueprints(next);
    },
    [selectedBlueprint, blueprints],
  );

  const chatCallbacks = useMemo<BlueprintEditCallbacks>(
    () => ({
      onBlueprintGenerated: handleBlueprintFromChat,
      onAddNode: handleChatAddNode,
      onUpdateNode: handleChatUpdateNode,
      onDeleteNode: handleChatDeleteNode,
      onAddEdge: handleChatAddEdge,
      onDeleteEdge: handleChatDeleteEdge,
      onRenameBlueprint: renameBlueprint,
    }),
    [
      handleBlueprintFromChat,
      handleChatAddNode,
      handleChatUpdateNode,
      handleChatDeleteNode,
      handleChatAddEdge,
      handleChatDeleteEdge,
      renameBlueprint,
    ],
  );

  const confirmDeleteBlueprint = () => {
    if (!deletingBlueprintId) return;
    const next = blueprints.filter((blueprint) => blueprint.id !== deletingBlueprintId);
    setBlueprints(next);
    if (selectedBlueprintId === deletingBlueprintId) {
      setSelectedBlueprintId(next[0]?.id ?? "");
    }
    saveBlueprints(next);
    setDeletingBlueprintId(null);
  };

  const nodeTypes = useMemo(
    () => ({
      inputNode: InputNode,
      outputNode: OutputNode,
      decisionNode: DecisionNode,
      marketNode: MarketNode,
      comparisonNode: ComparisonNode,
      phantom: PhantomNode,
    }),
    [],
  );

  const edgeTypes = useMemo(
    () => ({ pulse: PulseEdge }),
    [],
  );

  // Inject a phantom node + temporary edge while the connection picker is open
  const { phantomNodes, phantomEdges } = useMemo(() => {
    if (!contextMenu || contextMenu.type !== "connection") {
      return { phantomNodes: [] as Node<FlowNodeData>[], phantomEdges: [] as Edge[] };
    }
    const phantomNode: Node<FlowNodeData> = {
      id: PHANTOM_NODE_ID,
      type: "phantom",
      position: { x: contextMenu.flowX, y: contextMenu.flowY },
      data: { label: "", inputs: [], outputs: [] },
      style: { width: 1, height: 1, opacity: 0, pointerEvents: "none" },
    };
    const phantomEdge: Edge =
      contextMenu.fromHandleType === "source"
        ? {
            id: PHANTOM_EDGE_ID,
            source: contextMenu.fromNodeId,
            target: PHANTOM_NODE_ID,
            sourceHandle: contextMenu.fromHandleId,
            type: "pulse",
            animated: true,
            style: { strokeDasharray: "6 3", opacity: 0.4 },
          }
        : {
            id: PHANTOM_EDGE_ID,
            source: PHANTOM_NODE_ID,
            target: contextMenu.fromNodeId,
            targetHandle: contextMenu.fromHandleId,
            type: "pulse",
            animated: true,
            style: { strokeDasharray: "6 3", opacity: 0.4 },
          };
    return { phantomNodes: [phantomNode], phantomEdges: [phantomEdge] };
  }, [contextMenu]);

  return (
    <div className="relative flex min-h-screen bg-[#0a0a0a] text-[#e0e0e0]">
      <aside className="relative z-10 flex w-[260px] flex-col border-r border-white/10 bg-[#0a0a0a]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h1 className="font-[family-name:var(--font-geist-mono)] text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
            <span className="text-[#d4602c]">//</span> Blueprint Studio
          </h1>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-[#d4602c]/60 hover:text-[#d4602c]"
            disabled={!selectedBlueprint || status !== "saved" || dispatching}
            onClick={dispatchBlueprint}
          >
            {dispatching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
          </Button>
        </div>

        {/* New blueprint button */}
        <button
          onClick={createBlueprint}
          className="mx-3 mb-1 flex items-center gap-2 px-2 py-2 font-[family-name:var(--font-geist-mono)] text-[11px] uppercase tracking-[0.15em] text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
        >
          <Plus className="size-4 text-[#d4602c]/60" />
          New blueprint
        </button>

        {/* Blueprint list */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {blueprints.map((blueprint) => {
            const selected = blueprint.id === selectedBlueprintId;
            return (
              <div
                key={blueprint.id}
                onClick={() => {
                  setSelectedBlueprintId(blueprint.id);
                }}
                className={`group relative flex cursor-pointer items-center px-2 py-2 text-sm transition-colors ${
                  selected
                    ? "border-l-2 border-[#d4602c] bg-white/[0.06] pl-[6px] text-white/90"
                    : "text-white/40 hover:bg-white/[0.03] hover:text-white/60"
                }`}
              >
                <span className="flex-1 truncate">{blueprint.name}</span>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className={`ml-1 shrink-0 p-0.5 text-white/30 opacity-0 transition-opacity hover:text-white/80 group-hover:opacity-100 ${selected ? "opacity-100" : ""}`}
                      >
                        <Ellipsis className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className={`w-40 ${DROPDOWN_CONTENT_CLASS}`}>
                      <DropdownMenuItem
                        className={DROPDOWN_ITEM_CLASS}
                        onClick={() => {
                          setSelectedBlueprintId(blueprint.id);
                          setRenamingBlueprintId(blueprint.id);
                        }}
                      >
                        <Pencil className="size-3 text-[#d4602c]" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-white/10" />
                      <DropdownMenuItem
                        className={DROPDOWN_ITEM_DESTRUCTIVE_CLASS}
                        onClick={() => setDeletingBlueprintId(blueprint.id)}
                      >
                        <Trash2 className="size-3" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>

        {/* AI Chat */}
        <div className="mt-auto border-t border-white/10 px-3 py-3">
          <Button
            className="w-full"
            size="sm"
            variant={chatOpen ? "default" : "outline"}
            onClick={() => setChatOpen((prev) => !prev)}
          >
            <MessageCircle className="size-4" />
            {chatOpen ? "Close AI Chat" : "AI Chat"}
          </Button>
        </div>

      </aside>

      <main className="relative z-10 flex min-h-screen flex-1">
        <div className="flex-1">
          <ReactFlow
            nodes={[...displayNodes, ...phantomNodes as Node<FlowNodeData, FlowNodeType>[]]}
            edges={[...edges, ...phantomEdges]}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            proOptions={{ hideAttribution: true }}
            connectionLineType={ConnectionLineType.Step}
            connectionLineStyle={{ strokeDasharray: "6 3", opacity: 0.4, animation: "dashdraw 0.5s linear infinite" }}
            connectionRadius={80}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={(_event, node) => {
              isDraggingNodeRef.current = true;
              wasSelectedBeforeDragRef.current = selectedNodeId === node.id;
            }}
            onNodeDragStop={(_event, node) => {
              setTimeout(() => {
                if (!wasSelectedBeforeDragRef.current) {
                  setSelectedNodeId(null);
                  // Clear React Flow's internal selected state on the dragged node
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.id === node.id ? { ...n, selected: false } : n,
                    ),
                  );
                }
                isDraggingNodeRef.current = false;
              }, 50);
            }}
            onNodeClick={(_event, node) => {
              if (isDraggingNodeRef.current) return;
              setSelectedNodeId(node.id);
              setContextMenu(null);
            }}
            onPaneClick={() => {
              if (skipNextPaneClickRef.current) {
                skipNextPaneClickRef.current = false;
                return;
              }
              setSelectedNodeId(null);
              setContextMenu(null);
            }}
            onDoubleClick={(event) => {
              // Only handle double-clicks on the canvas pane, not on nodes
              const target = event.target as HTMLElement;
              if (target.closest(".react-flow__node")) return;
              const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
              setContextMenu({
                type: "pane",
                screenX: event.clientX,
                screenY: event.clientY,
                flowX: flowPos.x,
                flowY: flowPos.y,
              });
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
              setContextMenu({
                type: "pane",
                screenX: event.clientX,
                screenY: event.clientY,
                flowX: flowPos.x,
                flowY: flowPos.y,
              });
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              setContextMenu({
                type: "node",
                screenX: event.clientX,
                screenY: event.clientY,
                nodeId: node.id,
              });
            }}
            onMoveStart={() => {
              if (skipNextPaneClickRef.current) {
                skipNextPaneClickRef.current = false;
                return;
              }
              // Keep connection picker open during pan — it tracks the viewport
              setContextMenu((cur) =>
                cur?.type === "connection" ? cur : null,
              );
            }}
            panOnScroll
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            snapToGrid
            snapGrid={[GRID_SIZE, GRID_SIZE]}
            fitView
          >
            <Background color="rgba(255,255,255,0.06)" gap={GRID_SIZE} />
            {validationErrors.length > 0 && (
              <Panel position="top-right">
                <div className="space-y-1">
                  {validationErrors.map((error, i) => (
                    <div
                      key={`${error.code}-${error.nodeId ?? ""}-${i}`}
                      className="flex items-center gap-2 border border-[#c45c5c]/30 bg-[#111314] px-3 py-1.5 text-xs text-[#c45c5c]"
                    >
                      <AlertCircle className="size-3.5 shrink-0" />
                      {error.message}
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </ReactFlow>
          {selectedBlueprint && (
            <div className="pointer-events-none absolute left-3 top-3 z-10">
              <div className="pointer-events-auto flex items-center border border-white/10 bg-[#111314] shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                {renamingBlueprintId === selectedBlueprint.id ? (
                  <Input
                    ref={(el) => el?.focus()}
                    className="h-9 w-56 border-none bg-transparent px-4 text-sm text-white/90 shadow-none focus-visible:ring-0"
                    value={selectedBlueprint.name}
                    onChange={(e) => renameBlueprint(e.target.value)}
                    onBlur={() => {
                      requestAnimationFrame(() => setRenamingBlueprintId(null));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setRenamingBlueprintId(null);
                    }}
                  />
                ) : (
                  <button
                    className="cursor-text py-2 pl-4 pr-1 text-sm font-medium text-white/90"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setRenamingBlueprintId(selectedBlueprint.id);
                    }}
                  >
                    {selectedBlueprint.name}
                  </button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-center p-2 text-white/40 transition-colors hover:text-white/80">
                      <ChevronDown className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className={`w-40 ${DROPDOWN_CONTENT_CLASS}`}>
                    <DropdownMenuItem
                      className={DROPDOWN_ITEM_CLASS}
                      onClick={() => setRenamingBlueprintId(selectedBlueprint.id)}
                    >
                      <Pencil className="size-3 text-[#d4602c]" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem
                      className={DROPDOWN_ITEM_DESTRUCTIVE_CLASS}
                      onClick={() => setDeletingBlueprintId(selectedBlueprint.id)}
                    >
                      <Trash2 className="size-3" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}
          {selectedNode && (
            <FloatingNodeToolbar
              node={selectedNode}
              errors={validationErrors}
              onUpdate={updateSelectedNode}
              onDelete={deleteSelectedNode}
            />
          )}
          {contextMenu && contextMenu.type === "connection" ? (
            <ConnectionNodePicker
              menu={contextMenu}
              onAddNode={addNodeByType}
              onClose={() => setContextMenu(null)}
            />
          ) : contextMenu ? (
            <CanvasContextMenu
              menu={contextMenu}
              onAddNode={addNodeByType}
              onDeleteNode={deleteNodeById}
              onClose={() => setContextMenu(null)}
            />
          ) : null}
        </div>
      </main>

      {activeRedprint && (
        <aside className="relative z-10 w-[300px] border-l border-white/10 bg-[#0a0a0a] p-4 overflow-y-auto">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-[family-name:var(--font-geist-mono)] text-xs uppercase tracking-[0.18em] text-white/30">
              Redprint
            </p>
            <span
              className={`px-2 py-0.5 font-[family-name:var(--font-geist-mono)] text-[10px] font-medium uppercase tracking-wider ${
                activeRedprint.status === "running"
                  ? "bg-[#d4602c]/20 text-[#d4602c]"
                  : activeRedprint.status === "completed"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-[#c45c5c]/20 text-[#c45c5c]"
              }`}
            >
              {activeRedprint.status}
            </span>
          </div>

          <p className="mb-3 text-sm text-white/90">{activeRedprint.name}</p>

          <div className="space-y-2">
            {activeRedprint.nodes.map((node) => (
              <div
                key={node.name}
                className="flex items-center justify-between border border-white/10 bg-[#111314] px-3 py-2"
              >
                <div>
                  <p className="text-xs text-white/90">{node.label ?? node.name}</p>
                  <p className="font-[family-name:var(--font-geist-mono)] text-[10px] text-white/30">
                    {node.role} &middot; {node.status}
                  </p>
                  {node.firedAt && (
                    <p className="font-[family-name:var(--font-geist-mono)] text-[10px] text-white/50">
                      {new Date(node.firedAt).toLocaleTimeString()}
                    </p>
                  )}
                </div>
                {node.role === "producer" &&
                  activeRedprint.status === "running" &&
                  (node.inputType === "crypto_monitor" ? (
                    <div className="text-right">
                      <p className="text-[10px] text-[#e8a838]">
                        <TrendingUp className="mr-0.5 inline size-3" />
                        {node.status === "fired" ? "Triggered" : "Monitoring"}
                      </p>
                      {node.lastPrice !== undefined && (
                        <p className="text-[10px] text-white/40">
                          ${node.lastPrice.toLocaleString()}
                        </p>
                      )}
                    </div>
                  ) : (
                    <button
                      className="border border-white/10 px-2 py-1 font-[family-name:var(--font-geist-mono)] text-[10px] uppercase tracking-[0.1em] text-[#d4602c] hover:bg-white/5"
                      onClick={() => pushEvent(node.name)}
                    >
                      <Zap className="inline size-3" /> Push
                    </button>
                  ))}
              </div>
            ))}
          </div>

          {activeRedprint.decision && (
            <div className="mt-3 border border-[#d4602c]/30 bg-[#d4602c]/10 px-3 py-2">
              <p className="font-[family-name:var(--font-geist-mono)] text-[10px] uppercase tracking-wider text-[#d4602c]">
                Decision Result
              </p>
              <p className="text-sm font-semibold text-white/90 capitalize">
                {activeRedprint.decision}
              </p>
            </div>
          )}

          <Button
            className="mt-4 w-full"
            variant="outline"
            onClick={teardownRedprint}
          >
            <Square className="size-4" />
            Teardown
          </Button>
        </aside>
      )}

      <BlueprintChat
        key={selectedBlueprintId}
        blueprintId={selectedBlueprintId}
        currentBlueprint={selectedBlueprint}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        callbacks={chatCallbacks}
      />

      <AlertDialog
        open={!!deletingBlueprintId}
        onOpenChange={(open: boolean) => { if (!open) setDeletingBlueprintId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete blueprint?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the blueprint.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteBlueprint}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function BlueprintStudio() {
  return (
    <ReactFlowProvider>
      <PulseProvider>
        <BlueprintStudioInner />
      </PulseProvider>
    </ReactFlowProvider>
  );
}
