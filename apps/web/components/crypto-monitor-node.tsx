"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { FlowNodeData } from "./blueprint-studio";
import { usePulse } from "./pulse-context";

type PricePoint = { time: number; value: number };

type Interval = "live" | "15m" | "1h" | "1d" | "1w";

const INTERVAL_OPTIONS: { key: Interval; label: string }[] = [
  { key: "live", label: "LIVE" },
  { key: "15m", label: "15M" },
  { key: "1h", label: "1H" },
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
];

const KLINE_CONFIG: Record<Exclude<Interval, "live">, { binance: string; limit: number }> = {
  "15m": { binance: "1m", limit: 15 },
  "1h": { binance: "1m", limit: 60 },
  "1d": { binance: "1h", limit: 24 },
  "1w": { binance: "4h", limit: 42 },
};

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; price: number; change24h: number; high24h: number; low24h: number; history: PricePoint[] };

function Sparkline({ data, width, height }: { data: PricePoint[]; width: number; height: number }) {
  if (data.length < 2) return null;

  const prices = data.map((d) => d.value);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 0.01;

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * w;
    const y = pad + h - ((d.value - min) / range) * h;
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
        <linearGradient id={`crypto-spark-${trending}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={trending ? "#d4602c" : "#ffffff"} stopOpacity="0.15" />
          <stop offset="100%" stopColor={trending ? "#d4602c" : "#ffffff"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={fillPoints}
        fill={`url(#crypto-spark-${trending})`}
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

function formatPrice(value: number): string {
  if (value >= 1000) return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(6)}`;
}

// Ensure symbol is in Binance format (e.g. "BTCUSDT")
function toBinanceSymbol(sym: string): string {
  const s = sym.toUpperCase().trim();
  if (s.endsWith("USDT") || s.endsWith("BUSD") || s.endsWith("USD")) return s;
  return `${s}USDT`;
}

// --- Binance WebSocket for live trade prices ---

function connectBinanceWs(
  symbol: string,
  onTrade: (price: number) => void,
): () => void {
  const stream = symbol.toLowerCase() + "@trade";
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  function connect() {
    if (!alive) return;
    ws = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.p) {
          onTrade(parseFloat(data.p));
        }
      } catch {
        // Ignore malformed
      }
    };

    ws.onclose = () => {
      if (alive) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();

  return () => {
    alive = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}

export function CryptoMonitorNode({ id, data, selected }: NodeProps<Node<FlowNodeData, "inputNode">>) {
  const { pulseNode } = usePulse();
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [interval, setInterval_] = useState<Interval>("live");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveHistory, setLiveHistory] = useState<PricePoint[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<Interval>(interval);
  intervalRef.current = interval;

  const symbol = data.cryptoMonitorConfig?.symbol ?? "";
  const condition = data.cryptoMonitorConfig?.condition ?? "drops_below";
  const targetPrice = data.cryptoMonitorConfig?.targetPrice ?? 0;

  // Fetch history only (for interval changes when already loaded)
  const fetchHistory = useCallback(async (sym: string, intv: Interval) => {
    const binSym = toBinanceSymbol(sym);
    let history: PricePoint[] = [];
    if (intv === "live") {
      const tradesRes = await fetch(
        `/api/crypto?symbol=${encodeURIComponent(binSym)}&type=trades&seconds=60`,
      );
      if (tradesRes.ok) {
        const tradesData = await tradesRes.json();
        if (tradesData.points) history = tradesData.points;
      }
    } else {
      const cfg = KLINE_CONFIG[intv];
      const klinesRes = await fetch(
        `/api/crypto?symbol=${encodeURIComponent(binSym)}&type=klines&interval=${encodeURIComponent(cfg.binance)}&limit=${cfg.limit}`,
      );
      if (klinesRes.ok) {
        const klinesData = await klinesRes.json();
        if (klinesData.points) history = klinesData.points;
      }
    }
    return history;
  }, []);

  // Full fetch (price + history) — used on symbol change
  const fetchData = useCallback(async (sym: string, intv: Interval) => {
    const binSym = toBinanceSymbol(sym);
    try {
      const priceRes = await fetch(`/api/crypto?symbol=${encodeURIComponent(binSym)}`);
      if (!priceRes.ok) throw new Error(`HTTP ${priceRes.status}`);
      const priceData = await priceRes.json();
      if (priceData.error) throw new Error(priceData.error);

      const history = await fetchHistory(sym, intv);

      setFetchState({
        status: "loaded",
        price: priceData.price,
        change24h: priceData.change24h,
        high24h: priceData.high24h,
        low24h: priceData.low24h,
        history,
      });
      setLiveHistory(history);
      setLivePrice(null);
    } catch (err) {
      setFetchState({
        status: "error",
        message: err instanceof Error ? err.message.toUpperCase() : "FETCH FAILED",
      });
    }
  }, [fetchHistory]);

  // Initial fetch on symbol change — full skeleton
  useEffect(() => {
    if (!symbol.trim()) {
      setFetchState({ status: "idle" });
      return;
    }

    setFetchState({ status: "loading" });

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchData(symbol, interval);
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // Only re-run on symbol change, not interval
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, fetchData]);

  // Interval change — only refetch history (chart skeleton only, delayed 50ms)
  useEffect(() => {
    if (fetchState.status !== "loaded" || !symbol.trim()) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setHistoryLoading(true);
    }, 50);

    fetchHistory(symbol, interval).then((history) => {
      cancelled = true;
      clearTimeout(timer);
      setLiveHistory(history);
      setHistoryLoading(false);
    });

    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval]);

  // Binance WebSocket for live price streaming
  useEffect(() => {
    if (fetchState.status !== "loaded" || !symbol.trim()) return;

    const binSym = toBinanceSymbol(symbol);

    const cleanup = connectBinanceWs(binSym, (price) => {
      pulseNode(id);
      setLivePrice(price);

      // Only update the chart in live mode
      if (intervalRef.current !== "live") return;

      setLiveHistory((prev) => {
        const now = Math.floor(Date.now() / 1000);
        const last = prev[prev.length - 1];
        if (last && now - last.time < 1) {
          return [...prev.slice(0, -1), { time: now, value: price }];
        }
        const next = [...prev, { time: now, value: price }];
        const cutoff = now - 60;
        const firstValid = next.findIndex((p) => p.time >= cutoff);
        return firstValid > 0 ? next.slice(firstValid) : next;
      });
    });

    return cleanup;
  }, [fetchState.status, symbol]);

  const currentPrice = livePrice ?? (fetchState.status === "loaded" ? fetchState.price : 0);

  const isTriggered =
    fetchState.status === "loaded" &&
    targetPrice > 0 &&
    (condition === "drops_below"
      ? currentPrice <= targetPrice
      : currentPrice >= targetPrice);

  return (
    <div className="relative w-[340px] border border-white/20 bg-[#111314] font-[family-name:var(--font-geist-mono)] shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
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

      {/* Idle state */}
      {fetchState.status === "idle" && (
        <div className="px-3 py-8 text-center">
          <div className="mb-2 text-[9px] uppercase tracking-[0.3em] text-white/20">
            AWAITING CONFIG
          </div>
          <div className="mx-auto w-16 border-t border-dashed border-white/10" />
        </div>
      )}

      {/* Loading skeleton */}
      {fetchState.status === "loading" && (
        <div className="relative">
          {/* Header skeleton */}
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-10 animate-pulse rounded bg-white/10" />
          </div>
          {/* Price skeleton */}
          <div className="border-b border-white/10 px-3 py-3">
            <div className="mb-1.5 h-2.5 w-16 animate-pulse rounded bg-white/10" />
            <div className="flex items-baseline gap-2">
              <div className="h-7 w-36 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-12 animate-pulse rounded bg-white/10" />
            </div>
          </div>
          {/* Chart skeleton */}
          <div className="border-b border-white/10 px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="h-2.5 w-20 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-32 animate-pulse rounded bg-white/10" />
            </div>
            <div className="h-20 w-full animate-pulse rounded bg-white/[0.05]" />
          </div>
          {/* Stats skeleton */}
          <div className="grid grid-cols-2 border-b border-white/10">
            <div className="border-r border-white/10 px-3 py-2">
              <div className="mb-1 h-2.5 w-12 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            </div>
            <div className="px-3 py-2">
              <div className="mb-1 h-2.5 w-12 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {fetchState.status === "error" && (
        <div className="px-3 py-4">
          <div className="mb-2 border border-[#d4602c]/30 bg-[#d4602c]/5 px-2 py-1.5">
            <span className="text-[9px] uppercase tracking-[0.2em] text-[#d4602c]">
              ERR /// {fetchState.message}
            </span>
          </div>
          <button
            className="text-[9px] uppercase tracking-[0.2em] text-white/30 transition-colors hover:text-[#d4602c]"
            onClick={() => {
              if (symbol.trim()) {
                setFetchState({ status: "loading" });
                fetchData(symbol, interval);
              }
            }}
          >
            {">"} RETRY
          </button>
        </div>
      )}

      {/* Loaded state */}
      {fetchState.status === "loaded" && (
        <div className="relative">
          {/* Symbol + live indicator */}
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-medium uppercase tracking-[0.25em] text-white/40">
                CRYPTO MONITOR
              </span>
            </div>
            <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[#d4602c]">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#d4602c] opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-[#d4602c]" />
              </span>
              LIVE
            </span>
          </div>

          {/* Price display */}
          <div className="border-b border-white/10 px-3 py-3">
            <div className="mb-0.5 text-[8px] uppercase tracking-[0.3em] text-white/30">
              {symbol.toUpperCase()}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-bold leading-none tracking-tight text-white/90">
                {formatPrice(currentPrice)}
              </span>
              <span
                className={`text-[11px] font-bold ${
                  fetchState.change24h >= 0 ? "text-[#d4602c]" : "text-white/40"
                }`}
              >
                {fetchState.change24h >= 0 ? "+" : ""}
                {fetchState.change24h.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Price chart */}
          <div className="border-b border-white/10 px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[8px] uppercase tracking-[0.25em] text-white/25">PRICE HISTORY</span>
              <div className="nodrag flex gap-0.5">
                {INTERVAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setInterval_(opt.key)}
                    className={`px-1.5 py-0.5 text-[8px] uppercase tracking-[0.2em] transition-colors ${
                      interval === opt.key
                        ? "bg-[#d4602c]/20 text-[#d4602c]"
                        : "text-white/25 hover:text-white/50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {historyLoading ? (
              <div className="h-20 w-full animate-pulse rounded bg-white/[0.05]" />
            ) : liveHistory.length > 1 ? (
              <Sparkline data={liveHistory} width={314} height={80} />
            ) : (
              <div className="flex h-20 items-center justify-center">
                <span className="text-[8px] uppercase tracking-[0.25em] text-white/15">NO HISTORY</span>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 border-b border-white/10">
            <div className="border-r border-white/10 px-3 py-2">
              <div className="text-[8px] uppercase tracking-[0.3em] text-white/25">24H HIGH</div>
              <div className="text-[11px] font-medium text-white/60">{formatPrice(fetchState.high24h)}</div>
            </div>
            <div className="px-3 py-2">
              <div className="text-[8px] uppercase tracking-[0.3em] text-white/25">24H LOW</div>
              <div className="text-[11px] font-medium text-white/60">{formatPrice(fetchState.low24h)}</div>
            </div>
          </div>

          {/* Alert condition */}
          {targetPrice > 0 && (
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[8px] uppercase tracking-[0.2em] text-white/25">
                {condition === "drops_below" ? "ALERT BELOW" : "ALERT ABOVE"}{" "}
                {formatPrice(targetPrice)}
              </span>
              <span
                className={`text-[9px] font-bold uppercase tracking-[0.2em] ${
                  isTriggered ? "text-[#d4602c]" : "text-white/20"
                }`}
              >
                {isTriggered ? (
                  <span className="flex items-center gap-1.5">
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#d4602c] opacity-75" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-[#d4602c]" />
                    </span>
                    TRIGGERED
                  </span>
                ) : (
                  "WATCHING"
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Scanlines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.1) 2px, rgba(255,255,255,0.1) 3px)",
        }}
      />

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
