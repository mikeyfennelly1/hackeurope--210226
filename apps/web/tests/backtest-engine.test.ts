import { describe, it, expect } from "vitest";
import { runBacktest } from "../lib/backtest-engine";

// Helper to build a simple pipeline: Market → Comparison → Output
function simplePipeline(opts: {
  operator?: string;
  thresholdB?: number;
  verb?: "buy" | "sell";
  tokenId?: string;
  amount?: number;
  marketOutcome?: string;
}) {
  const tokenId = opts.tokenId ?? "token-yes";
  return {
    nodes: [
      {
        id: "market-1",
        type: "market",
        marketSlug: "test-market",
        marketOutcome: opts.marketOutcome ?? "yes",
      },
      {
        id: "comp-1",
        type: "comparison",
        comparisonConfig: {
          operator: opts.operator ?? ">",
          thresholdB: opts.thresholdB ?? 0.5,
        },
      },
      {
        id: "output-1",
        type: "output",
        action: {
          verb: opts.verb ?? "buy",
          token_id: tokenId,
          amount: opts.amount ?? 100,
        },
      },
    ],
    edges: [
      { source: "market-1", target: "comp-1", targetHandle: "input-a" },
      { source: "comp-1", target: "output-1" },
    ],
  };
}

function makeSlugMap(tokenId = "token-yes") {
  return {
    "test-market": {
      yesTokenId: tokenId,
      noTokenId: "token-no",
      volume: 1_000_000,
      liquidity: 100_000,
    },
  };
}

function makePriceHistory(
  tokenId: string,
  prices: number[],
  startTs = 1000,
  step = 60,
) {
  return {
    [tokenId]: prices.map((price, i) => ({
      t: startTs + i * step,
      price,
      volume: 1000,
      trades: 10,
    })),
  };
}

