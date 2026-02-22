"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import { ChevronDown } from "lucide-react";
import type { FlowNodeData } from "./blueprint-studio";
import { usePulse } from "./pulse-context";
import { cachedFetch, peekCache } from "../lib/cached-fetch";

type GammaMarket = {
  question: string;
  outcomes: string[];
  outcomePrices: string[];
  clobTokenIds: string[];
  volume: string;
  liquidity: string;
  bestBid: number;
  bestAsk: number;
  lastTradePrice: number;
  oneDayPriceChange: number;
  active: boolean;
  closed: boolean;
  image: string;
  endDate: string;
};

type GammaEvent = {
  id: string;
  title: string;
  slug: string;
  description: string;
  image: string;
  volume: number;
  volume24hr: number;
  liquidity: number;
  negRisk: boolean;
  markets: GammaMarket[];
};

const MARKET_OUTPUT_HANDLES = [
  { id: "price", label: "PRICE" },
  { id: "volume", label: "VOLUME" },
  { id: "liquidity", label: "LIQUIDITY" },
  { id: "spread", label: "SPREAD" },
  { id: "lastTrade", label: "LAST TRADE" },
  { id: "imbalance", label: "BOOK IMBAL" },
] as const;

export const MARKET_OUTPUT_IDS = MARKET_OUTPUT_HANDLES.map((h) => h.id);

type OrderBookLevel = { price: string; size: string };
type OrderBookData = {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
};


type PricePoint = { t: number; p: number };

type MarketInterval = "live" | "1d" | "1w" | "1m" | "all";

const MARKET_INTERVAL_OPTIONS: { key: MarketInterval; label: string; clobInterval: string; fidelity: string }[] = [
  { key: "live", label: "LIVE", clobInterval: "", fidelity: "" },
  { key: "1d", label: "1D", clobInterval: "1d", fidelity: "60" },
  { key: "1w", label: "1W", clobInterval: "1w", fidelity: "60" },
  { key: "1m", label: "1M", clobInterval: "1m", fidelity: "60" },
  { key: "all", label: "ALL", clobInterval: "all", fidelity: "60" },
];

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; event: GammaEvent; history: PricePoint[] };

// --- Polymarket WebSocket for live price updates ---

type WsMessage = {
  event_type: string;
  asset_id?: string;
  price?: string;
  best_bid?: string;
  best_ask?: string;
  price_changes?: Array<{
    asset_id: string;
    price: string;
    best_bid?: string;
    best_ask?: string;
  }>;
};

type LivePriceCallback = (assetId: string, price: number, bestBid?: number, bestAsk?: number) => void;

