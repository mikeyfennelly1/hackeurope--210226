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
  NodeResizer,
  type OnConnectEnd,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
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
  type WebhookConfig,
  type WebhookMode,
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
  Globe,
  Trash2,
  TrendingUp,
  Timer,
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
import { MarketPicker } from "@/components/market-picker";

const MARKET_OUTPUT_HANDLES_MAP: Record<string, string> = {
  price: "Price",
  volume: "Volume",
  liquidity: "Liquidity",
  spread: "Spread",
  lastTrade: "Last Trade",
};
import { PulseProvider, usePulse } from "@/components/pulse-context";
import { PulseEdge } from "@/components/pulse-edge";
import { computeLayout, GRID_SIZE } from "@/lib/auto-layout";
import { cachedFetch, peekCache } from "@/lib/cached-fetch";

const STORAGE_KEY = "blueprints:v1";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type FlowNodeType = "inputNode" | "outputNode" | "decisionNode" | "marketNode" | "comparisonNode" | "logicGateNode" | "rateLimiterNode" | "webhookNode";

export type FlowNodeData = {
  label: string;
  inputs: string[];
  outputs: string[];
  action?: { verb: Decision; token_id: string; amount: number };
  amountType?: "dollars" | "shares";
  hasError?: boolean;
  inputType?: InputNodeType;
  cryptoMonitorConfig?: CryptoMonitorConfig;
  marketSlug?: string;
  comparisonConfig?: { operator: ComparisonOperator; thresholdA?: number; thresholdB?: number };
  marketOutcome?: MarketOutcome;
  marketIndex?: number;
  /** Transient — populated by MarketNode on fetch, not persisted */
  marketQuestions?: string[];
  /** Transient — cached from MarketPicker selection or MarketNode fetch */
  marketTitle?: string;
  marketImage?: string;
  /** Transient — token IDs from MarketPicker for output nodes */
  marketYesTokenId?: string;
  marketNoTokenId?: string;
  logicGateConfig?: { gateType: "and" | "or" };
  rateLimiterConfig?: { maxEvents: number; windowMs: number };
  webhookConfig?: WebhookConfig;
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
      label: "Place Order",
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
  if (type === "logic_gate") return "logicGateNode";
  if (type === "rate_limiter") return "rateLimiterNode";
  if (type === "webhook") return "webhookNode";
  return "decisionNode";
}