describe("runBacktest", () => {
  it("returns empty result with no price data", () => {
    const pipeline = simplePipeline({});
    const result = runBacktest(pipeline, {}, makeSlugMap(), 10_000);

    expect(result.trades).toHaveLength(0);
    expect(result.equityCurve).toHaveLength(0);
    expect(result.stats.totalTrades).toBe(0);
  });

  it("generates buy trades when comparison condition is met", () => {
    const pipeline = simplePipeline({ operator: ">", thresholdB: 0.5 });
    // Prices: 0.3, 0.6, 0.8 — last two should trigger buys
    const prices = makePriceHistory("token-yes", [0.3, 0.6, 0.8]);
    const result = runBacktest(pipeline, prices, makeSlugMap(), 10_000);

    expect(result.trades.length).toBeGreaterThanOrEqual(2);
    expect(result.trades.every((t) => t.side === "buy")).toBe(true);
    expect(result.trades[0]!.price).toBe(0.6);
    expect(result.trades[1]!.price).toBe(0.8);
  });

  it("does not trade when condition is never met", () => {
    const pipeline = simplePipeline({ operator: ">", thresholdB: 0.9 });
    // All prices below 0.9
    const prices = makePriceHistory("token-yes", [0.1, 0.2, 0.5, 0.7]);
    const result = runBacktest(pipeline, prices, makeSlugMap(), 10_000);

    expect(result.trades).toHaveLength(0);
    expect(result.stats.totalReturn).toBe(0);
  });

  it("tracks equity correctly across buy trades", () => {
    const pipeline = simplePipeline({
      operator: ">",
      thresholdB: 0.5,
      amount: 100,
    });
    // Single price above threshold
    const prices = makePriceHistory("token-yes", [0.8]);
    const result = runBacktest(pipeline, prices, makeSlugMap(), 10_000);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.amount).toBe(100);
    // Cash should decrease by 100, but equity stays ~10000 (position valued at market)
    expect(result.equityCurve).toHaveLength(1);
    const equity = result.equityCurve[0]!.equity;
    expect(equity).toBeCloseTo(10_000, 0);
  });

  it("stops buying when cash runs out", () => {
    const pipeline = simplePipeline({
      operator: ">",
      thresholdB: 0.1,
      amount: 5000,
    });
    // Many prices above threshold — should only buy twice with $10K capital
    const prices = makePriceHistory(
      "token-yes",
      [0.5, 0.5, 0.5, 0.5, 0.5],
    );
    const result = runBacktest(pipeline, prices, makeSlugMap(), 10_000);

    expect(result.trades).toHaveLength(2);
  });

  it("handles sell actions", () => {
    // First pipeline: buy
    const buyPipeline = {
      nodes: [
        { id: "market-1", type: "market", marketSlug: "test-market" },
        {
          id: "comp-buy",
          type: "comparison",
          comparisonConfig: { operator: "<", thresholdB: 0.5 },
        },
        {
          id: "out-buy",
          type: "output",
          action: { verb: "buy" as const, token_id: "token-yes", amount: 100 },
        },
        {
          id: "comp-sell",
          type: "comparison",
          comparisonConfig: { operator: ">", thresholdB: 0.8 },
        },
        {
          id: "out-sell",
          type: "output",
          action: {
            verb: "sell" as const,
            token_id: "token-yes",
            amount: 100,
          },
        },
      ],
      edges: [
        { source: "market-1", target: "comp-buy", targetHandle: "input-a" },
        { source: "comp-buy", target: "out-buy" },
        { source: "market-1", target: "comp-sell", targetHandle: "input-a" },
        { source: "comp-sell", target: "out-sell" },
      ],
    };
    // Buy at 0.3, then sell at 0.9 → profit
    const prices = makePriceHistory("token-yes", [0.3, 0.9]);
    const result = runBacktest(
      buyPipeline,
      prices,
      makeSlugMap(),
      10_000,
    );

    const buys = result.trades.filter((t) => t.side === "buy");
    const sells = result.trades.filter((t) => t.side === "sell");
    expect(buys).toHaveLength(1);
    expect(sells).toHaveLength(1);
    expect(sells[0]!.pnl).toBeGreaterThan(0); // profitable trade
  });

  it("handles logic gate (AND) with two comparisons", () => {
    const pipeline = {
      nodes: [
        { id: "market-1", type: "market", marketSlug: "test-market" },
        {
          id: "comp-price",
          type: "comparison",
          comparisonConfig: { operator: ">", thresholdB: 0.5 },
        },
        {
          id: "comp-vol",
          type: "comparison",
          comparisonConfig: { operator: ">", thresholdA: 500, thresholdB: 100 },
        },
        {
          id: "and-gate",
          type: "logic_gate",
          logicGateConfig: { gateType: "and" as const },
        },
        {
          id: "output-1",
          type: "output",
          action: { verb: "buy" as const, token_id: "token-yes", amount: 100 },
        },
      ],
      edges: [
        {
          source: "market-1",
          target: "comp-price",
          targetHandle: "input-a",
        },
        { source: "comp-price", target: "and-gate" },
        { source: "comp-vol", target: "and-gate" },
        { source: "and-gate", target: "output-1" },
      ],
    };
    // comp-vol is 500 > 100 → always true
    // comp-price needs market price > 0.5
    const prices = makePriceHistory("token-yes", [0.3, 0.7]);
    const result = runBacktest(pipeline, prices, makeSlugMap(), 10_000);

    // Only second timestep triggers (0.7 > 0.5 AND 500 > 100)
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.price).toBe(0.7);
  });

  it("sets per-handle values (volume, liquidity)", () => {
    // Comparison on liquidity handle
    const pipeline = {
      nodes: [
        { id: "market-1", type: "market", marketSlug: "test-market" },
        {
          id: "comp-liq",
          type: "comparison",
          comparisonConfig: { operator: ">", thresholdB: 50_000 },
        },
        {
          id: "output-1",
          type: "output",
          action: { verb: "buy" as const, token_id: "token-yes", amount: 100 },
        },
      ],
      edges: [
        {
          source: "market-1",
          target: "comp-liq",
          sourceHandle: "liquidity",
          targetHandle: "input-a",
        },
        { source: "comp-liq", target: "output-1" },
      ],
    };
    // slugMap liquidity = 100,000 > 50,000 → should always be true
    const prices = makePriceHistory("token-yes", [0.5, 0.6]);
    const result = runBacktest(pipeline, prices, makeSlugMap(), 10_000);

    expect(result.trades).toHaveLength(2);
  });

  it("uses correct token for 'no' outcome", () => {
    const pipeline = simplePipeline({
      operator: ">",
      thresholdB: 0.5,
      tokenId: "token-no",
      marketOutcome: "no",
    });
    const slugMap = makeSlugMap();
    // Price data keyed by the NO token
    const prices = makePriceHistory("token-no", [0.8]);
    const result = runBacktest(pipeline, prices, slugMap, 10_000);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.tokenId).toBe("token-no");
  });

  it("computes stats correctly", () => {
    const pipeline = {
      nodes: [
        { id: "market-1", type: "market", marketSlug: "test-market" },
        {
          id: "comp-buy",
          type: "comparison",
          comparisonConfig: { operator: "<", thresholdB: 0.5 },
        },
        {
          id: "out-buy",
          type: "output",
          action: { verb: "buy" as const, token_id: "token-yes", amount: 1000 },
        },
        {
          id: "comp-sell",
          type: "comparison",
          comparisonConfig: { operator: ">", thresholdB: 0.7 },
        },
        {
          id: "out-sell",
          type: "output",
          action: {
            verb: "sell" as const,
            token_id: "token-yes",
            amount: 10000,
          },
        },
      ],
      edges: [
        { source: "market-1", target: "comp-buy", targetHandle: "input-a" },
        { source: "comp-buy", target: "out-buy" },
        { source: "market-1", target: "comp-sell", targetHandle: "input-a" },
        { source: "comp-sell", target: "out-sell" },
      ],
    };
    // Buy at 0.4, sell at 0.8 → 100% gain on the trade
    const prices = makePriceHistory("token-yes", [0.4, 0.8]);
    const result = runBacktest(pipeline, prices, makeSlugMap(), 10_000);

    expect(result.stats.totalTrades).toBeGreaterThan(0);
    expect(result.stats.totalReturn).toBeGreaterThan(0);
    expect(result.stats.totalReturnPct).toBeGreaterThan(0);
    expect(result.stats.winRate).toBe(100);
  });

  it("handles rate limiter node", () => {
    const pipeline = {
      nodes: [
        { id: "market-1", type: "market", marketSlug: "test-market" },
        {
          id: "comp-1",
          type: "comparison",
          comparisonConfig: { operator: ">", thresholdB: 0.1 },
        },
        {
          id: "rate-1",
          type: "rate_limiter",
          rateLimiterConfig: { maxEvents: 2, windowMs: 300_000 },
        },
        {
          id: "output-1",
          type: "output",
          action: { verb: "buy" as const, token_id: "token-yes", amount: 100 },
        },
      ],
      edges: [
        { source: "market-1", target: "comp-1", targetHandle: "input-a" },
        { source: "comp-1", target: "rate-1" },
        { source: "rate-1", target: "output-1" },
      ],
    };
    // 5 prices all above threshold, but rate limiter allows max 2
    const prices = makePriceHistory("token-yes", [0.5, 0.5, 0.5, 0.5, 0.5]);
    const result = runBacktest(pipeline, prices, makeSlugMap(), 10_000);

    expect(result.trades).toHaveLength(2);
  });

  it("handles output node buying a different token than the market tracks", () => {
    // Market tracks "token-yes" but output buys "other-token"
    const pipeline = simplePipeline({
      operator: ">",
      thresholdB: 0.5,
      tokenId: "other-token",
      amount: 100,
    });
    const prices = {
      "token-yes": [{ t: 1000, price: 0.8, volume: 1000, trades: 10 }],
      "other-token": [{ t: 1000, price: 0.5, volume: 500, trades: 5 }],
    };
    const result = runBacktest(pipeline, prices, makeSlugMap(), 10_000);

    // Should buy at other-token's price, not the market token's price
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.price).toBe(0.5);
    // Position valued correctly — equity should be ~10000
    expect(result.equityCurve[0]!.equity).toBeCloseTo(10_000, 0);
  });

  it("carries forward last known price for mark-to-market", () => {
    // Market has data at t=1000, output token only has data at t=1000 but not t=1060
    const pipeline = simplePipeline({
      operator: ">",
      thresholdB: 0.5,
      tokenId: "other-token",
      amount: 100,
    });
    const prices = {
      "token-yes": [
        { t: 1000, price: 0.8, volume: 1000, trades: 10 },
        { t: 1060, price: 0.9, volume: 1000, trades: 10 },
      ],
      "other-token": [
        { t: 1000, price: 0.5, volume: 500, trades: 5 },
        // No data at t=1060 — should carry forward 0.5
      ],
    };
    const result = runBacktest(pipeline, prices, makeSlugMap(), 10_000);

    expect(result.trades).toHaveLength(2);
    // At t=1060, position should be valued using carried-forward price (0.5), not 0
    const lastEquity = result.equityCurve[result.equityCurve.length - 1]!.equity;
    expect(lastEquity).toBeGreaterThan(9_000); // not crashed to near-0
  });
});