function connectPolymarketWs(
  tokenIds: string[],
  onPrice: LivePriceCallback,
): () => void {
  if (tokenIds.length === 0) return () => {};

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  function connect() {
    if (!alive) return;
    ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");

    ws.onopen = () => {
      ws?.send(JSON.stringify({
        assets_ids: tokenIds,
        type: "market",
        custom_feature_enabled: true,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data as string);
        const messages: WsMessage[] = Array.isArray(raw) ? raw : [raw];

        for (const msg of messages) {
          switch (msg.event_type) {
            case "last_trade_price":
              if (msg.asset_id && msg.price) {
                onPrice(msg.asset_id, parseFloat(msg.price));
              }
              break;
            case "price_change":
              if (msg.price_changes) {
                for (const pc of msg.price_changes) {
                  onPrice(
                    pc.asset_id,
                    parseFloat(pc.price),
                    pc.best_bid ? parseFloat(pc.best_bid) : undefined,
                    pc.best_ask ? parseFloat(pc.best_ask) : undefined,
                  );
                }
              }
              break;
            case "best_bid_ask":
              if (msg.asset_id && (msg.best_bid || msg.best_ask)) {
                onPrice(
                  msg.asset_id,
                  NaN, // no price update — best_bid is not the market price
                  msg.best_bid ? parseFloat(msg.best_bid) : undefined,
                  msg.best_ask ? parseFloat(msg.best_ask) : undefined,
                );
              }
              break;
          }
        }
      } catch {
        // Ignore malformed messages
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

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatAxisDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Sparkline({ data, width, height }: { data: PricePoint[]; width: number; height: number }) {
  if (data.length < 2) return null;

  const prices = data.map((d) => d.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 0.01;

  const yAxisW = 28;
  const xAxisH = 12;
  const pad = 2;
  const chartW = width - yAxisW - pad;
  const chartH = height - xAxisH - pad;

  const points = data.map((d, i) => {
    const x = yAxisW + (i / (data.length - 1)) * chartW;
    const y = pad + chartH - ((d.p - min) / range) * chartH;
    return `${x},${y}`;
  });

  const lastPrice = prices[prices.length - 1]!;
  const firstPrice = prices[0]!;
  const trending = lastPrice >= firstPrice;

  const fillPoints = [
    `${yAxisW},${pad + chartH}`,
    ...points,
    `${yAxisW + chartW},${pad + chartH}`,
  ].join(" ");

  const maxLabel = `${Math.round(max * 100)}¢`;
  const minLabel = `${Math.round(min * 100)}¢`;
  const startDate = formatAxisDate(data[0]!.t);
  const endDate = formatAxisDate(data[data.length - 1]!.t);

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-fill-${trending}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={trending ? "#d4602c" : "#ffffff"} stopOpacity="0.15" />
          <stop offset="100%" stopColor={trending ? "#d4602c" : "#ffffff"} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Y-axis labels */}
      <text x={yAxisW - 3} y={pad + 5} textAnchor="end" className="fill-white/20" style={{ fontSize: 7, fontFamily: "var(--font-geist-mono)" }}>{maxLabel}</text>
      <text x={yAxisW - 3} y={pad + chartH} textAnchor="end" className="fill-white/20" style={{ fontSize: 7, fontFamily: "var(--font-geist-mono)" }}>{minLabel}</text>
      {/* X-axis labels */}
      <text x={yAxisW} y={height - 1} textAnchor="start" className="fill-white/20" style={{ fontSize: 7, fontFamily: "var(--font-geist-mono)" }}>{startDate}</text>
      <text x={yAxisW + chartW} y={height - 1} textAnchor="end" className="fill-white/20" style={{ fontSize: 7, fontFamily: "var(--font-geist-mono)" }}>{endDate}</text>
      <polygon
        points={fillPoints}
        fill={`url(#spark-fill-${trending})`}
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
        cx={yAxisW + chartW}
        cy={pad + chartH - ((lastPrice - min) / range) * chartH}
        r="2"
        fill={trending ? "#d4602c" : "rgba(255,255,255,0.6)"}
      />
    </svg>
  );
}

/** Parse clobTokenIds from a raw market and return [yesTokenId, noTokenId] based on outcomes order. */
function getNormalizedTokenIds(rawMarket: GammaMarket): [string, string] {
  const tokenIds = typeof rawMarket.clobTokenIds === "string"
    ? (JSON.parse(rawMarket.clobTokenIds) as string[])
    : rawMarket.clobTokenIds;
  const outcomes = typeof rawMarket.outcomes === "string"
    ? (JSON.parse(rawMarket.outcomes) as string[])
    : rawMarket.outcomes;
  const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  const noIdx = yesIdx === 0 ? 1 : 0;
  return [tokenIds[yesIdx >= 0 ? yesIdx : 0]!, tokenIds[noIdx]!];
}

export function MarketNode({ id, data, selected }: NodeProps<Node<FlowNodeData, "marketNode">>) {
  const { pulseNode, setNodeValue, nodeValues } = usePulse();
  const { setNodes } = useReactFlow();
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [marketInterval, setMarketInterval] = useState<MarketInterval>("all");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [livePrices, setLivePrices] = useState<Record<string, { price: number; bestBid?: number; bestAsk?: number }>>({});
  const [liveHistory, setLiveHistory] = useState<PricePoint[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const bookScrollRef = useRef<HTMLDivElement>(null);
  const bookSpreadRef = useRef<HTMLDivElement>(null);
  const bookRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenIdsRef = useRef<string[]>([]);
  const marketIntervalRef = useRef<MarketInterval>(marketInterval);
  marketIntervalRef.current = marketInterval;
  const marketIndex = data.marketIndex ?? 0;

  // Fetch history only (for interval changes)
  const fetchMarketHistory = useCallback(async (tokenId: string, intv: MarketInterval): Promise<PricePoint[]> => {
    const cfg = intv === "live"
      ? { clobInterval: "1d", fidelity: "60" }
      : MARKET_INTERVAL_OPTIONS.find((o) => o.key === intv)!;
    try {
      const url = `/api/polymarket?tokenId=${encodeURIComponent(tokenId)}&interval=${encodeURIComponent(cfg.clobInterval)}&fidelity=${encodeURIComponent(cfg.fidelity)}`;
      const histData = await cachedFetch<{ history: PricePoint[] }>(url);
      let history = histData.history ?? [];
      if (intv === "live" && history.length > 0) {
        const cutoff = Math.floor(Date.now() / 1000) - 60;
        const trimmed = history.filter((p) => p.t >= cutoff);
        history = trimmed.length >= 2 ? trimmed : history.slice(-10);
      }
      return history;
    } catch {
      // Price history is non-critical
    }
    return [];
  }, []);

  // Full fetch (event + history) — used on slug change
  const fetchMarket = useCallback(async (slug: string, intv: MarketInterval) => {
    const url = `/api/polymarket?slug=${encodeURIComponent(slug)}`;
    if (!peekCache(url)) {
      setFetchState({ status: "loading" });
    }
    try {
      const events = await cachedFetch<GammaEvent[]>(url);
      if (!events.length) {
        setFetchState({ status: "error", message: "NO MARKET FOUND" });
        return;
      }
      const event = events[0]!;
      const mIdx = data.marketIndex ?? 0;
      const selectedMarket = event.markets[mIdx] ?? event.markets[0];

      let history: PricePoint[] = [];
      if (selectedMarket) {
        const [yesToken, noToken] = getNormalizedTokenIds(selectedMarket);
        tokenIdsRef.current = [yesToken, noToken];
        history = await fetchMarketHistory(yesToken, intv);
        // Persist tokenIds to node data for backend producers
        setNodes((nodes) =>
          nodes.map((n) =>
            n.id === id
              ? { ...n, data: { ...n.data, marketTokenId: yesToken, marketTokenIdNo: noToken } }
              : n
          )
        );
      }

      setFetchState({ status: "loaded", event, history });
      setLiveHistory(history);
      setLivePrices({});

      // Cache event title + image in node data for display when toolbar is closed
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, marketTitle: event.title, marketImage: event.image } }
            : n,
        ),
      );
    } catch (err) {
      setFetchState({
        status: "error",
        message: err instanceof Error ? err.message.toUpperCase() : "FETCH FAILED",
      });
    }
  }, [fetchMarketHistory, id, setNodes]);

  // Slug change — full skeleton
  useEffect(() => {
    const slug = data.marketSlug?.trim();
    if (!slug) {
      setFetchState({ status: "idle" });
      return;
    }
    // Skip debounce when cached data exists (remount case)
    const slugUrl = `/api/polymarket?slug=${encodeURIComponent(slug)}`;
    if (peekCache(slugUrl)) {
      fetchMarket(slug, marketInterval);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchMarket(slug, marketInterval);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // Only re-run on slug change, not interval
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.marketSlug, fetchMarket]);

  // Interval change — only refetch history (chart skeleton only, delayed 50ms)
  useEffect(() => {
    if (fetchState.status !== "loaded") return;
    const yesTokenId = tokenIdsRef.current[0];
    if (!yesTokenId) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) setHistoryLoading(true);
    }, 50);

    fetchMarketHistory(yesTokenId, marketInterval).then((history) => {
      cancelled = true;
      clearTimeout(timer);
      setLiveHistory(history);
      setHistoryLoading(false);
    });

    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketInterval]);

  // Sub-market change — refetch history for the new sub-market's YES token
  useEffect(() => {
    if (fetchState.status !== "loaded") return;
    const selectedMarket = fetchState.event.markets.filter((m) => m.active && !m.closed)[marketIndex] ?? fetchState.event.markets[0];
    if (!selectedMarket) return;

    const [yesToken, noToken] = getNormalizedTokenIds(selectedMarket);
    tokenIdsRef.current = [yesToken, noToken];
    setLivePrices({});

    let cancelled = false;
    setHistoryLoading(true);
    fetchMarketHistory(yesToken, marketInterval).then((history) => {
      if (cancelled) return;
      setLiveHistory(history);
      setHistoryLoading(false);
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketIndex]);

  // Connect WebSocket when loaded
  useEffect(() => {
    if (fetchState.status !== "loaded") return;
    const tokenIds = tokenIdsRef.current;
    if (tokenIds.length === 0) return;

    const yesTokenId = tokenIds[0]!;
    setWsConnected(false);

    const cleanup = connectPolymarketWs(tokenIds, (assetId, price, bestBid, bestAsk) => {
      pulseNode(id);
      setWsConnected(true);
      setLivePrices((prev) => ({
        ...prev,
        [assetId]: {
          price: Number.isNaN(price) ? (prev[assetId]?.price ?? 0) : price,
          bestBid: bestBid ?? prev[assetId]?.bestBid,
          bestAsk: bestAsk ?? prev[assetId]?.bestAsk,
        },
      }));

      // Only update the chart in live mode (skip bid/ask-only updates)
      if (assetId === yesTokenId && marketIntervalRef.current === "live" && !Number.isNaN(price)) {
        setLiveHistory((prev) => {
          const now = Math.floor(Date.now() / 1000);
          const last = prev[prev.length - 1];
          if (last && now - last.t < 1) {
            return [...prev.slice(0, -1), { t: now, p: price }];
          }
          const next = [...prev, { t: now, p: price }];
          const cutoff = now - 60;
          const firstValid = next.findIndex((pt) => pt.t >= cutoff);
          return firstValid > 0 ? next.slice(firstValid) : next;
        });
      }
    });

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchState.status, marketIndex]);

  // Fetch order book when loaded + refetch on WS updates (throttled)
  const fetchOrderBook = useCallback(async () => {
    const yesToken = tokenIdsRef.current[0];
    if (!yesToken) return;
    try {
      const data = await fetch(`/api/polymarket?book=${encodeURIComponent(yesToken)}`);
      if (!data.ok) return;
      const book = await data.json() as OrderBookData;
      setOrderBook(book);
    } catch {
      // non-critical
    }
  }, []);

  // Initial fetch when market loads
  useEffect(() => {
    if (fetchState.status !== "loaded") return;
    fetchOrderBook();
  }, [fetchState.status, marketIndex, fetchOrderBook]);

  // Throttled refetch on WS updates (every 5s max)
  useEffect(() => {
    if (!wsConnected || !bookOpen) return;
    if (bookRefetchTimerRef.current) return;
    bookRefetchTimerRef.current = setTimeout(() => {
      bookRefetchTimerRef.current = null;
      fetchOrderBook();
    }, 5000);
  }, [livePrices, wsConnected, bookOpen, fetchOrderBook]);

  useEffect(() => () => {
    if (bookRefetchTimerRef.current) clearTimeout(bookRefetchTimerRef.current);
  }, []);

  // Center on spread when book opens or data arrives
  useEffect(() => {
    if (!bookOpen) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const spread = bookSpreadRef.current;
      const container = bookScrollRef.current;
      if (!spread || !container) return;
      // offsetTop is relative to the container (its offsetParent via position:relative)
      container.scrollTop = spread.offsetTop - container.offsetHeight / 2 + spread.offsetHeight / 2;
    }));
  }, [bookOpen, orderBook]);


  const allMarkets = fetchState.status === "loaded"
    ? fetchState.event.markets.filter((m) => m.active && !m.closed)
    : [];
  const rawMarket =
    fetchState.status === "loaded" ? allMarkets[marketIndex] ?? allMarkets[0] ?? null : null;
  const market = rawMarket
    ? (() => {
        const outcomes = typeof rawMarket.outcomes === "string"
          ? (JSON.parse(rawMarket.outcomes) as string[])
          : rawMarket.outcomes;
        const outcomePrices = typeof rawMarket.outcomePrices === "string"
          ? (JSON.parse(rawMarket.outcomePrices) as string[])
          : rawMarket.outcomePrices;
        // Normalize so index 0 = YES, index 1 = NO
        const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
        if (yesIdx === 1) {
          return {
            ...rawMarket,
            outcomes: [outcomes[1]!, outcomes[0]!],
            outcomePrices: [outcomePrices[1]!, outcomePrices[0]!],
          };
        }
        return { ...rawMarket, outcomes, outcomePrices };
      })()
    : null;

  // Expose active sub-market questions to toolbar via node data
  useEffect(() => {
    if (allMarkets.length <= 1) return;
    const questions = allMarkets.map((m) =>
      typeof m.question === "string" ? m.question : String(m.question),
    );
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, marketQuestions: questions } } : n,
      ),
    );
  }, [allMarkets.length, id, setNodes]);

  // Keep tokenIdsRef in sync with the selected sub-market (normalized: [yes, no])
  useEffect(() => {
    if (!rawMarket) return;
    tokenIdsRef.current = getNormalizedTokenIds(rawMarket);
    setLivePrices({});
  }, [rawMarket?.question]); // question is a stable identity for a specific sub-market

  // Use live prices if available, otherwise fall back to GAMMA data
  const tokenIds = tokenIdsRef.current;
  const yesTokenId = tokenIds[0];
  const noTokenId = tokenIds[1];
  const yesLive = yesTokenId ? livePrices[yesTokenId] : undefined;
  const noLive = noTokenId ? livePrices[noTokenId] : undefined;
  const yesPrice = yesLive?.price ?? (market ? parseFloat(market.outcomePrices[0] ?? "0") : 0);
  const noPrice = noLive?.price ?? (market ? parseFloat(market.outcomePrices[1] ?? "0") : 0);
  const liveBestBid = yesLive?.bestBid;
  const liveBestAsk = yesLive?.bestAsk;
  const history = liveHistory;

  const selectedPrice = (data.marketOutcome ?? "yes") === "yes" ? yesPrice : noPrice;

  // Publish per-handle values so comparison nodes can read each output
  useEffect(() => {
    if (fetchState.status !== "loaded" || !market) return;
    setNodeValue(id, selectedPrice);
    setNodeValue(`${id}:price`, selectedPrice);
    setNodeValue(`${id}:volume`, parseFloat(market.volume));
    setNodeValue(`${id}:liquidity`, parseFloat(market.liquidity));
    setNodeValue(`${id}:spread`, (liveBestAsk ?? market.bestAsk) - (liveBestBid ?? market.bestBid));
    setNodeValue(`${id}:lastTrade`, yesPrice || market.lastTradePrice);
  }, [selectedPrice, fetchState.status, id, setNodeValue, market, liveBestAsk, liveBestBid, yesPrice]);

  // Publish book imbalance — top 10 levels near spread
  useEffect(() => {
    if (!orderBook) return;
    const NEAR_LEVELS = 10;
    const bids = orderBook.bids
      .map((l) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
      .sort((a, b) => b.price - a.price)
      .slice(0, NEAR_LEVELS);
    const asks = orderBook.asks
      .map((l) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
      .sort((a, b) => a.price - b.price)
      .slice(0, NEAR_LEVELS);
    const bidDepth = bids.reduce((s, l) => s + l.size, 0);
    const askDepth = asks.reduce((s, l) => s + l.size, 0);
    const total = bidDepth + askDepth;
    const imbalance = total > 0 ? bidDepth / total : 0.5;
    setNodeValue(`${id}:imbalance`, imbalance);
  }, [orderBook, id, setNodeValue]);

  const bookLevels = useMemo(() => {
    if (!orderBook) return null;

    function parse(levels: OrderBookLevel[]) {
      return levels.map((l) => ({
        price: parseFloat(l.price),
        size: parseFloat(l.size),
      }));
    }

    // Bids: highest first (closest to spread)
    const bids = parse(orderBook.bids)
      .sort((a, b) => b.price - a.price);

    // Asks: lowest first (closest to spread)
    const asks = parse(orderBook.asks)
      .sort((a, b) => a.price - b.price);

    // Cumulative depth from spread outward
    // Bids are already highest-first, asks lowest-first (both starting at spread)
    let cumBids = 0;
    const bidDepths = bids.map((l) => { cumBids += l.size; return cumBids; });
    let cumAsks = 0;
    const askDepths = asks.map((l) => { cumAsks += l.size; return cumAsks; });

    const maxDepth = Math.max(cumBids, cumAsks, 1);
    return { bids, asks, bidDepths, askDepths, maxDepth };
  }, [orderBook]);

  return (
    <div className="relative w-[340px] border border-white/20 bg-[#111314] font-[family-name:var(--font-geist-mono)] shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
      {/* Corner bracket marks — flush by default, offset when selected */}
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

      {/* States — non-loaded */}
      {fetchState.status === "idle" && (
        <div className="px-3 py-8 text-center">
          <div className="mb-2 text-[9px] uppercase tracking-[0.3em] text-white/20">
            AWAITING INPUT
          </div>
          <div className="mx-auto w-16 border-t border-dashed border-white/10" />
        </div>
      )}

      {fetchState.status === "loading" && (
        <div className="relative">
          {/* Question skeleton */}
          <div className="border-b border-white/10 px-3 py-3">
            <div className="mb-1 h-3.5 w-full animate-pulse rounded bg-white/10" />
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/10" />
          </div>
          {/* Outcome prices skeleton */}
          <div className="grid grid-cols-2 border-b border-white/10">
            <div className="border-r border-white/10 px-3 py-3">
              <div className="mb-1.5 h-2.5 w-8 animate-pulse rounded bg-white/10" />
              <div className="h-7 w-16 animate-pulse rounded bg-white/10" />
            </div>
            <div className="px-3 py-3">
              <div className="mb-1.5 h-2.5 w-6 animate-pulse rounded bg-white/10" />
              <div className="h-7 w-16 animate-pulse rounded bg-white/10" />
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
          {/* Output sockets skeleton */}
          {MARKET_OUTPUT_HANDLES.map((output) => (
            <div key={output.id} className="flex items-center justify-between border-t border-white/[0.06] px-3 py-1">
              <div className="h-2.5 w-14 animate-pulse rounded bg-white/10" />
              <div className="h-2.5 w-10 animate-pulse rounded bg-white/10" />
            </div>
          ))}
        </div>
      )}

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
              const slug = data.marketSlug?.trim();
              if (slug) fetchMarket(slug, marketInterval);
            }}
          >
            {">"} RETRY
          </button>
        </div>
      )}

      {fetchState.status === "loaded" && market && (
        <div className="relative">
          {/* Question — first section */}
          <div className="flex items-center gap-2.5 border-b border-white/10 px-3 py-3">
            {fetchState.event.image && (
              <img
                src={fetchState.event.image}
                alt=""
                className="size-7 shrink-0 rounded-sm object-cover"
              />
            )}
            <p className="text-[13px] font-bold leading-tight tracking-tight text-white/90">
              {market.question}
            </p>
          </div>

          {/* Outcome prices — click to select which feeds downstream */}
          <div className="grid grid-cols-2 border-b border-white/10">
            <div
              className={`relative cursor-pointer border-r border-white/10 px-3 py-3 transition-colors ${
                (data.marketOutcome ?? "yes") === "yes" ? "bg-[#d4602c]/10" : "hover:bg-white/[0.03]"
              }`}
              onClick={() => {
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === id ? { ...n, data: { ...n.data, marketOutcome: "yes" as const } } : n,
                  ),
                );
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-0.5 text-[8px] uppercase tracking-[0.3em] text-white/30">
                {market.outcomes[0] ?? "YES"}
              </div>
              <div className="text-[28px] font-bold leading-none tracking-tight text-[#d4602c]">
                {Math.round(yesPrice * 100)}<span className="text-[14px]">&cent;</span>
              </div>
            </div>
            <div
              className={`cursor-pointer px-3 py-3 transition-colors ${
                data.marketOutcome === "no" ? "bg-[#d4602c]/10" : "hover:bg-white/[0.03]"
              }`}
              onClick={() => {
                setNodes((nds) =>
                  nds.map((n) =>
                    n.id === id ? { ...n, data: { ...n.data, marketOutcome: "no" as const } } : n,
                  ),
                );
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-0.5 text-[8px] uppercase tracking-[0.3em] text-white/30">
                {market.outcomes[1] ?? "NO"}
              </div>
              <div className="text-[28px] font-bold leading-none tracking-tight text-white/60">
                {Math.round(noPrice * 100)}<span className="text-[14px]">&cent;</span>
              </div>
            </div>
          </div>

          {/* Price chart */}
          <div className="border-b border-white/10 px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[8px] uppercase tracking-[0.25em] text-white/25">PRICE HISTORY</span>
              <div className="nodrag flex gap-0.5">
                {MARKET_INTERVAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setMarketInterval(opt.key)}
                    className={`px-1.5 py-0.5 text-[8px] uppercase tracking-[0.2em] transition-colors ${
                      marketInterval === opt.key
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
            ) : history.length > 1 ? (
              <Sparkline data={history} width={314} height={92} />
            ) : (
              <div className="flex h-20 items-center justify-center">
                <span className="text-[8px] uppercase tracking-[0.25em] text-white/15">
                  {marketInterval === "live" ? "WAITING FOR TRADES" : "NO HISTORY"}
                </span>
              </div>
            )}
          </div>

          {/* Order book — collapsible */}
          <div className="border-b border-white/10">
            <button
              className="nodrag flex w-full items-center justify-between px-3 py-1.5 text-[8px] uppercase tracking-[0.25em] text-white/25 transition-colors hover:text-white/40"
              onClick={() => setBookOpen((o) => !o)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <span>ORDER BOOK</span>
              <ChevronDown
                className={`size-3 transition-transform ${bookOpen ? "rotate-180" : ""}`}
              />
            </button>
            {bookOpen && (
              <div className="nodrag px-3 pb-2.5">
                {!bookLevels ? (
                  <div className="flex h-12 items-center justify-center">
                    <span className="text-[8px] uppercase tracking-[0.25em] text-white/15">
                      LOADING
                    </span>
                  </div>
                ) : (
                  <div ref={bookScrollRef} className="nowheel relative max-h-[200px] overflow-y-auto overflow-x-hidden">
                    {/* Asks — reversed so highest ask at top, lowest ask nearest spread */}
                    <div className="space-y-px">
                      {[...bookLevels.asks].reverse().map((level, i, arr) => {
                        const depthIdx = arr.length - 1 - i;
                        return (
                          <div key={`a-${i}`} className="flex items-center gap-2 py-[2px]">
                            <span className="w-10 shrink-0 text-[9px] tabular-nums text-red-400/70">
                              {(level.price * 100).toFixed(1)}¢
                            </span>
                            <span className="w-14 shrink-0 text-right text-[9px] tabular-nums text-white/30">
                              {level.size.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                            <div className="relative h-3 min-w-0 flex-1 overflow-hidden">
                              <div
                                className="absolute inset-y-0 left-0 rounded-r-sm bg-red-500/15"
                                style={{ width: `${(bookLevels.askDepths[depthIdx]! / bookLevels.maxDepth) * 100}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Spread divider */}
                    <div ref={bookSpreadRef} className="flex items-center gap-2 py-1">
                      <div className="h-px flex-1 bg-white/[0.06]" />
                      <span className="text-[8px] font-bold tracking-[0.2em] text-white/25">
                        {bookLevels.asks[0] && bookLevels.bids[0]
                          ? `${((bookLevels.asks[0].price - bookLevels.bids[0].price) * 100).toFixed(1)}¢ SPREAD`
                          : "—"}
                      </span>
                      <div className="h-px flex-1 bg-white/[0.06]" />
                    </div>

                    {/* Bids — highest bid nearest spread, lowest at bottom */}
                    <div className="space-y-px">
                      {bookLevels.bids.map((level, i) => (
                        <div key={`b-${i}`} className="flex items-center gap-2 py-[2px]">
                          <span className="w-10 shrink-0 text-[9px] tabular-nums text-emerald-400/70">
                            {(level.price * 100).toFixed(1)}¢
                          </span>
                          <span className="w-14 shrink-0 text-right text-[9px] tabular-nums text-white/30">
                            {level.size.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                          <div className="relative h-3 min-w-0 flex-1 overflow-hidden">
                            <div
                              className="absolute inset-y-0 left-0 rounded-r-sm bg-emerald-500/15"
                              style={{ width: `${(bookLevels.bidDepths[i]! / bookLevels.maxDepth) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {/* Output sockets */}
      <div>
        {MARKET_OUTPUT_HANDLES.map((output) => {
          let value: string | undefined;
          if (fetchState.status === "loaded" && market) {
            switch (output.id) {
              case "price": {
                const sel = (data.marketOutcome ?? "yes") === "yes" ? yesPrice : noPrice;
                value = `${Math.round(sel * 100)}\u00a2`;
                break;
              }
              case "volume":
                value = formatCurrency(parseFloat(market.volume));
                break;
              case "liquidity":
                value = formatCurrency(parseFloat(market.liquidity));
                break;
              case "spread":
                value = `$${((liveBestAsk ?? market.bestAsk) - (liveBestBid ?? market.bestBid)).toFixed(3)}`;
                break;
              case "lastTrade":
                value = `${Math.round((yesPrice || market.lastTradePrice) * 100)}\u00a2`;
                break;
              case "imbalance": {
                const imb = nodeValues[`${id}:imbalance`];
                if (imb != null) value = `${(imb * 100).toFixed(1)}%`;
                break;
              }
            }
          }
          return (
            <div
              key={output.id}
              className="relative flex items-center justify-between border-t border-white/[0.06] px-3 py-1"
            >
              <span className="text-[9px] uppercase tracking-[0.15em] text-white/30">
                {output.label}
              </span>
              {value && (
                <span className="mr-3 text-[10px] font-medium tracking-[0.05em] text-white/50">
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

      {/* Active status */}
      {fetchState.status === "loaded" && market && (
        <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-1.5">
          {market.endDate && (
            <span className="text-[8px] uppercase tracking-[0.2em] text-white/25">
              {new Date(market.endDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              }).toUpperCase()}
            </span>
          )}
          <span
            className={`ml-auto flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] ${
              market.active && !market.closed
                ? "text-[#d4602c]"
                : "text-white/30"
            }`}
          >
            {market.active && !market.closed && (
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#d4602c] opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-[#d4602c]" />
              </span>
            )}
            {market.active && !market.closed ? "ACTIVE" : "CLOSED"}
          </span>
        </div>
      )}

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
