"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Loader2 } from "lucide-react";
import type { FlowNodeData } from "./blueprint-studio";
import { usePulse } from "./pulse-context";

const SIGNAL_OUTPUT_HANDLES = [
  { id: "buyVolRatio", label: "BUY/SELL RATIO" },
  { id: "tradeFreq", label: "TRADE FREQ" },
  { id: "vwap", label: "VWAP" },
  { id: "volatility", label: "VOLATILITY" },
] as const;

export const SIGNAL_OUTPUT_IDS = SIGNAL_OUTPUT_HANDLES.map((h) => h.id);

type SignalData = {
  buyVolRatio: number;
  tradeFreq: number;
  vwap: number;
  volatility: number;
};

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: SignalData };

const WINDOW_OPTIONS = [
  { label: "1H", seconds: 3600 },
  { label: "4H", seconds: 14400 },
  { label: "1D", seconds: 86400 },
  { label: "1W", seconds: 604800 },
] as const;

function formatSignalValue(id: string, value: number): string {
  if (value == null || !isFinite(value)) return "—";
  switch (id) {
    case "buyVolRatio":
      return value.toFixed(2) + "x";
    case "tradeFreq":
      return value.toFixed(1) + "/hr";
    case "vwap":
      return (value * 100).toFixed(1) + "¢";
    case "volatility":
      return (value * 100).toFixed(3) + "¢";
    default:
      return value.toFixed(4);
  }
}

export function SignalNode({ id, data, selected }: NodeProps<Node<FlowNodeData, "signalNode">>) {
  const { pulseNode, setNodeValue } = usePulse();
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [windowSeconds, setWindowSeconds] = useState(data.signalConfig?.windowSeconds ?? 3600);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const marketSlug = data.signalConfig?.marketSlug ?? "";
  const refreshMs = data.signalConfig?.refreshMs ?? 60000;

  const fetchSignals = useCallback(async (slug: string, window: number) => {
    if (!slug.trim()) {
      setFetchState({ status: "idle" });
      return;
    }

    setFetchState((prev) => prev.status === "idle" ? { status: "loading" } : prev);

    try {
      // First resolve slug → tokenId
      const lookupResp = await fetch("/api/clickhouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "market_lookup", slugs: [slug] }),
      });
      const lookupData = await lookupResp.json();
      const market = lookupData.markets?.[0];
      if (!market) {
        setFetchState({ status: "error", message: "MARKET NOT FOUND" });
        return;
      }

      const tokenId = market.clob_token_ids[0];
      if (!tokenId) {
        setFetchState({ status: "error", message: "NO TOKEN ID" });
        return;
      }

      // Then fetch signals
      const signalResp = await fetch("/api/clickhouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "signals", tokenId, windowSeconds: window }),
      });
      const signalData = await signalResp.json() as SignalData;

      setFetchState({ status: "loaded", data: signalData });

      // Publish values
      setNodeValue(id, signalData.vwap);
      setNodeValue(`${id}:buyVolRatio`, signalData.buyVolRatio);
      setNodeValue(`${id}:tradeFreq`, signalData.tradeFreq);
      setNodeValue(`${id}:vwap`, signalData.vwap);
      setNodeValue(`${id}:volatility`, signalData.volatility);
      pulseNode(id);
    } catch (err) {
      setFetchState({
        status: "error",
        message: err instanceof Error ? err.message.toUpperCase() : "FETCH FAILED",
      });
    }
  }, [id, setNodeValue, pulseNode]);

  // Initial fetch + periodic refresh
  useEffect(() => {
    if (!marketSlug.trim()) {
      setFetchState({ status: "idle" });
      return;
    }

    fetchSignals(marketSlug, windowSeconds);

    timerRef.current = setInterval(() => {
      fetchSignals(marketSlug, windowSeconds);
    }, refreshMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [marketSlug, windowSeconds, refreshMs, fetchSignals]);

  return (
    <div className="relative w-[260px] border border-white/20 bg-[#111314] font-[family-name:var(--font-geist-mono)] shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
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

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="size-1.5 rounded-full bg-[#d4602c]" />
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/60">
            Signal
          </span>
        </div>
        {fetchState.status === "loading" && (
          <Loader2 className="size-3 animate-spin text-[#d4602c]/60" />
        )}
        {fetchState.status === "loaded" && (
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#d4602c] opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-[#d4602c]" />
          </span>
        )}
      </div>

      {/* Idle state */}
      {fetchState.status === "idle" && (
        <div className="px-3 py-6 text-center">
          <div className="text-[9px] uppercase tracking-[0.3em] text-white/20">
            AWAITING CONFIG
          </div>
        </div>
      )}

      {/* Error state */}
      {fetchState.status === "error" && (
        <div className="px-3 py-3">
          <div className="border border-[#d4602c]/30 bg-[#d4602c]/5 px-2 py-1.5">
            <span className="text-[9px] uppercase tracking-[0.2em] text-[#d4602c]">
              ERR /// {fetchState.message}
            </span>
          </div>
        </div>
      )}

      {/* Window selector */}
      {marketSlug && (
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
          <span className="text-[8px] uppercase tracking-[0.25em] text-white/25">WINDOW</span>
          <div className="nodrag flex gap-0.5">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={() => setWindowSeconds(opt.seconds)}
                className={`px-1.5 py-0.5 text-[8px] uppercase tracking-[0.2em] transition-colors ${
                  windowSeconds === opt.seconds
                    ? "bg-[#d4602c]/20 text-[#d4602c]"
                    : "text-white/25 hover:text-white/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Output sockets */}
      <div>
        {SIGNAL_OUTPUT_HANDLES.map((output) => {
          let value: string | undefined;
          if (fetchState.status === "loaded") {
            const v = fetchState.data[output.id as keyof SignalData];
            value = formatSignalValue(output.id, v);
          }
          return (
            <div
              key={output.id}
              className="relative flex items-center justify-between border-t border-white/[0.06] px-3 py-1.5"
            >
              <span className="text-[9px] uppercase tracking-[0.15em] text-white/30">
                {output.label}
              </span>
              {value && (
                <span className="mr-3 text-[10px] font-medium tabular-nums tracking-[0.05em] text-white/50">
                  {value}
                </span>
              )}
              <Handle
                id={output.id}
                type="source"
                position={Position.Right}
                style={{ top: "50%" }}
              />
            </div>
          );
        })}
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
