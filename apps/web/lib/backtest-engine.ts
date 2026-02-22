// Pure backtest simulation engine — no React, no I/O.

export type SimulatedTrade = {
  t: number;
  side: "buy" | "sell";
  tokenId: string;
  price: number;
  amount: number;
  pnl: number;
};

export type EquityPoint = {
  t: number;
  equity: number;
};

export type BacktestStats = {
  totalReturn: number;
  totalReturnPct: number;
  winRate: number;
  totalTrades: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
};

export type BacktestResult = {
  trades: SimulatedTrade[];
  equityCurve: EquityPoint[];
  stats: BacktestStats;
};

type PipelineNode = {
  id?: string;
  type: string;
  label?: string;
  marketSlug?: string;
  marketOutcome?: string;
  comparisonConfig?: {
    operator: string;
    thresholdA?: number;
    thresholdB?: number;
  };
  logicGateConfig?: { gateType: "and" | "or" | "nand" | "xor" };
  rateLimiterConfig?: { maxEvents: number; windowMs: number };
  action?: { verb: "buy" | "sell"; token_id: string; amount: number };
  inputs?: string[];
  outputs?: string[];
};

type PipelineEdge = {
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

type Pipeline = {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
};

type PriceBucket = {
  t: number;
  price: number;
  volume: number;
  trades: number;
};

type SlugTokenMap = Record<string, { yesTokenId: string; noTokenId: string; volume?: number; liquidity?: number }>;

// Topological sort of nodes using Kahn's algorithm
function topoSort(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineNode[] {
  const idToNode = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id!, 0);
    adj.set(n.id!, []);
  }

  for (const e of edges) {
    if (!adj.has(e.source) || !inDegree.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: PipelineNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = idToNode.get(id);
    if (node) sorted.push(node);
    for (const next of adj.get(id) ?? []) {
      const d = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  return sorted;
}

function applyComparison(op: string, a: number, b: number): boolean {
  switch (op) {
    case ">": return a > b;
    case "<": return a < b;
    case ">=": return a >= b;
    case "<=": return a <= b;
    case "==": return a === b;
    case "!=": return a !== b;
    default: return false;
  }
}

export function runBacktest(
  pipeline: Pipeline,
  priceHistory: Record<string, PriceBucket[]>,
  slugToTokens: SlugTokenMap,
  initialCapital: number,
): BacktestResult {
  const nodes = pipeline.nodes.filter((n) => n.id);
  const edges = pipeline.edges;
  const sortedNodes = topoSort(nodes, edges);

  // Build adjacency: target → source edges
  const incomingEdges = new Map<string, PipelineEdge[]>();
  for (const e of edges) {
    if (!incomingEdges.has(e.target)) incomingEdges.set(e.target, []);
    incomingEdges.get(e.target)!.push(e);
  }

  // Get all unique timestamps across all tokens (sorted)
  const allTimestamps = new Set<number>();
  for (const buckets of Object.values(priceHistory)) {
    for (const b of buckets) allTimestamps.add(b.t);
  }
  const timestamps = [...allTimestamps].sort((a, b) => a - b);

  if (timestamps.length === 0) {
    return {
      trades: [],
      equityCurve: [],
      stats: { totalReturn: 0, totalReturnPct: 0, winRate: 0, totalTrades: 0, maxDrawdown: 0, maxDrawdownPct: 0, sharpeRatio: 0 },
    };
  }

  // Map market node ID → tokenId + static metadata
  const nodeTokenMap = new Map<string, string>();
  const nodeMarketMeta = new Map<string, { volume: number; liquidity: number }>();
  for (const node of nodes) {
    if (node.type === "market" && node.marketSlug) {
      const tokens = slugToTokens[node.marketSlug];
      if (tokens) {
        nodeTokenMap.set(node.id!, node.marketOutcome === "no" ? tokens.noTokenId : tokens.yesTokenId);
        nodeMarketMeta.set(node.id!, {
          volume: tokens.volume ?? 0,
          liquidity: tokens.liquidity ?? 0,
        });
      }
    }
  }

  // Build price lookup: tokenId → timestamp → bucket
  const priceLookup = new Map<string, Map<number, PriceBucket>>();
  for (const [tokenId, buckets] of Object.entries(priceHistory)) {
    const map = new Map<number, PriceBucket>();
    for (const b of buckets) map.set(b.t, b);
    priceLookup.set(tokenId, map);
  }

  // Simulation state
  let cash = initialCapital;
  const positions = new Map<string, { qty: number; avgCost: number }>();
  const trades: SimulatedTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const returns: number[] = [];
  let prevEquity = initialCapital;

  // Rate limiter state per node
  const rateLimiterEvents = new Map<string, number[]>();

  // Track last known price per token for mark-to-market (carry forward when data is sparse)
  const lastKnownPrices = new Map<string, number>();

  for (const t of timestamps) {
    // Node values for this timestep
    const nodeValues = new Map<string, number>();
    const nodeBooleans = new Map<string, boolean>();

    // Current prices for all tokens at this timestamp
    const currentPrices = new Map<string, number>();
    for (const [tokenId, lookup] of priceLookup) {
      const bucket = lookup.get(t);
      if (bucket) {
        currentPrices.set(tokenId, bucket.price);
        lastKnownPrices.set(tokenId, bucket.price);
      }
    }

    for (const node of sortedNodes) {
      const nodeId = node.id!;

      if (node.type === "market" || node.type === "input") {
        // Set value from price data
        const tokenId = nodeTokenMap.get(nodeId);
        if (tokenId) {
          const bucket = priceLookup.get(tokenId)?.get(t);
          const price = currentPrices.get(tokenId);
          if (price !== undefined) {
            nodeValues.set(nodeId, price);
            nodeValues.set(`${nodeId}:price`, price);
            nodeValues.set(`${nodeId}:lastTrade`, price);
            // Volume from this bucket's trade data
            if (bucket) {
              nodeValues.set(`${nodeId}:volume`, bucket.volume);
            }
            // Liquidity from market metadata (static — not available per-bucket)
            const meta = nodeMarketMeta.get(nodeId);
            if (meta) {
              nodeValues.set(`${nodeId}:liquidity`, meta.liquidity);
            }
            // Spread not available in historical data
            nodeValues.set(`${nodeId}:spread`, 0);
          }
        }
        // For input nodes without a token (manual triggers), pass true as boolean
        if (!nodeTokenMap.has(nodeId) && node.type === "input") {
          nodeBooleans.set(nodeId, true);
          nodeValues.set(nodeId, 1);
        }
        continue;
      }

      if (node.type === "comparison") {
        const incoming = incomingEdges.get(nodeId) ?? [];
        const cfg = node.comparisonConfig;
        if (!cfg) continue;

        let inputA: number | undefined = cfg.thresholdA;
        let inputB: number | undefined = cfg.thresholdB;

        for (const e of incoming) {
          const sourceHandle = e.sourceHandle;
          const sourceKey = sourceHandle ? `${e.source}:${sourceHandle}` : e.source;
          const val = nodeValues.get(sourceKey) ?? nodeValues.get(e.source);
          if (val === undefined) continue;

          if (e.targetHandle === "input-a" && inputA === undefined) inputA = val;
          else if (e.targetHandle === "input-b" && inputB === undefined) inputB = val;
          else if (inputA === undefined) inputA = val;
          else if (inputB === undefined) inputB = val;
        }

        if (inputA !== undefined && inputB !== undefined) {
          const result = applyComparison(cfg.operator, inputA, inputB);
          nodeBooleans.set(nodeId, result);
        }
        continue;
      }

      // Decision nodes pass through the boolean from their upstream
      if (node.type === "decision") {
        const incoming = incomingEdges.get(nodeId) ?? [];
        for (const e of incoming) {
          const upstream = nodeBooleans.get(e.source);
          if (upstream !== undefined) {
            nodeBooleans.set(nodeId, upstream);
            // Also propagate numeric values
            const numVal = nodeValues.get(e.source);
            if (numVal !== undefined) nodeValues.set(nodeId, numVal);
            break;
          }
          // If upstream has a numeric value, treat it as truthy
          const numVal = nodeValues.get(e.source);
          if (numVal !== undefined) {
            nodeValues.set(nodeId, numVal);
            nodeBooleans.set(nodeId, true);
            break;
          }
        }
        continue;
      }

      if (node.type === "logic_gate") {
        const incoming = incomingEdges.get(nodeId) ?? [];
        const gateType = node.logicGateConfig?.gateType ?? "and";
        const boolInputs: boolean[] = [];

        for (const e of incoming) {
          const val = nodeBooleans.get(e.source);
          if (val !== undefined) boolInputs.push(val);
        }

        if (boolInputs.length > 0) {
          let gateResult: boolean;
          switch (gateType) {
            case "and": gateResult = boolInputs.every(Boolean); break;
            case "or": gateResult = boolInputs.some(Boolean); break;
            case "nand": gateResult = !boolInputs.every(Boolean); break;
            case "xor": gateResult = boolInputs.filter(Boolean).length === 1; break;
            default: gateResult = boolInputs.every(Boolean);
          }
          nodeBooleans.set(nodeId, gateResult);
        }
        continue;
      }

      if (node.type === "rate_limiter") {
        const incoming = incomingEdges.get(nodeId) ?? [];
        const cfg = node.rateLimiterConfig ?? { maxEvents: 5, windowMs: 60000 };

        // Pass through boolean from upstream
        let upstreamTrue = false;
        for (const e of incoming) {
          if (nodeBooleans.get(e.source)) upstreamTrue = true;
        }

        if (upstreamTrue) {
          if (!rateLimiterEvents.has(nodeId)) rateLimiterEvents.set(nodeId, []);
          const events = rateLimiterEvents.get(nodeId)!;
          const windowStart = t * 1000 - cfg.windowMs;
          // Remove expired events
          while (events.length > 0 && events[0]! < windowStart) events.shift();

          if (events.length < cfg.maxEvents) {
            events.push(t * 1000);
            nodeBooleans.set(nodeId, true);
          } else {
            nodeBooleans.set(nodeId, false);
          }
        } else {
          nodeBooleans.set(nodeId, false);
        }
        continue;
      }

      if (node.type === "output") {
        // Check if all upstream conditions are true
        const incoming = incomingEdges.get(nodeId) ?? [];
        const allTrue = incoming.length > 0 && incoming.every((e) => {
          return nodeBooleans.get(e.source) === true;
        });

        if (allTrue && node.action) {
          const { verb, token_id, amount } = node.action;
          // Use current price, or carry forward last known price for sparse data
          const price = currentPrices.get(token_id) ?? lastKnownPrices.get(token_id);

          if (price === undefined || price <= 0) continue;

          const qty = amount / price;

          if (verb === "buy" && cash >= amount) {
            cash -= amount;
            const pos = positions.get(token_id) ?? { qty: 0, avgCost: 0 };
            const totalCost = pos.avgCost * pos.qty + amount;
            pos.qty += qty;
            pos.avgCost = pos.qty > 0 ? totalCost / pos.qty : 0;
            positions.set(token_id, pos);

            trades.push({ t, side: "buy", tokenId: token_id, price, amount, pnl: 0 });
          } else if (verb === "sell") {
            const pos = positions.get(token_id);
            if (pos && pos.qty > 0) {
              const sellQty = Math.min(qty, pos.qty);
              const revenue = sellQty * price;
              const cost = sellQty * pos.avgCost;
              const pnl = revenue - cost;

              cash += revenue;
              pos.qty -= sellQty;
              if (pos.qty <= 0) positions.delete(token_id);

              trades.push({ t, side: "sell", tokenId: token_id, price, amount: revenue, pnl });
            }
          }
        }
        continue;
      }
    }

    // Compute mark-to-market equity (use last known price if no data this timestep)
    let positionValue = 0;
    for (const [tokenId, pos] of positions) {
      const price = currentPrices.get(tokenId) ?? lastKnownPrices.get(tokenId) ?? 0;
      positionValue += pos.qty * price;
    }
    const equity = cash + positionValue;
    equityCurve.push({ t, equity });

    if (prevEquity > 0) {
      returns.push((equity - prevEquity) / prevEquity);
    }
    prevEquity = equity;
  }

  // Compute stats
  const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? initialCapital;
  const totalReturn = finalEquity - initialCapital;
  const totalReturnPct = initialCapital > 0 ? (totalReturn / initialCapital) * 100 : 0;

  const winningTrades = trades.filter((t) => t.side === "sell" && t.pnl > 0).length;
  const closedTrades = trades.filter((t) => t.side === "sell").length;
  const winRate = closedTrades > 0 ? (winningTrades / closedTrades) * 100 : 0;

  // Max drawdown
  let peak = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const ep of equityCurve) {
    if (ep.equity > peak) peak = ep.equity;
    const dd = peak - ep.equity;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = ddPct;
    }
  }

  // Sharpe ratio (annualized, assuming ~252 trading days)
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  return {
    trades,
    equityCurve,
    stats: {
      totalReturn,
      totalReturnPct,
      winRate,
      totalTrades: trades.length,
      maxDrawdown,
      maxDrawdownPct,
      sharpeRatio,
    },
  };
}
