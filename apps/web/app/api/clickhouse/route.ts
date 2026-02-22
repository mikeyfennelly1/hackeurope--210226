import { NextRequest, NextResponse } from "next/server";
import { getClickHouseClient } from "@/lib/clickhouse";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, ...params } = body;

    switch (type) {
      case "market_lookup":
        return NextResponse.json(await handleMarketLookup(params));
      case "price_history":
        return NextResponse.json(await handlePriceHistory(params));
      case "signals":
        return NextResponse.json(await handleSignals(params));
      case "backtest":
        return NextResponse.json(await handleBacktest(params));
      default:
        return NextResponse.json({ error: `Unknown query type: ${type}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// --- Market Lookup: resolve slug → token IDs ---

async function handleMarketLookup({ slugs }: { slugs: string[] }) {
  const ch = getClickHouseClient();
  const result = await ch.query({
    query: `
      SELECT
        slug,
        event_slug,
        condition_id,
        question,
        clob_token_ids,
        outcome_prices,
        outcomes,
        volume,
        liquidity
      FROM market_metadata
      WHERE slug IN ({slugs:Array(String)})
         OR event_slug IN ({slugs:Array(String)})
    `,
    query_params: { slugs },
    format: "JSONEachRow",
  });
  const rows = await result.json<{
    slug: string;
    event_slug: string;
    condition_id: string;
    question: string;
    clob_token_ids: string[];
    outcome_prices: number[];
    outcomes: string[];
    volume: number;
    liquidity: number;
  }>();
  return { markets: rows };
}

// --- Price History: bucketed price series for token(s) ---

function getBucketSeconds(startTs: number, endTs: number): number {
  const range = endTs - startTs;
  if (range < 86400) return 60;          // < 1 day → 1 min
  if (range < 7 * 86400) return 300;     // < 7 days → 5 min
  if (range < 30 * 86400) return 3600;   // < 30 days → 1 hour
  return 14400;                           // 30+ days → 4 hours
}

// Finer-grained buckets for backtesting — we want more evaluation points
function getBacktestBucketSeconds(startTs: number, endTs: number): number {
  const range = endTs - startTs;
  if (range < 86400) return 60;            // < 1 day → 1 min
  if (range < 7 * 86400) return 60;        // < 7 days → 1 min
  if (range < 30 * 86400) return 300;      // < 30 days → 5 min
  if (range < 90 * 86400) return 900;      // < 3 months → 15 min
  return 3600;                              // 3+ months → 1 hour
}

async function handlePriceHistory({
  tokenIds,
  startTs,
  endTs,
  bucketOverride,
}: {
  tokenIds: string[];
  startTs: number;
  endTs: number;
  bucketOverride?: number;
}) {
  const ch = getClickHouseClient();
  const bucket = bucketOverride ?? getBucketSeconds(startTs, endTs);

  const result = await ch.query({
    query: `
      SELECT
        token_id,
        intDiv(timestamp, {bucket:UInt64}) * {bucket:UInt64} AS bucket_ts,
        avg(price) AS avg_price,
        sum(usdc_amount) AS total_volume,
        count() AS trade_count
      FROM trader_trades
      WHERE token_id IN ({tokenIds:Array(String)})
        AND timestamp >= {startTs:UInt64}
        AND timestamp <= {endTs:UInt64}
      GROUP BY token_id, bucket_ts
      ORDER BY token_id, bucket_ts
    `,
    query_params: { tokenIds, startTs, endTs, bucket },
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    token_id: string;
    bucket_ts: string;
    avg_price: string;
    total_volume: string;
    trade_count: string;
  }>();

  // Group by token
  const byToken: Record<string, { t: number; price: number; volume: number; trades: number }[]> = {};
  for (const row of rows) {
    const tokenId = row.token_id;
    if (!byToken[tokenId]) byToken[tokenId] = [];
    byToken[tokenId].push({
      t: Number(row.bucket_ts),
      price: Number(row.avg_price),
      volume: Number(row.total_volume),
      trades: Number(row.trade_count),
    });
  }

  return { priceHistory: byToken, bucketSeconds: bucket };
}

// --- Signals: aggregated analytics for a token ---

async function handleSignals({
  tokenId,
  windowSeconds,
}: {
  tokenId: string;
  windowSeconds: number;
}) {
  const ch = getClickHouseClient();

  // Find the most recent trade timestamp for this token (data may be stale)
  const latestResult = await ch.query({
    query: `
      SELECT max(timestamp) AS latest
      FROM trader_trades
      WHERE token_id = {tokenId:String}
    `,
    query_params: { tokenId },
    format: "JSONEachRow",
  });
  const latestRows = await latestResult.json<{ latest: string }>();
  const latestTs = Number(latestRows[0]?.latest) || Math.floor(Date.now() / 1000);
  const startTs = latestTs - windowSeconds;

  const result = await ch.query({
    query: `
      SELECT
        countIf(is_buy = true) AS buy_count,
        countIf(is_buy = false) AS sell_count,
        sum(usdc_amount) AS total_volume,
        sum(price * usdc_amount) / sum(usdc_amount) AS vwap,
        stddevPop(price) AS volatility,
        count() AS trade_count,
        max(timestamp) - min(timestamp) AS time_span
      FROM trader_trades
      WHERE token_id = {tokenId:String}
        AND timestamp >= {startTs:UInt64}
        AND timestamp <= {latestTs:UInt64}
    `,
    query_params: { tokenId, startTs, latestTs },
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    buy_count: string;
    sell_count: string;
    total_volume: string;
    vwap: string;
    volatility: string;
    trade_count: string;
    time_span: string;
  }>();

  const row = rows[0];
  if (!row) {
    return { buyVolRatio: 0, tradeFreq: 0, vwap: 0, volatility: 0 };
  }

  const buyCount = Number(row.buy_count);
  const sellCount = Number(row.sell_count);
  const timeSpanHours = Number(row.time_span) / 3600 || 1;

  return {
    buyVolRatio: sellCount > 0 ? buyCount / sellCount : buyCount > 0 ? Infinity : 0,
    tradeFreq: Number(row.trade_count) / timeSpanHours,
    vwap: Number(row.vwap),
    volatility: Number(row.volatility),
  };
}

// --- Backtest: run pipeline simulation ---

async function handleBacktest({
  pipeline,
  startDate,
  endDate,
  initialCapital,
}: {
  pipeline: unknown;
  startDate: string;
  endDate: string;
  initialCapital: number;
}) {
  // Dynamic import to keep this route file manageable
  const { runBacktest } = await import("@/lib/backtest-engine");

  const startTs = Math.floor(new Date(startDate).getTime() / 1000);
  const endTs = Math.floor(new Date(endDate).getTime() / 1000);

  // Extract market slugs from the pipeline's market nodes
  const bp = pipeline as {
    nodes: Array<{
      id?: string;
      type: string;
      marketSlug?: string;
      marketOutcome?: string;
      marketIndex?: number;
    }>;
    edges: Array<{
      source: string;
      target: string;
      sourceHandle?: string;
      targetHandle?: string;
    }>;
  };

  const marketNodes = bp.nodes.filter(
    (n) => n.type === "market" && n.marketSlug,
  );

  if (marketNodes.length === 0) {
    return { error: "No market nodes with slugs found in pipeline" };
  }

  // Resolve token IDs via Gamma API (same path as the live market node)
  // This ensures we get the same sub-market ordering as the UI
  type TokenEntry = { yesTokenId: string; noTokenId: string; volume?: number; liquidity?: number };
  const slugToTokens: Record<string, TokenEntry> = {};
  const allTokenIds: string[] = [];

  const uniqueSlugs = [...new Set(marketNodes.map((n) => n.marketSlug!))];

  for (const slug of uniqueSlugs) {
    const gammaRes = await fetch(
      `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`,
    );
    if (!gammaRes.ok) continue;
    const events = (await gammaRes.json()) as Array<{
      markets: Array<{
        active: boolean;
        closed: boolean;
        clobTokenIds: string | string[];
        outcomes: string | string[];
        volume: string;
        liquidity: string;
      }>;
    }>;
    if (!events.length) continue;
    const event = events[0]!;

    // Filter to active markets (same as market-node.tsx)
    const activeMarkets = event.markets.filter((m) => m.active && !m.closed);

    // Resolve each market node using this event
    for (const node of marketNodes) {
      if (node.marketSlug !== slug) continue;
      const idx = node.marketIndex ?? 0;
      const market = activeMarkets[idx] ?? activeMarkets[0];
      if (!market) continue;

      const tokenIds = typeof market.clobTokenIds === "string"
        ? (JSON.parse(market.clobTokenIds) as string[])
        : market.clobTokenIds;
      const outcomes = typeof market.outcomes === "string"
        ? (JSON.parse(market.outcomes) as string[])
        : market.outcomes;
      const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
      const noIdx = yesIdx === 0 ? 1 : 0;
      const entry: TokenEntry = {
        yesTokenId: tokenIds[yesIdx >= 0 ? yesIdx : 0]!,
        noTokenId: tokenIds[noIdx]!,
        volume: parseFloat(market.volume) || 0,
        liquidity: parseFloat(market.liquidity) || 0,
      };

      // Map the slug to this specific entry (so the engine can find it)
      slugToTokens[slug] = entry;

      const tokenId = node.marketOutcome === "no" ? entry.noTokenId : entry.yesTokenId;
      if (!allTokenIds.includes(tokenId)) allTokenIds.push(tokenId);
    }
  }

  // Also collect token IDs from output node actions (they may reference
  // a different token than the market data source)
  for (const node of bp.nodes) {
    if (node.type === "output") {
      const action = (node as { action?: { token_id?: string } }).action;
      if (action?.token_id && !allTokenIds.includes(action.token_id)) {
        allTokenIds.push(action.token_id);
      }
    }
  }

  if (allTokenIds.length === 0) {
    return { error: "Could not resolve any token IDs from market slugs" };
  }

  // Fetch price history with finer-grained buckets for backtesting
  const backtestBucket = getBacktestBucketSeconds(startTs, endTs);
  const priceResult = await handlePriceHistory({
    tokenIds: allTokenIds,
    startTs,
    endTs,
    bucketOverride: backtestBucket,
  });

  // Run simulation
  const result = runBacktest(
    bp,
    priceResult.priceHistory,
    slugToTokens,
    initialCapital,
  );

  return result;
}