function toBlueprintNodeType(
  type: FlowNodeType,
): Blueprint["nodes"][number]["type"] {
  if (type === "inputNode") return "input";
  if (type === "outputNode") return "output";
  if (type === "marketNode") return "market";
  if (type === "comparisonNode") return "comparison";
  if (type === "logicGateNode") return "logic_gate";
  if (type === "rateLimiterNode") return "rate_limiter";
  if (type === "webhookNode") return "webhook";
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
      amountType: node.amountType,
      inputType: node.inputType,
      cryptoMonitorConfig: node.cryptoMonitorConfig,
      comparisonConfig: node.comparisonConfig,
      marketSlug: node.marketSlug,
      marketOutcome: node.marketOutcome,
      marketIndex: node.marketIndex,
      logicGateConfig: node.logicGateConfig,
      rateLimiterConfig: node.rateLimiterConfig,
      webhookConfig: node.webhookConfig,
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
      ...(node.data.amountType ? { amountType: node.data.amountType } : {}),
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
      ...(node.data.marketIndex != null
        ? { marketIndex: node.data.marketIndex }
        : {}),
      ...(node.data.logicGateConfig
        ? { logicGateConfig: node.data.logicGateConfig }
        : {}),
      ...(node.data.rateLimiterConfig
        ? { rateLimiterConfig: node.data.rateLimiterConfig }
        : {}),
      ...(node.data.webhookConfig
        ? { webhookConfig: node.data.webhookConfig }
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
  if (data.inputType === "crypto_price") {
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

type OrderPricePoint = { t: number; p: number };

function OrderSparkline({ data, width, height }: { data: OrderPricePoint[]; width: number; height: number }) {
  if (data.length < 2) return null;

  const prices = data.map((d) => d.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 0.01;

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * w;
    const y = pad + h - ((d.p - min) / range) * h;
    return `${x},${y}`;
  });

  const lastPrice = prices[prices.length - 1]!;
  const firstPrice = prices[0]!;
  const trending = lastPrice >= firstPrice;

  const fillPoints = [
    `${pad},${pad + h}`,
    ...points,
    `${pad + w},${pad + h}`,
  ].join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`order-spark-${trending}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={trending ? "#d4602c" : "#ffffff"} stopOpacity="0.15" />
          <stop offset="100%" stopColor={trending ? "#d4602c" : "#ffffff"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={fillPoints}
        fill={`url(#order-spark-${trending})`}
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={trending ? "#d4602c" : "rgba(255,255,255,0.4)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={pad + w}
        cy={pad + h - ((lastPrice - min) / range) * h}
        r="2"
        fill={trending ? "#d4602c" : "rgba(255,255,255,0.6)"}
      />
    </svg>
  );
}

type OutputGammaMarket = {
  question: string;
  outcomes: string | string[];
  outcomePrices: string | string[];
  clobTokenIds: string | string[];
  active: boolean;
  closed: boolean;
};

type OutputGammaEvent = {
  title: string;
  image: string;
  markets: OutputGammaMarket[];
};

type OutputFetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; event: OutputGammaEvent };

function outputParseMarket(m: OutputGammaMarket): { yesPrice: number; noPrice: number; yesTokenId: string; noTokenId: string } {
  const outcomes = typeof m.outcomes === "string" ? (JSON.parse(m.outcomes) as string[]) : m.outcomes;
  const prices = typeof m.outcomePrices === "string" ? (JSON.parse(m.outcomePrices) as string[]) : m.outcomePrices;
  const tokenIds = typeof m.clobTokenIds === "string" ? (JSON.parse(m.clobTokenIds) as string[]) : m.clobTokenIds;
  const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  const noIdx = yesIdx === 0 ? 1 : 0;
  return {
    yesPrice: parseFloat(prices[yesIdx >= 0 ? yesIdx : 0] ?? "0"),
    noPrice: parseFloat(prices[noIdx] ?? "0"),
    yesTokenId: tokenIds[yesIdx >= 0 ? yesIdx : 0] ?? "",
    noTokenId: tokenIds[noIdx] ?? "",
  };
}

function OutputNode({ id, data, selected }: NodeProps<Node<FlowNodeData, "outputNode">>) {
  const { setNodes } = useReactFlow();
  const verb = data.action?.verb ?? "buy";
  const amount = data.action?.amount ?? 0;
  const amountType = data.amountType ?? "dollars";
  const outcome = data.marketOutcome ?? "yes";
  const marketIndex = data.marketIndex ?? 0;
  const hasMarket = !!data.marketSlug;

  const [fetchState, setFetchState] = useState<OutputFetchState>({ status: "idle" });
  const [history, setHistory] = useState<OrderPricePoint[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchHistory = useCallback(async (tokenId: string) => {
    try {
      const histData = await cachedFetch<{ history: OrderPricePoint[] }>(
        `/api/polymarket?tokenId=${encodeURIComponent(tokenId)}&interval=1w&fidelity=60`,
      );
      return histData.history ?? [];
    } catch {
      // non-critical
    }
    return [];
  }, []);

  // Fetch event data when marketSlug changes
  useEffect(() => {
    const slug = data.marketSlug?.trim();
    if (!slug) {
      setFetchState({ status: "idle" });
      return;
    }
    const slugUrl = `/api/polymarket?slug=${encodeURIComponent(slug)}`;
    const isCached = peekCache(slugUrl);

    const doFetch = async () => {
      if (!isCached) setFetchState({ status: "loading" });
      try {
        const events = await cachedFetch<OutputGammaEvent[]>(slugUrl);
        if (!events.length || !events[0]!.markets.length) {
          setFetchState({ status: "error", message: "NO MARKET FOUND" });
          return;
        }
        const event = events[0]!;
        const activeMs = event.markets.filter((m) => m.active && !m.closed);
        const ms = activeMs.length > 0 ? activeMs : event.markets;
        const mIdx = data.marketIndex ?? 0;
        const m = ms[mIdx] ?? ms[0]!;
        const mp = outputParseMarket(m);

        const hist = await fetchHistory(mp.yesTokenId);
        setHistory(hist);
        setFetchState({ status: "loaded", event });

        // Expose sub-market questions to toolbar
        if (ms.length > 1) {
          const questions = ms.map((mk) => mk.question);
          setNodes((nds) =>
            nds.map((n) =>
              n.id === id ? { ...n, data: { ...n.data, marketQuestions: questions } } : n,
            ),
          );
        }

        // Update token IDs for the selected sub-market
        const selOutcome = data.marketOutcome ?? "yes";
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    marketYesTokenId: mp.yesTokenId,
                    marketNoTokenId: mp.noTokenId,
                    action: {
                      verb: (n.data as FlowNodeData).action?.verb ?? "buy",
                      token_id: selOutcome === "yes" ? mp.yesTokenId : mp.noTokenId,
                      amount: (n.data as FlowNodeData).action?.amount ?? 0,
                    },
                  },
                }
              : n,
          ),
        );
      } catch (err) {
        setFetchState({
          status: "error",
          message: err instanceof Error ? err.message.toUpperCase() : "FETCH FAILED",
        });
      }
    };

    // Skip debounce when cached data exists (remount case)
    if (isCached) {
      doFetch();
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(doFetch, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.marketSlug]);

  // Re-fetch history + update tokens when marketIndex changes
  useEffect(() => {
    if (fetchState.status !== "loaded") return;
    const activeMs = fetchState.event.markets.filter((m) => m.active && !m.closed);
    const ms = activeMs.length > 0 ? activeMs : fetchState.event.markets;
    const m = ms[marketIndex] ?? ms[0];
    if (!m) return;

    const mp = outputParseMarket(m);
    const selOutcome = data.marketOutcome ?? "yes";
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                marketYesTokenId: mp.yesTokenId,
                marketNoTokenId: mp.noTokenId,
                action: {
                  verb: (n.data as FlowNodeData).action?.verb ?? "buy",
                  token_id: selOutcome === "yes" ? mp.yesTokenId : mp.noTokenId,
                  amount: (n.data as FlowNodeData).action?.amount ?? 0,
                },
              },
            }
          : n,
      ),
    );

    let cancelled = false;
    fetchHistory(mp.yesTokenId).then((hist) => {
      if (!cancelled) setHistory(hist);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketIndex]);

  // Derive selected sub-market and prices
  const activeMarkets = fetchState.status === "loaded"
    ? fetchState.event.markets.filter((m) => m.active && !m.closed)
    : [];
  const allMarkets = activeMarkets.length > 0 ? activeMarkets : (fetchState.status === "loaded" ? fetchState.event.markets : []);
  const selectedMarket = allMarkets[marketIndex] ?? allMarkets[0] ?? null;
  const parsedMarket = selectedMarket ? outputParseMarket(selectedMarket) : null;
  const price = parsedMarket ? (outcome === "yes" ? parsedMarket.yesPrice : parsedMarket.noPrice) : 0;
  const marketQuestion = selectedMarket?.question;

  // Conversion math
  let primaryLabel = "";
  let convertedLabel = "";
  if (amount > 0 && price > 0) {
    if (amountType === "dollars") {
      const shares = Math.round(amount / price);
      primaryLabel = `$${amount.toLocaleString()}`;
      convertedLabel = `\u2248 ${shares.toLocaleString()} shares`;
    } else {
      const dollars = (amount * price).toFixed(2);
      primaryLabel = `${amount.toLocaleString()} shares`;
      convertedLabel = `\u2248 $${dollars}`;
    }
  } else if (amount > 0) {
    primaryLabel = amountType === "dollars" ? `$${amount.toLocaleString()}` : `${amount.toLocaleString()} shares`;
  }

  return (
    <div className="relative w-[280px] border border-white/20 bg-[#111314] font-[family-name:var(--font-geist-mono)] shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
      {/* Corner brackets */}
      <div className={`absolute h-3 w-3 border-l border-t border-[#d4602c] transition-all ${selected ? "-left-1.5 -top-1.5" : "-left-px -top-px"}`} />
      <div className={`absolute h-3 w-3 border-r border-t border-[#d4602c] transition-all ${selected ? "-right-1.5 -top-1.5" : "-right-px -top-px"}`} />
      <div className={`absolute h-3 w-3 border-b border-l border-[#d4602c] transition-all ${selected ? "-bottom-1.5 -left-1.5" : "-bottom-px -left-px"}`} />
      <div className={`absolute h-3 w-3 border-b border-r border-[#d4602c] transition-all ${selected ? "-bottom-1.5 -right-1.5" : "-bottom-px -right-px"}`} />

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
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[#d4602c]"><ArrowRight className="size-3.5" /></span>
            <span className="text-[9px] font-medium uppercase tracking-[0.25em] text-white/40">
              Place Order
            </span>
          </div>
          {hasMarket && amount > 0 && (
            <span className={`text-[9px] font-bold uppercase tracking-[0.2em] ${verb === "buy" ? "text-emerald-400/80" : "text-red-400/80"}`}>
              {verb}
            </span>
          )}
        </div>

        {!hasMarket ? (
          <div className="px-3 py-6 text-center">
            <div className="mb-2 text-[9px] uppercase tracking-[0.3em] text-white/20">
              AWAITING CONFIG
            </div>
            <div className="mx-auto w-16 border-t border-dashed border-white/10" />
          </div>
        ) : fetchState.status === "loading" ? (
          <div className="space-y-0">
            <div className="border-b border-white/10 px-3 py-2.5">
              <div className="h-3.5 w-full animate-pulse rounded bg-white/10" />
            </div>
            <div className="border-b border-white/10 px-3 py-2">
              <div className="h-14 w-full animate-pulse rounded bg-white/[0.05]" />
            </div>
            <div className="grid grid-cols-2 border-b border-white/10">
              <div className="border-r border-white/10 px-3 py-2">
                <div className="h-3 w-10 animate-pulse rounded bg-white/10" />
              </div>
              <div className="px-3 py-2">
                <div className="h-3 w-16 animate-pulse rounded bg-white/10" />
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Market */}
            <div className="flex items-center gap-2.5 border-b border-white/10 px-3 py-2.5">
              {(fetchState.status === "loaded" ? fetchState.event.image : data.marketImage) && (
                <img
                  src={(fetchState.status === "loaded" ? fetchState.event.image : data.marketImage) ?? ""}
                  alt=""
                  className="size-7 shrink-0 rounded-sm object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium leading-tight text-white/80">
                  {marketQuestion ?? (fetchState.status === "loaded" ? fetchState.event.title : data.marketTitle)}
                </div>
                <span className={`mt-1 inline-block border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] ${
                  outcome === "yes"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-red-500/30 bg-red-500/10 text-red-400"
                }`}>
                  {outcome}
                </span>
              </div>
            </div>

            {/* Sparkline */}
            {history.length > 1 && (
              <div className="border-b border-white/10 px-3 py-2">
                <OrderSparkline data={history} width={254} height={56} />
              </div>
            )}

            {/* Amount + conversion */}
            {amount > 0 && (
              <div className="border-b border-white/10 px-3 py-2">
                <div className="text-[13px] font-bold text-white/80">
                  {primaryLabel}
                </div>
                {convertedLabel && (
                  <div className="mt-0.5 text-[9px] tracking-[0.1em] text-white/30">
                    {convertedLabel}
                  </div>
                )}
              </div>
            )}

            {/* Side + price stats */}
            <div className="grid grid-cols-2 border-b border-white/10">
              <div className="border-r border-white/10 px-3 py-2">
                <div className="text-[8px] uppercase tracking-[0.3em] text-white/25">Side</div>
                <div className={`text-[13px] font-bold ${verb === "buy" ? "text-emerald-400/80" : "text-red-400/80"}`}>
                  {verb.toUpperCase()}
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[8px] uppercase tracking-[0.3em] text-white/25">Price</div>
                <div className="text-[13px] font-bold text-white/80">
                  {fetchState.status === "loaded" ? `${Math.round(price * 100)}\u00a2` : "\u2014"}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Scanlines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 3px)",
        }}
      />

      <Handle type="target" position={Position.Left} />
    </div>
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

function formatComparisonValue(value: number, sourceType: string | undefined, sourceHandle: string | null | undefined): string {
  if (sourceType === "marketNode") {
    // Price/lastTrade handles are probabilities (0-1) shown as cents
    if (!sourceHandle || sourceHandle === "price" || sourceHandle === "lastTrade") {
      return `${Math.round(value * 100)}\u00a2`;
    }
    // Spread is a small dollar amount
    if (sourceHandle === "spread") {
      return `$${value.toFixed(3)}`;
    }
    // Volume/liquidity are large dollar amounts
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  // crypto / default — dollar format
  if (value >= 1000) return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(6)}`;
}

const SEEN_PULSES_MAX = 500;
function pruneSeen(seen: Set<number>) {
  if (seen.size <= SEEN_PULSES_MAX) return;
  const keep = SEEN_PULSES_MAX / 2;
  let i = 0;
  for (const v of seen) {
    if (i++ < seen.size - keep) seen.delete(v);
  }
}

function ComparisonNode({ id, data, selected }: NodeProps<Node<FlowNodeData, "comparisonNode">>) {
  const op = data.comparisonConfig?.operator ?? ">";
  const thA = data.comparisonConfig?.thresholdA;
  const thB = data.comparisonConfig?.thresholdB;

  const edges = useStore((s) => s.edges);
  const { getNode } = useReactFlow();
  const { pulsingNodes, pulseNode, nodeValues, setNodeValue } = usePulse();

  // Find connected source nodes for input-a and input-b
  const edgeA = edges.find((e) => e.target === id && e.targetHandle === "input-a");
  const edgeB = edges.find((e) => e.target === id && e.targetHandle === "input-b");
  const sourceNodeA = edgeA ? getNode(edgeA.source) : undefined;
  const sourceNodeB = edgeB ? getNode(edgeB.source) : undefined;

  // Derive names — include source handle label for market nodes
  const handleLabelA = edgeA?.sourceHandle && sourceNodeA?.type === "marketNode"
    ? MARKET_OUTPUT_HANDLES_MAP[edgeA.sourceHandle]
    : undefined;
  const handleLabelB = edgeB?.sourceHandle && sourceNodeB?.type === "marketNode"
    ? MARKET_OUTPUT_HANDLES_MAP[edgeB.sourceHandle]
    : undefined;
  const nameA = sourceNodeA
    ? `${sourceNodeA.data.label as string}${handleLabelA ? ` · ${handleLabelA}` : ""}`
    : (thA !== undefined ? `$${thA.toLocaleString()}` : "A");
  const nameB = sourceNodeB
    ? `${sourceNodeB.data.label as string}${handleLabelB ? ` · ${handleLabelB}` : ""}`
    : (thB !== undefined ? `$${thB.toLocaleString()}` : "B");
  // Live value from connected node (handle-specific for market nodes), or static threshold
  const valueKeyA = sourceNodeA
    ? (edgeA?.sourceHandle ? `${sourceNodeA.id}:${edgeA.sourceHandle}` : sourceNodeA.id)
    : undefined;
  const valueKeyB = sourceNodeB
    ? (edgeB?.sourceHandle ? `${sourceNodeB.id}:${edgeB.sourceHandle}` : sourceNodeB.id)
    : undefined;
  const displayValueA = valueKeyA ? nodeValues[valueKeyA] : thA;
  const displayValueB = valueKeyB ? nodeValues[valueKeyB] : thB;

  // Evaluate the comparison condition
  const conditionMet = useMemo(() => {
    if (displayValueA === undefined || displayValueB === undefined) return false;
    switch (op) {
      case ">": return displayValueA > displayValueB;
      case "<": return displayValueA < displayValueB;
      case ">=": return displayValueA >= displayValueB;
      case "<=": return displayValueA <= displayValueB;
      case "==": return displayValueA === displayValueB;
      case "!=": return displayValueA !== displayValueB;
      default: return false;
    }
  }, [displayValueA, displayValueB, op]);

  // Publish boolean result so downstream nodes (logic gates) can read it
  useEffect(() => {
    setNodeValue(id, conditionMet ? 1 : 0);
  }, [conditionMet, id, setNodeValue]);

  // Track source pulse correlation IDs to fire exactly once per original event.
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenPulsesRef = useRef(new Set<number>());
  const pendingCidsRef = useRef(new Set<number>());
  const [opFlash, setOpFlash] = useState<"pass" | "fail" | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sourceIds = [sourceNodeA?.id, sourceNodeB?.id].filter(Boolean) as string[];

    let hasNew = false;
    for (const sid of sourceIds) {
      const entries = pulsingNodes.get(sid);
      if (!entries) continue;
      for (const entry of entries) {
        if (!seenPulsesRef.current.has(entry.correlationId)) {
          seenPulsesRef.current.add(entry.correlationId);
          pendingCidsRef.current.add(entry.correlationId);
          hasNew = true;
        }
      }
    }
    pruneSeen(seenPulsesRef.current);

    if (!hasNew) return;

    // Flash the operator background just before the pill arrives (pill takes 500ms)
    const result = conditionMet ? "pass" as const : "fail" as const;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => {
      setOpFlash(result);
      flashTimerRef.current = setTimeout(() => setOpFlash(null), 400);
    }, 400);

    // Only cascade downstream when condition is met
    if (conditionMet && !pulseTimerRef.current) {
      pulseTimerRef.current = setTimeout(() => {
        pulseTimerRef.current = null;
        for (const cid of pendingCidsRef.current) {
          pulseNode(id, cid);
        }
        pendingCidsRef.current.clear();
      }, 500);
    }
  }, [pulsingNodes, sourceNodeA?.id, sourceNodeB?.id, pulseNode, id, conditionMet]);

  useEffect(() => () => {
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

  return (
    <div className="relative min-w-[260px] border border-white/20 bg-[#111314] font-[family-name:var(--font-geist-mono)] shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
      {/* Corner brackets */}
      <div className={`absolute h-3 w-3 border-l border-t border-[#d4602c] transition-all ${selected ? "-left-1.5 -top-1.5" : "-left-px -top-px"}`} />
      <div className={`absolute h-3 w-3 border-r border-t border-[#d4602c] transition-all ${selected ? "-right-1.5 -top-1.5" : "-right-px -top-px"}`} />
      <div className={`absolute h-3 w-3 border-b border-l border-[#d4602c] transition-all ${selected ? "-bottom-1.5 -left-1.5" : "-bottom-px -left-px"}`} />
      <div className={`absolute h-3 w-3 border-b border-r border-[#d4602c] transition-all ${selected ? "-bottom-1.5 -right-1.5" : "-bottom-px -right-px"}`} />

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
          <span className="text-[#d4602c]"><Scale className="size-3.5" /></span>
          <p className="text-[9px] font-medium uppercase tracking-[0.25em] text-white/40">
            Comparison
          </p>
        </div>

        {/* Comparison display: Name A + Value | Operator | Name B + Value */}
        <div className="flex items-stretch border-b border-white/10">
          {/* Left side (A) */}
          <div className="relative flex-1 border-r border-white/10 px-3 py-3">
            <Handle type="target" position={Position.Left} id="input-a" style={{ top: "50%" }} />
            <div className="truncate text-[11px] font-medium text-white/70">
              {nameA}
            </div>
            {displayValueA !== undefined && (
              <div className="mt-0.5 text-[13px] font-bold text-[#d4602c]">
                {sourceNodeA
                  ? formatComparisonValue(displayValueA, sourceNodeA.type, edgeA?.sourceHandle)
                  : `$${displayValueA.toLocaleString()}`}
              </div>
            )}
          </div>

          {/* Operator */}
          <div
            className="flex items-center justify-center px-3 transition-colors duration-500"
            style={{
              backgroundColor: opFlash
                ? opFlash === "pass"
                  ? "rgba(74,222,128,0.12)"
                  : "rgba(239,68,68,0.10)"
                : undefined,
            }}
          >
            <span className="text-[22px] font-bold leading-none text-[#d4602c]">{op}</span>
          </div>

          {/* Right side (B) */}
          <div className="relative flex-1 border-l border-white/10 px-3 py-3">
            <Handle type="target" position={Position.Left} id="input-b" style={{ top: "50%", left: "auto", right: "-4px" }} />
            <div className="truncate text-right text-[11px] font-medium text-white/70">
              {nameB}
            </div>
            {displayValueB !== undefined && (
              <div className="mt-0.5 text-right text-[13px] font-bold text-[#d4602c]">
                {sourceNodeB
                  ? formatComparisonValue(displayValueB, sourceNodeB.type, edgeB?.sourceHandle)
                  : `$${displayValueB.toLocaleString()}`}
              </div>
            )}
          </div>
        </div>

        {/* Output */}
        <div className="relative flex items-center justify-between px-3 py-1.5">
          <span className="text-[9px] uppercase tracking-[0.15em] text-white/30">RESULT</span>
          <span className="text-[9px] text-[#d4602c]/60">bool</span>
          <Handle type="source" position={Position.Right} />
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

function describeComparisonSource(
  sourceNode: Node,
  allEdges: Edge[],
  getNode: (id: string) => Node | undefined,
): string {
  const cfg = (sourceNode.data as FlowNodeData).comparisonConfig;
  const op = cfg?.operator ?? ">";

  const edgeA = allEdges.find((e: Edge) => e.target === sourceNode.id && e.targetHandle === "input-a");
  const edgeB = allEdges.find((e: Edge) => e.target === sourceNode.id && e.targetHandle === "input-b");
  const srcA = edgeA ? getNode(edgeA.source) : undefined;
  const srcB = edgeB ? getNode(edgeB.source) : undefined;

  const handleLabelA = edgeA?.sourceHandle && srcA?.type === "marketNode"
    ? MARKET_OUTPUT_HANDLES_MAP[edgeA.sourceHandle] : undefined;
  const handleLabelB = edgeB?.sourceHandle && srcB?.type === "marketNode"
    ? MARKET_OUTPUT_HANDLES_MAP[edgeB.sourceHandle] : undefined;

  const nameA = srcA
    ? `${srcA.data.label as string}${handleLabelA ? ` ${handleLabelA}` : ""}`
    : (cfg?.thresholdA !== undefined ? `$${cfg.thresholdA.toLocaleString()}` : "A");
  const nameB = srcB
    ? `${srcB.data.label as string}${handleLabelB ? ` ${handleLabelB}` : ""}`
    : (cfg?.thresholdB !== undefined ? `$${cfg.thresholdB.toLocaleString()}` : "B");

  return `${nameA} ${op} ${nameB}`;
}

function LogicGateNode({ id, data, selected }: NodeProps<Node<FlowNodeData, "logicGateNode">>) {
  const gateType = data.logicGateConfig?.gateType ?? "and";
  const inputHandles = data.inputs;

  const edges = useStore((s) => s.edges);
  const { getNode } = useReactFlow();
  const { pulsingNodes, pulseNode, nodeValues, setNodeValue } = usePulse();

  // Build per-input info from edges
  const inputSlots = useMemo(() => {
    return inputHandles.map((handleId) => {
      const edge = edges.find((e) => e.target === id && e.targetHandle === handleId);
      const sourceNode = edge ? getNode(edge.source) : undefined;
      const label = sourceNode
        ? sourceNode.type === "comparisonNode"
          ? describeComparisonSource(sourceNode, edges, getNode)
          : (sourceNode.data.label as string)
        : undefined;
      const value = sourceNode ? (nodeValues[sourceNode.id] ?? undefined) : undefined;
      return { handleId, sourceNodeId: sourceNode?.id, label, value, connected: !!sourceNode };
    });
  }, [inputHandles, edges, id, getNode, nodeValues]);

  const connectedSlots = inputSlots.filter((s) => s.connected);

  // Evaluate gate
  const result = useMemo(() => {
    if (connectedSlots.length === 0) return undefined;
    const booleans = connectedSlots.map((s) => s.value !== undefined ? !!s.value : false);
    if (gateType === "and") return booleans.every(Boolean);
    return booleans.some(Boolean);
  }, [connectedSlots, gateType]);

  // Publish result
  useEffect(() => {
    if (result !== undefined) {
      setNodeValue(id, result ? 1 : 0);
    }
  }, [result, id, setNodeValue]);

  // Per-row flash state
  const [rowFlash, setRowFlash] = useState<Record<string, "pass" | "fail">>({});
  const rowFlashTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Pulse cascade
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenPulsesRef = useRef(new Set<number>());
  const pendingCidsRef = useRef(new Set<number>());

  useEffect(() => {
    let hasNew = false;
    for (const slot of connectedSlots) {
      const sid = slot.sourceNodeId;
      if (!sid) continue;
      const entries = pulsingNodes.get(sid);
      if (!entries) continue;
      let slotHasNew = false;
      for (const entry of entries) {
        if (!seenPulsesRef.current.has(entry.correlationId)) {
          seenPulsesRef.current.add(entry.correlationId);
          pendingCidsRef.current.add(entry.correlationId);
          hasNew = true;
          slotHasNew = true;
        }
      }
      if (slotHasNew) {
        const flashType = slot.value ? "pass" as const : "fail" as const;
        const handleId = slot.handleId;
        if (rowFlashTimersRef.current[handleId]) clearTimeout(rowFlashTimersRef.current[handleId]);
        rowFlashTimersRef.current[handleId] = setTimeout(() => {
          setRowFlash((prev) => ({ ...prev, [handleId]: flashType }));
          rowFlashTimersRef.current[handleId] = setTimeout(() => {
            setRowFlash((prev) => {
              const next = { ...prev };
              delete next[handleId];
              return next;
            });
            delete rowFlashTimersRef.current[handleId];
          }, 400);
        }, 400);
      }
    }
    pruneSeen(seenPulsesRef.current);
    if (!hasNew) return;
    if (result && !pulseTimerRef.current) {
      pulseTimerRef.current = setTimeout(() => {
        pulseTimerRef.current = null;
        for (const cid of pendingCidsRef.current) {
          pulseNode(id, cid);
        }
        pendingCidsRef.current.clear();
      }, 500);
    }
  }, [pulsingNodes, connectedSlots, pulseNode, id, result]);

  useEffect(() => () => {
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    for (const t of Object.values(rowFlashTimersRef.current)) clearTimeout(t);
  }, []);

  return (
    <div className="relative min-w-[140px] border border-white/20 bg-[#111314] font-[family-name:var(--font-geist-mono)] shadow-[0_12px_40px_rgba(0,0,0,0.6)]" style={{ width: "100%", height: "100%" }}>
      <NodeResizer
        minWidth={140}
        minHeight={50}
        isVisible={!!selected}
        lineClassName="!border-[#d4602c]/40"
        handleClassName="!w-2 !h-2 !bg-[#d4602c] !border-[#d4602c]"
      />
      {/* Corner brackets */}
      <div className={`absolute h-2.5 w-2.5 border-l border-t border-[#d4602c] transition-all ${selected ? "-left-1 -top-1" : "-left-px -top-px"}`} />
      <div className={`absolute h-2.5 w-2.5 border-r border-t border-[#d4602c] transition-all ${selected ? "-right-1 -top-1" : "-right-px -top-px"}`} />
      <div className={`absolute h-2.5 w-2.5 border-b border-l border-[#d4602c] transition-all ${selected ? "-bottom-1 -left-1" : "-bottom-px -left-px"}`} />
      <div className={`absolute h-2.5 w-2.5 border-b border-r border-[#d4602c] transition-all ${selected ? "-bottom-1 -right-1" : "-bottom-px -right-px"}`} />

      <div className="relative">
        {/* Header: gate type label + result badge + output handle */}
        <div className="relative flex items-center justify-between border-b border-white/10 px-2.5 py-1.5">
          <span className="text-[11px] font-bold tracking-[0.2em] text-[#d4602c]">
            {gateType.toUpperCase()}
          </span>
          {result !== undefined ? (
            <span
              className={`rounded-sm px-1 py-px text-[8px] font-bold uppercase tracking-[0.1em] ${
                result
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-red-500/10 text-red-400/60"
              }`}
            >
              {result ? "TRUE" : "FALSE"}
            </span>
          ) : (
            <span className="text-[8px] tracking-[0.1em] text-white/15">--</span>
          )}
          <Handle type="source" position={Position.Right} />
        </div>

        {/* Input rows */}
        {inputSlots.map((slot) => (
          <div
            key={slot.handleId}
            className={`relative flex items-center gap-1.5 border-b border-white/5 px-2.5 py-[5px] transition-colors duration-500 ${
              !slot.connected ? "opacity-40" : ""
            }`}
            style={{
              backgroundColor: rowFlash[slot.handleId]
                ? rowFlash[slot.handleId] === "pass"
                  ? "rgba(74,222,128,0.12)"
                  : "rgba(239,68,68,0.10)"
                : undefined,
            }}
          >
            <Handle
              type="target"
              position={Position.Left}
              id={slot.handleId}
            />
            {slot.connected ? (
              <>
                <span className="flex-1 truncate text-[10px] text-white/50">{slot.label}</span>
                {slot.value !== undefined && (
                  <span
                    className={`text-[9px] font-bold ${
                      slot.value ? "text-emerald-400/70" : "text-red-400/50"
                    }`}
                  >
                    {slot.value ? "1" : "0"}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[9px] text-white/20">&mdash;</span>
            )}
          </div>
        ))}

      </div>
    </div>
  );
}

function RateLimiterNode({ id, data, selected }: NodeProps<Node<FlowNodeData, "rateLimiterNode">>) {
  const maxEvents = data.rateLimiterConfig?.maxEvents ?? 5;
  const windowMs = data.rateLimiterConfig?.windowMs ?? 60000;

  const { pulsingNodes, pulseNode, setNodeValue } = usePulse();
  const edges = useStore((s) => s.edges);

  // Sliding window of timestamps
  const windowRef = useRef<number[]>([]);
  const [currentCount, setCurrentCount] = useState(0);
  const [status, setStatus] = useState<"pass" | "blocked">("pass");

  // Pulse cascade
  const seenPulsesRef = useRef(new Set<number>());
  const pendingCidsRef = useRef(new Set<number>());
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Find upstream source node IDs
  const sourceIds = useMemo(() => {
    return edges.filter((e) => e.target === id).map((e) => e.source);
  }, [edges, id]);

  // Handle incoming pulses
  useEffect(() => {
    let hasNew = false;
    for (const sid of sourceIds) {
      const entries = pulsingNodes.get(sid);
      if (!entries) continue;
      for (const entry of entries) {
        if (!seenPulsesRef.current.has(entry.correlationId)) {
          seenPulsesRef.current.add(entry.correlationId);
          pendingCidsRef.current.add(entry.correlationId);
          hasNew = true;
        }
      }
    }
    pruneSeen(seenPulsesRef.current);
    if (!hasNew) return;

    const now = Date.now();
    // Clean expired
    windowRef.current = windowRef.current.filter((t) => now - t < windowMs);

    if (windowRef.current.length < maxEvents) {
      windowRef.current.push(now);
      setCurrentCount(windowRef.current.length);
      setStatus("pass");
      setNodeValue(`${id}:pass`, 1);
      setNodeValue(`${id}:blocked`, 0);
      if (!pulseTimerRef.current) {
        pulseTimerRef.current = setTimeout(() => {
          pulseTimerRef.current = null;
          for (const cid of pendingCidsRef.current) {
            pulseNode(id, cid);
          }
          pendingCidsRef.current.clear();
        }, 500);
      }
    } else {
      setCurrentCount(windowRef.current.length);
      setStatus("blocked");
      setNodeValue(`${id}:pass`, 0);
      setNodeValue(`${id}:blocked`, 1);
      if (!pulseTimerRef.current) {
        pulseTimerRef.current = setTimeout(() => {
          pulseTimerRef.current = null;
          for (const cid of pendingCidsRef.current) {
            pulseNode(id, cid);
          }
          pendingCidsRef.current.clear();
        }, 100);
      }
    }
  }, [pulsingNodes, sourceIds, pulseNode, id, maxEvents, windowMs, setNodeValue]);

  // Periodic cleanup to drain the bar
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      windowRef.current = windowRef.current.filter((t) => now - t < windowMs);
      const count = windowRef.current.length;
      setCurrentCount(count);
      if (count < maxEvents) setStatus("pass");
    }, 200);
    return () => clearInterval(interval);
  }, [windowMs, maxEvents]);

  useEffect(() => () => {
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
  }, []);

  const fillPct = Math.min(currentCount / maxEvents, 1);

  const windowLabel = windowMs >= 60000
    ? `${windowMs / 60000}m`
    : `${windowMs / 1000}s`;

  return (
    <div className="relative min-w-[160px] border border-white/20 bg-[#111314] font-[family-name:var(--font-geist-mono)] shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
      {/* Corner brackets */}
      <div className={`absolute h-3 w-3 border-l border-t border-[#d4602c] transition-all ${selected ? "-left-1.5 -top-1.5" : "-left-px -top-px"}`} />
      <div className={`absolute h-3 w-3 border-r border-t border-[#d4602c] transition-all ${selected ? "-right-1.5 -top-1.5" : "-right-px -top-px"}`} />
      <div className={`absolute h-3 w-3 border-b border-l border-[#d4602c] transition-all ${selected ? "-bottom-1.5 -left-1.5" : "-bottom-px -left-px"}`} />
      <div className={`absolute h-3 w-3 border-b border-r border-[#d4602c] transition-all ${selected ? "-bottom-1.5 -right-1.5" : "-bottom-px -right-px"}`} />

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
        <div className="flex items-center justify-between gap-6 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Timer className="size-3 text-[#d4602c]" />
            <p className="text-[9px] font-medium uppercase tracking-[0.25em] text-white/40">
              Rate Limiter
            </p>
          </div>
          <span
            className={`w-[52px] py-0.5 text-center text-[9px] font-bold uppercase tracking-[0.15em] ${
              status === "pass"
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-red-500/10 text-red-400/70"
            }`}
          >
            {status === "pass" ? "PASS" : "BLOCKED"}
          </span>
        </div>

        {/* Fill bar + input handle */}
        <div className="relative border-t border-white/10 px-3 py-2">
          <Handle type="target" position={Position.Left} />
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[9px] text-white/40">
              {currentCount} / {maxEvents}
            </span>
            <span className="text-[9px] text-white/30">
              per {windowLabel}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden bg-white/5">
            <div
              className="h-full transition-all duration-200"
              style={{
                width: `${fillPct * 100}%`,
                backgroundColor: fillPct >= 1 ? "rgba(239,68,68,0.6)" : "rgba(212,96,44,0.6)",
              }}
            />
          </div>
        </div>

        {/* Output handles */}
        <div className="relative flex items-center justify-between border-t border-white/10 px-3 py-1.5">
          <span className="text-[9px] text-emerald-400/70">PASS</span>
          <Handle type="source" id="pass" position={Position.Right} />
        </div>
        <div className="relative flex items-center justify-between border-t border-white/5 px-3 py-1.5">
          <span className="text-[9px] text-red-400/60">BLOCKED</span>
          <Handle type="source" id="blocked" position={Position.Right} />
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

function WebhookNode({ data, selected }: NodeProps<Node<FlowNodeData, "webhookNode">>) {
  const mode = data.webhookConfig?.mode ?? "incoming";
  const isIncoming = mode === "incoming";

  return (
    <BaseNode
      label={data.label}
      subtitle={isIncoming ? "Webhook In" : "Webhook Out"}
      icon={<Globe className="size-3.5" />}
      hasError={data.hasError}
      selected={selected}
    >
      {!isIncoming && <Handle type="target" position={Position.Left} />}
      {isIncoming ? (
        <>
          <div className="text-[8px] uppercase tracking-[0.25em] text-white/30">
            Endpoint
          </div>
          <p className="mt-0.5 truncate text-[10px] text-white/50">
            {data.webhookConfig?.path ? `/webhook/${data.webhookConfig.path}` : "Not configured"}
          </p>
        </>
      ) : (
        <>
          <div className="text-[8px] uppercase tracking-[0.25em] text-white/30">
            Target URL
          </div>
          <p className="mt-0.5 truncate text-[10px] text-white/50">
            {data.webhookConfig?.url || "Not configured"}
          </p>
        </>
      )}
      {isIncoming && <Handle type="source" position={Position.Right} />}
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


function ComparisonToolbarFields({
  node,
  onUpdate,
}: {
  node: Node<FlowNodeData, FlowNodeType>;
  onUpdate: (patch: Partial<FlowNodeData>) => void;
}) {
  const edges = useStore((s) => s.edges);
  const { getNode } = useReactFlow();

  const edgeA = edges.find((e) => e.target === node.id && e.targetHandle === "input-a");
  const edgeB = edges.find((e) => e.target === node.id && e.targetHandle === "input-b");
  const sourceNodeA = edgeA ? getNode(edgeA.source) : undefined;
  const sourceNodeB = edgeB ? getNode(edgeB.source) : undefined;
  const connectedA = !!sourceNodeA;
  const connectedB = !!sourceNodeB;

  return (
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
      <ToolbarField label="Threshold A">
        <Input
          className="h-6 w-56 text-[11px] disabled:opacity-40"
          type="number"
          disabled={connectedA}
          value={connectedA ? "" : (node.data.comparisonConfig?.thresholdA ?? "")}
          onChange={(e) =>
            onUpdate({
              comparisonConfig: {
                ...node.data.comparisonConfig,
                operator: node.data.comparisonConfig?.operator ?? ">",
                thresholdA: e.target.value ? parseFloat(e.target.value) : undefined,
              },
            })
          }
          placeholder={connectedA ? (sourceNodeA.data.label as string) : "Leave empty if connected"}
        />
      </ToolbarField>
      <ToolbarField label="Threshold B">
        <Input
          className="h-6 w-56 text-[11px] disabled:opacity-40"
          type="number"
          disabled={connectedB}
          value={connectedB ? "" : (node.data.comparisonConfig?.thresholdB ?? "")}
          onChange={(e) =>
            onUpdate({
              comparisonConfig: {
                ...node.data.comparisonConfig,
                operator: node.data.comparisonConfig?.operator ?? ">",
                thresholdB: e.target.value ? parseFloat(e.target.value) : undefined,
              },
            })
          }
          placeholder={connectedB ? (sourceNodeB.data.label as string) : "Leave empty if connected"}
        />
      </ToolbarField>
    </>
  );
}

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

  const internalNode = getNode(node.id);
  const nodeWidth = internalNode?.measured?.width ?? 200;
  const screenPos = flowToScreenPosition({
    x: node.position.x + nodeWidth / 2,
    y: node.position.y,
  });
  const nodeErrors = errors.filter((e) => e.nodeId === node.id);

  const nodeTypeLabel =
    node.type === "inputNode" ? "INPUT"
    : node.type === "outputNode" ? "PLACE ORDER"
    : node.type === "decisionNode" ? "DECISION"
    : node.type === "comparisonNode" ? "COMPARISON"
    : node.type === "rateLimiterNode" ? "RATE LIMITER"
    : node.type === "webhookNode" ? "WEBHOOK"
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



          {/* Output node: market, side, outcome, amount */}
          {node.type === "outputNode" && (
            <>
              <ToolbarField label="Market">
                <MarketPicker
                  value={node.data.marketSlug ?? ""}
                  selectedTitle={node.data.marketTitle}
                  selectedImage={node.data.marketImage}
                  onSelect={(ev) => {
                    const outcome = node.data.marketOutcome ?? "yes";
                    const tokenId = outcome === "yes" ? ev.yesTokenId : ev.noTokenId;
                    onUpdate({
                      marketSlug: ev.slug,
                      marketTitle: ev.title,
                      marketImage: ev.image,
                      marketYesTokenId: ev.yesTokenId,
                      marketNoTokenId: ev.noTokenId,
                      action: {
                        verb: node.data.action?.verb ?? "buy",
                        token_id: tokenId,
                        amount: node.data.action?.amount ?? 0,
                      },
                    });
                  }}
                />
              </ToolbarField>
              {(node.data.marketQuestions?.length ?? 0) > 1 && (
                <ToolbarField label="Sub-market">
                  <select
                    className="h-6 w-72 border border-white/10 bg-[#0a0a0a] px-1.5 text-[11px] text-white/80 outline-none"
                    value={node.data.marketIndex ?? 0}
                    onChange={(e) =>
                      onUpdate({ marketIndex: parseInt(e.target.value, 10) })
                    }
                  >
                    {node.data.marketQuestions!.map((q, i) => (
                      <option key={i} value={i}>
                        {q.length > 45 ? `${q.slice(0, 45)}...` : q}
                      </option>
                    ))}
                  </select>
                </ToolbarField>
              )}
              <ToolbarField label="Outcome">
                <div className="flex gap-1">
                  {(["yes", "no"] as const).map((o) => (
                    <button
                      key={o}
                      className={`h-6 flex-1 border text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${
                        (node.data.marketOutcome ?? "yes") === o
                          ? "border-[#d4602c]/40 bg-[#d4602c]/10 text-[#d4602c]"
                          : "border-white/10 bg-[#0a0a0a] text-white/30 hover:text-white/50"
                      }`}
                      onClick={() => {
                        const tokenId = o === "yes"
                          ? (node.data.marketYesTokenId ?? "")
                          : (node.data.marketNoTokenId ?? "");
                        onUpdate({
                          marketOutcome: o,
                          action: {
                            verb: node.data.action?.verb ?? "buy",
                            token_id: tokenId,
                            amount: node.data.action?.amount ?? 0,
                          },
                        });
                      }}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </ToolbarField>
              <ToolbarField label="Side">
                <div className="flex gap-1">
                  {(["buy", "sell"] as const).map((v) => (
                    <button
                      key={v}
                      className={`h-6 flex-1 border text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${
                        (node.data.action?.verb ?? "buy") === v
                          ? v === "buy"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border-red-500/30 bg-red-500/10 text-red-400"
                          : "border-white/10 bg-[#0a0a0a] text-white/30 hover:text-white/50"
                      }`}
                      onClick={() =>
                        onUpdate({
                          action: {
                            verb: v,
                            token_id: node.data.action?.token_id ?? "",
                            amount: node.data.action?.amount ?? 0,
                          },
                        })
                      }
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </ToolbarField>
              <ToolbarField label="Amount Type">
                <div className="flex gap-1">
                  {(["dollars", "shares"] as const).map((t) => (
                    <button
                      key={t}
                      className={`h-6 flex-1 border text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${
                        (node.data.amountType ?? "dollars") === t
                          ? "border-[#d4602c]/40 bg-[#d4602c]/10 text-[#d4602c]"
                          : "border-white/10 bg-[#0a0a0a] text-white/30 hover:text-white/50"
                      }`}
                      onClick={() => onUpdate({ amountType: t })}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </ToolbarField>
              <ToolbarField label={`Amount (${(node.data.amountType ?? "dollars") === "dollars" ? "$" : "shares"})`}>
                <Input
                  className="h-6 w-72 text-[11px]"
                  type="text"
                  inputMode="decimal"
                  value={node.data.action?.amount || ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    // Allow empty, digits, and decimal point
                    if (val === "" || /^\d*\.?\d*$/.test(val)) {
                      onUpdate({
                        action: {
                          verb: node.data.action?.verb ?? "buy",
                          token_id: node.data.action?.token_id ?? "",
                          amount: val === "" ? 0 : Number(val) || 0,
                        },
                      });
                    }
                  }}
                  placeholder="0"
                />
              </ToolbarField>
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

          {/* Market node: market picker + outcome */}
          {node.type === "marketNode" && (
            <>
              <ToolbarField label="Market">
                <MarketPicker
                  value={node.data.marketSlug ?? ""}
                  selectedTitle={node.data.marketTitle}
                  selectedImage={node.data.marketImage}
                  onSelect={(ev) => onUpdate({ marketSlug: ev.slug, marketTitle: ev.title, marketImage: ev.image })}
                />
              </ToolbarField>
              {(node.data.marketQuestions?.length ?? 0) > 1 && (
                <ToolbarField label="Sub-market">
                  <select
                    className="h-6 w-72 border border-white/10 bg-[#0a0a0a] px-1.5 text-[11px] text-white/80 outline-none"
                    value={node.data.marketIndex ?? 0}
                    onChange={(e) =>
                      onUpdate({ marketIndex: parseInt(e.target.value, 10) })
                    }
                  >
                    {node.data.marketQuestions!.map((q, i) => (
                      <option key={i} value={i}>
                        {q.length > 45 ? `${q.slice(0, 45)}...` : q}
                      </option>
                    ))}
                  </select>
                </ToolbarField>
              )}
              <ToolbarField label="Outcome Price">
                <select
                  className="h-6 w-72 border border-white/10 bg-[#0a0a0a] px-1.5 text-[11px] text-white/80 outline-none"
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
            <ComparisonToolbarFields node={node} onUpdate={onUpdate} />
          )}

          {/* Logic gate node: gate type selector */}
          {node.type === "logicGateNode" && (
            <ToolbarField label="Gate Type">
              <div className="flex gap-1">
                {(["and", "or"] as const).map((g) => (
                  <button
                    key={g}
                    className={`h-6 flex-1 border text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${
                      (node.data.logicGateConfig?.gateType ?? "and") === g
                        ? "border-[#d4602c]/40 bg-[#d4602c]/10 text-[#d4602c]"
                        : "border-white/10 bg-[#0a0a0a] text-white/30 hover:text-white/50"
                    }`}
                    onClick={() =>
                      onUpdate({
                        logicGateConfig: { gateType: g },
                        label: g.toUpperCase(),
                      })
                    }
                  >
                    {g}
                  </button>
                ))}
              </div>
            </ToolbarField>
          )}

          {/* Rate limiter node: max events + window */}
          {node.type === "rateLimiterNode" && (
            <>
              <ToolbarField label="Max Events">
                <Input
                  className="h-6 w-56 text-[11px]"
                  type="number"
                  min={1}
                  value={node.data.rateLimiterConfig?.maxEvents ?? 5}
                  onChange={(e) =>
                    onUpdate({
                      rateLimiterConfig: {
                        maxEvents: Math.max(1, parseInt(e.target.value, 10) || 1),
                        windowMs: node.data.rateLimiterConfig?.windowMs ?? 60000,
                      },
                    })
                  }
                />
              </ToolbarField>
              <ToolbarField label="Window">
                <select
                  className="h-6 w-56 border border-white/10 bg-[#0a0a0a] px-1.5 text-[11px] text-white/80 outline-none"
                  value={node.data.rateLimiterConfig?.windowMs ?? 60000}
                  onChange={(e) =>
                    onUpdate({
                      rateLimiterConfig: {
                        maxEvents: node.data.rateLimiterConfig?.maxEvents ?? 5,
                        windowMs: parseInt(e.target.value, 10),
                      },
                    })
                  }
                >
                  <option value={1000}>1 second</option>
                  <option value={5000}>5 seconds</option>
                  <option value={10000}>10 seconds</option>
                  <option value={30000}>30 seconds</option>
                  <option value={60000}>1 minute</option>
                  <option value={300000}>5 minutes</option>
                  <option value={900000}>15 minutes</option>
                  <option value={3600000}>1 hour</option>
                </select>
              </ToolbarField>
            </>
          )}

          {/* Webhook node: mode, path/url */}
          {node.type === "webhookNode" && (
            <>
              {node.data.webhookConfig?.mode === "incoming" && (
                <ToolbarField label="Webhook Path">
                  <Input
                    className="h-6 w-56 text-[11px]"
                    value={node.data.webhookConfig?.path ?? ""}
                    onChange={(e) =>
                      onUpdate({
                        webhookConfig: {
                          ...node.data.webhookConfig,
                          mode: "incoming",
                          path: e.target.value,
                        },
                      })
                    }
                    placeholder="my-webhook-id"
                  />
                </ToolbarField>
              )}
              {node.data.webhookConfig?.mode === "outgoing" && (
                <ToolbarField label="Target URL">
                  <Input
                    className="h-6 w-56 text-[11px]"
                    value={node.data.webhookConfig?.url ?? ""}
                    onChange={(e) =>
                      onUpdate({
                        webhookConfig: {
                          ...node.data.webhookConfig,
                          mode: "outgoing",
                          url: e.target.value,
                        },
                      })
                    }
                    placeholder="https://example.com/callback"
                  />
                </ToolbarField>
              )}
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
  webhookMode?: WebhookMode;
  label: string;
  icon: React.ReactNode;
  hasTarget: boolean;
  hasSource: boolean;
};

const INPUT_NODE_OPTIONS: NodeOption[] = [
  { type: "inputNode", inputSubType: "crypto_price", label: "Crypto Price", icon: <TrendingUp className="size-3 text-[#d4602c]" />, hasTarget: false, hasSource: true },
  { type: "marketNode", label: "Market", icon: <BarChart3 className="size-3 text-[#d4602c]" />, hasTarget: false, hasSource: true },
  { type: "webhookNode", webhookMode: "incoming", label: "Webhook In", icon: <Globe className="size-3 text-[#d4602c]" />, hasTarget: false, hasSource: true },
];

const LOGIC_NODE_OPTIONS: NodeOption[] = [
  { type: "comparisonNode", label: "Comparison", icon: <Scale className="size-3 text-[#d4602c]" />, hasTarget: true, hasSource: true },
  { type: "logicGateNode", label: "Logic Gate", icon: <GitBranch className="size-3 text-[#d4602c]" />, hasTarget: true, hasSource: true },
  { type: "rateLimiterNode", label: "Rate Limiter", icon: <Timer className="size-3 text-[#d4602c]" />, hasTarget: true, hasSource: true },
];

const OUTPUT_NODE_OPTIONS: NodeOption[] = [
  { type: "outputNode", label: "Place Order", icon: <CheckCircle2 className="size-3 text-[#d4602c]" />, hasTarget: true, hasSource: false },
  { type: "webhookNode", webhookMode: "outgoing", label: "Webhook Out", icon: <Globe className="size-3 text-[#d4602c]" />, hasTarget: true, hasSource: false },
];

const ALL_NODE_OPTIONS: NodeOption[] = [...INPUT_NODE_OPTIONS, ...LOGIC_NODE_OPTIONS, ...OUTPUT_NODE_OPTIONS];

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
    webhookMode?: WebhookMode,
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
            key={`${opt.type}-${opt.inputSubType ?? ""}${opt.webhookMode ?? ""}`}
            className={DROPDOWN_ITEM_CLASS}
            onClick={() => {
              onAddNode(opt.type, { x: menu.flowX, y: menu.flowY }, connectFrom, opt.inputSubType, opt.webhookMode);
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
    webhookMode?: WebhookMode,
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
                    key={`${opt.type}-${opt.inputSubType ?? ""}${opt.webhookMode ?? ""}`}
                    className={DROPDOWN_ITEM_CLASS}
                    onClick={() => {
                      onAddNode(opt.type, { x: menu.flowX, y: menu.flowY }, undefined, opt.inputSubType, opt.webhookMode);
                      onClose();
                    }}
                  >
                    {opt.icon}
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={DROPDOWN_SUBTRIGGER_CLASS}>
                <GitBranch className="size-3 text-[#d4602c]" />
                Logic
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={DROPDOWN_CONTENT_CLASS}>
                {LOGIC_NODE_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={`${opt.type}-${opt.inputSubType ?? ""}${opt.webhookMode ?? ""}`}
                    className={DROPDOWN_ITEM_CLASS}
                    onClick={() => {
                      onAddNode(opt.type, { x: menu.flowX, y: menu.flowY }, undefined, opt.inputSubType, opt.webhookMode);
                      onClose();
                    }}
                  >
                    {opt.icon}
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={DROPDOWN_SUBTRIGGER_CLASS}>
                <CheckCircle2 className="size-3 text-[#d4602c]" />
                Output
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={DROPDOWN_CONTENT_CLASS}>
                {OUTPUT_NODE_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={`${opt.type}-${opt.inputSubType ?? ""}${opt.webhookMode ?? ""}`}
                    className={DROPDOWN_ITEM_CLASS}
                    onClick={() => {
                      onAddNode(opt.type, { x: menu.flowX, y: menu.flowY }, undefined, opt.inputSubType, opt.webhookMode);
                      onClose();
                    }}
                  >
                    {opt.icon}
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
    requestAnimationFrame(() => {
      fitView({ padding: 0.24 });
    });
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
      const nextEdges = applyEdgeChanges(filtered, edgesRef.current);
      setEdges(nextEdges);
      edgesRef.current = nextEdges;

      // Auto-shrink logic gate inputs: remove trailing empty slots, keep 1 empty after last connected
      const hasRemovals = filtered.some((c) => c.type === "remove");
      let nextNodes = nodesRef.current;
      if (hasRemovals) {
        let changed = false;
        nextNodes = nextNodes.map((node) => {
          if (node.type !== "logicGateNode") return node;
          const connectedHandles = new Set(
            nextEdges.filter((e) => e.target === node.id).map((e) => e.targetHandle),
          );
          let lastConnectedIdx = -1;
          for (let i = node.data.inputs.length - 1; i >= 0; i--) {
            if (connectedHandles.has(node.data.inputs[i])) {
              lastConnectedIdx = i;
              break;
            }
          }
          // Keep: all connected + 1 empty, minimum 2
          const keepCount = Math.max(lastConnectedIdx + 2, 2);
          if (keepCount < node.data.inputs.length) {
            changed = true;
            return { ...node, data: { ...node.data, inputs: node.data.inputs.slice(0, keepCount) } };
          }
          return node;
        });
        if (changed) {
          setNodes(nextNodes);
          nodesRef.current = nextNodes;
        }
      }

      persistRef.current(nextNodes, nextEdges);
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
    webhookMode?: WebhookMode,
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

    const isCryptoPrice = type === "inputNode" && inputSubType === "crypto_price";
    const isWebhookIncoming = type === "webhookNode" && webhookMode === "incoming";
    const isWebhookOutgoing = type === "webhookNode" && webhookMode === "outgoing";
    const id = `${type}-${Date.now()}`;
    const node: Node<FlowNodeData, FlowNodeType> = {
      id,
      type,
      position,
      data: {
        label: isCryptoPrice
            ? "BTC Price"
            : type === "decisionNode"
              ? "New Decision"
              : type === "inputNode"
                ? "New Input"
                : type === "comparisonNode"
                  ? "Compare"
                  : type === "logicGateNode"
                    ? "AND"
                    : type === "rateLimiterNode"
                      ? "Rate Limit"
                      : type === "marketNode"
                        ? "Market"
                        : type === "webhookNode"
                          ? (isWebhookIncoming ? "Webhook In" : "Webhook Out")
                          : "Place Order",
        inputs: type === "inputNode" || type === "marketNode" || isWebhookIncoming
          ? []
          : type === "comparisonNode"
            ? ["input-a", "input-b"]
            : type === "logicGateNode"
              ? ["input-0", "input-1"]
              : type === "rateLimiterNode"
                ? []
                : isWebhookOutgoing
                  ? ["topic.webhook"]
                  : ["topic.orders"],
        outputs:
          type === "decisionNode"
            ? ["branch-a", "branch-b"]
            : type === "marketNode"
              ? [...MARKET_OUTPUT_IDS]
              : type === "rateLimiterNode"
                ? ["pass", "blocked"]
                : type === "outputNode" || type === "comparisonNode" || type === "logicGateNode" || isWebhookOutgoing
                ? []
                : isWebhookIncoming
                  ? ["topic.webhook"]
                  : ["topic.orders"],
        ...(type === "inputNode"
          ? { inputType: inputSubType ?? "manual_trigger" }
          : {}),
        ...(isCryptoPrice
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
        ...(type === "logicGateNode"
          ? { logicGateConfig: { gateType: "and" as const } }
          : {}),
        ...(type === "rateLimiterNode"
          ? { rateLimiterConfig: { maxEvents: 5, windowMs: 60000 } }
          : {}),
        ...(type === "marketNode" ? { marketSlug: "" } : {}),
        ...(type === "webhookNode"
          ? {
              webhookConfig: {
                mode: webhookMode ?? "incoming",
                ...(webhookMode === "incoming" ? { path: `hook-${Date.now()}` } : {}),
                ...(webhookMode === "outgoing" ? { url: "" } : {}),
              },
            }
          : {}),
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

      // Auto-grow logic gate inputs: when all slots are filled, add an empty one
      let nextNodes = nodesRef.current;
      const targetNode = nextNodes.find((n) => n.id === connection.target);
      if (targetNode?.type === "logicGateNode") {
        const inputs = targetNode.data.inputs;
        const connectedHandles = new Set(
          nextEdges.filter((e) => e.target === targetNode.id).map((e) => e.targetHandle),
        );
        const allFilled = inputs.every((h) => connectedHandles.has(h));
        if (allFilled) {
          const newIndex = inputs.length;
          const updatedNode = {
            ...targetNode,
            data: { ...targetNode.data, inputs: [...inputs, `input-${newIndex}`] },
          };
          nextNodes = nextNodes.map((n) => (n.id === targetNode.id ? updatedNode : n));
          setNodes(nextNodes);
          nodesRef.current = nextNodes;
        }
      }

      persistRef.current(nextNodes, nextEdges);
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
              : t === "logic_gate"
                ? "logicGateNode"
                : t === "market"
                  ? "marketNode"
                  : t === "rate_limiter"
                    ? "rateLimiterNode"
                    : t === "webhook"
                      ? "webhookNode"
                      : "outputNode";

      const inputType = "inputType" in params ? (params.inputType as string) : undefined;
      const isCrypto =
        params.type === "input" && inputType === "crypto_price";

      const node: Node<FlowNodeData, FlowNodeType> = {
        id: params.id,
        type: nodeType,
        position: { x: 0, y: 0 }, // will be auto-laid out
        data: {
          label: params.label,
          inputs: ("inputs" in params ? params.inputs : undefined) ?? [],
          outputs: ("outputs" in params ? params.outputs : undefined) ?? [],
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
          ...("logicGateConfig" in params && params.logicGateConfig
            ? { logicGateConfig: params.logicGateConfig as { gateType: "and" | "or" } }
            : {}),
          ...("webhookConfig" in params && params.webhookConfig
            ? { webhookConfig: params.webhookConfig as WebhookConfig }
            : {}),
          ...("rateLimiterConfig" in params && params.rateLimiterConfig
            ? { rateLimiterConfig: params.rateLimiterConfig as { maxEvents: number; windowMs: number } }
            : {}),
          ...("marketSlug" in params && params.marketSlug != null
            ? { marketSlug: params.marketSlug as string }
            : {}),
          ...("marketOutcome" in params && params.marketOutcome
            ? { marketOutcome: params.marketOutcome as MarketOutcome }
            : {}),
          ...("marketIndex" in params && params.marketIndex != null
            ? { marketIndex: params.marketIndex as number }
            : {}),
          ...("amountType" in params && params.amountType
            ? { amountType: params.amountType as "dollars" | "shares" }
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
          ...(params.logicGateConfig !== undefined
            ? { logicGateConfig: params.logicGateConfig }
            : {}),
          ...("webhookConfig" in params && params.webhookConfig !== undefined
            ? { webhookConfig: params.webhookConfig }
            : {}),
          ...(params.comparisonConfig !== undefined
            ? { comparisonConfig: params.comparisonConfig }
            : {}),
          ...(params.rateLimiterConfig !== undefined
            ? { rateLimiterConfig: params.rateLimiterConfig }
            : {}),
          ...(params.marketSlug !== undefined
            ? { marketSlug: params.marketSlug }
            : {}),
          ...(params.marketOutcome !== undefined
            ? { marketOutcome: params.marketOutcome }
            : {}),
          ...(params.marketIndex !== undefined
            ? { marketIndex: params.marketIndex }
            : {}),
          ...(params.amountType !== undefined
            ? { amountType: params.amountType }
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
      logicGateNode: LogicGateNode,
      rateLimiterNode: RateLimiterNode,
      webhookNode: WebhookNode,
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
                  (node.inputType === "crypto_price" ? (
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
