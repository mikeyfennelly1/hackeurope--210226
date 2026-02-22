"use client";

import { useState } from "react";
import { Loader2, X, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Blueprint } from "@repo/backend/blueprints";
import type { BacktestResult } from "@/lib/backtest-engine";

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function formatDateTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatCurrency(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (Math.abs(val) >= 1_000) return `$${(val / 1_000).toFixed(2)}K`;
  return `$${val.toFixed(2)}`;
}

// --- Equity Curve SVG ---

function EquityCurve({
  result,
  width,
  height,
}: {
  result: BacktestResult;
  width: number;
  height: number;
}) {
  const { equityCurve, trades } = result;
  if (equityCurve.length < 2) return null;

  const equities = equityCurve.map((e) => e.equity);
  const min = Math.min(...equities);
  const max = Math.max(...equities);
  const range = max - min || 1;

  const yAxisW = 36;
  const xAxisH = 14;
  const pad = 4;
  const chartW = width - yAxisW - pad;
  const chartH = height - xAxisH - pad * 2;

  const startT = equityCurve[0]!.t;
  const endT = equityCurve[equityCurve.length - 1]!.t;
  const tRange = endT - startT || 1;

  const toX = (t: number) => yAxisW + ((t - startT) / tRange) * chartW;
  const toY = (equity: number) => pad + chartH - ((equity - min) / range) * chartH;

  const linePoints = equityCurve.map((e) => `${toX(e.t)},${toY(e.equity)}`).join(" ");

  const fillPoints = [
    `${yAxisW},${pad + chartH}`,
    ...equityCurve.map((e) => `${toX(e.t)},${toY(e.equity)}`),
    `${toX(endT)},${pad + chartH}`,
  ].join(" ");

  const finalEquity = equities[equities.length - 1]!;
  const firstEquity = equities[0]!;
  const trending = finalEquity >= firstEquity;

  // Grid lines (3 horizontal)
  const gridLines = [0.25, 0.5, 0.75].map((frac) => {
    const y = pad + chartH * (1 - frac);
    const val = min + range * frac;
    return { y, label: formatCurrency(val) };
  });

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={trending ? "#d4602c" : "#c45c5c"} stopOpacity="0.2" />
          <stop offset="100%" stopColor={trending ? "#d4602c" : "#c45c5c"} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {gridLines.map((gl, i) => (
        <g key={i}>
          <line x1={yAxisW} y1={gl.y} x2={width - pad} y2={gl.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x={yAxisW - 3} y={gl.y + 3} textAnchor="end" fill="rgba(255,255,255,0.2)" style={{ fontSize: 7, fontFamily: "var(--font-geist-mono)" }}>
            {gl.label}
          </text>
        </g>
      ))}

      {/* X-axis labels */}
      <text x={yAxisW} y={height - 1} textAnchor="start" fill="rgba(255,255,255,0.2)" style={{ fontSize: 7, fontFamily: "var(--font-geist-mono)" }}>
        {formatDate(startT)}
      </text>
      <text x={width - pad} y={height - 1} textAnchor="end" fill="rgba(255,255,255,0.2)" style={{ fontSize: 7, fontFamily: "var(--font-geist-mono)" }}>
        {formatDate(endT)}
      </text>

      {/* Fill + Line */}
      <polygon points={fillPoints} fill="url(#equity-fill)" />
      <polyline
        points={linePoints}
        fill="none"
        stroke={trending ? "#d4602c" : "#c45c5c"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Trade markers */}
      {trades.map((trade, i) => {
        const x = toX(trade.t);
        // Find nearest equity for y position
        const nearest = equityCurve.reduce((best, e) =>
          Math.abs(e.t - trade.t) < Math.abs(best.t - trade.t) ? e : best,
        );
        const y = toY(nearest.equity);
        const isBuy = trade.side === "buy";
        return (
          <polygon
            key={i}
            points={
              isBuy
                ? `${x},${y + 4} ${x - 3},${y + 8} ${x + 3},${y + 8}`
                : `${x},${y - 4} ${x - 3},${y - 8} ${x + 3},${y - 8}`
            }
            fill={isBuy ? "#22c55e" : "#ef4444"}
            opacity={0.7}
          />
        );
      })}

      {/* End dot */}
      <circle
        cx={toX(endT)}
        cy={toY(finalEquity)}
        r="3"
        fill={trending ? "#d4602c" : "#c45c5c"}
      />
    </svg>
  );
}

// --- Stat Card ---

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <div className="text-[7px] uppercase tracking-[0.3em] text-white/25">{label}</div>
      <div className={`mt-0.5 text-[13px] font-bold tabular-nums ${color ?? "text-white/80"}`}>
        {value}
      </div>
    </div>
  );
}

// --- Main Panel ---

export function BacktestPanel({
  blueprint,
  onClose,
}: {
  blueprint: Blueprint;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState("2025-01-01");
  const [endDate, setEndDate] = useState("2026-03-01");
  const [capital, setCapital] = useState(10000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runBacktest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const resp = await fetch("/api/clickhouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "backtest",
          pipeline: blueprint,
          startDate,
          endDate,
          initialCapital: capital,
        }),
      });

      const data = await resp.json();

      if (data.error) {
        setError(data.error);
      } else {
        setResult(data as BacktestResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run backtest");
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="relative z-10 flex w-[360px] shrink-0 flex-col border-l border-white/10 bg-[#0a0a0a] font-[family-name:var(--font-geist-mono)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-[#d4602c]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">
            Backtest
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-white/30 transition-colors hover:text-white/60"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Config Section */}
        <div className="space-y-3 border-b border-white/10 px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[8px] uppercase tracking-[0.3em] text-white/30">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-white/10 bg-[#111314] px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-[#d4602c]/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-[8px] uppercase tracking-[0.3em] text-white/30">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full border border-white/10 bg-[#111314] px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-[#d4602c]/50"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[8px] uppercase tracking-[0.3em] text-white/30">
              Initial Capital ($)
            </label>
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
              className="w-full border border-white/10 bg-[#111314] px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-[#d4602c]/50"
            />
          </div>
          <Button
            className="w-full"
            size="sm"
            onClick={runBacktest}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <TrendingUp className="size-3" />
                Run Backtest
              </>
            )}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="border-b border-white/10 px-4 py-3">
            <div className="border border-[#c45c5c]/30 bg-[#c45c5c]/5 px-3 py-2">
              <span className="text-[9px] uppercase tracking-[0.2em] text-[#c45c5c]">
                {error}
              </span>
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Stats Grid */}
            <div className="border-b border-white/10 px-4 py-4">
              <div className="mb-2 text-[8px] uppercase tracking-[0.3em] text-white/25">
                Performance
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <StatCard
                  label="Return"
                  value={`${result.stats.totalReturnPct >= 0 ? "+" : ""}${result.stats.totalReturnPct.toFixed(1)}%`}
                  color={result.stats.totalReturnPct >= 0 ? "text-emerald-400" : "text-[#c45c5c]"}
                />
                <StatCard
                  label="Win Rate"
                  value={`${result.stats.winRate.toFixed(0)}%`}
                />
                <StatCard
                  label="Trades"
                  value={`${result.stats.totalTrades}`}
                />
                <StatCard
                  label="Drawdown"
                  value={`-${result.stats.maxDrawdownPct.toFixed(1)}%`}
                  color="text-[#c45c5c]"
                />
                <StatCard
                  label="Sharpe"
                  value={result.stats.sharpeRatio.toFixed(2)}
                />
                <StatCard
                  label="P&L"
                  value={formatCurrency(result.stats.totalReturn)}
                  color={result.stats.totalReturn >= 0 ? "text-emerald-400" : "text-[#c45c5c]"}
                />
              </div>
            </div>

            {/* Equity Curve */}
            {result.equityCurve.length > 1 && (
              <div className="border-b border-white/10 px-4 py-4">
                <div className="mb-2 text-[8px] uppercase tracking-[0.3em] text-white/25">
                  Equity Curve
                </div>
                <EquityCurve result={result} width={328} height={160} />
              </div>
            )}

            {/* Trade Log */}
            {result.trades.length > 0 && (
              <div className="border-b border-white/10 px-4 py-4">
                <div className="mb-2 text-[8px] uppercase tracking-[0.3em] text-white/25">
                  Trade Log ({result.trades.length})
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-[9px]">
                    <thead>
                      <tr className="text-left text-white/25">
                        <th className="pb-1 pr-2 font-normal">Time</th>
                        <th className="pb-1 pr-2 font-normal">Side</th>
                        <th className="pb-1 pr-2 font-normal text-right">Price</th>
                        <th className="pb-1 font-normal text-right">P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.map((trade, i) => (
                        <tr key={i} className="border-t border-white/[0.04]">
                          <td className="py-1 pr-2 text-white/40 tabular-nums">
                            {formatDateTime(trade.t)}
                          </td>
                          <td className="py-1 pr-2">
                            <span className={`flex items-center gap-0.5 font-bold uppercase ${
                              trade.side === "buy" ? "text-emerald-400" : "text-[#c45c5c]"
                            }`}>
                              {trade.side === "buy" ? (
                                <TrendingUp className="size-2.5" />
                              ) : (
                                <TrendingDown className="size-2.5" />
                              )}
                              {trade.side}
                            </span>
                          </td>
                          <td className="py-1 pr-2 text-right text-white/50 tabular-nums">
                            {(trade.price * 100).toFixed(1)}&cent;
                          </td>
                          <td className={`py-1 text-right tabular-nums ${
                            trade.pnl > 0 ? "text-emerald-400" : trade.pnl < 0 ? "text-[#c45c5c]" : "text-white/30"
                          }`}>
                            {trade.side === "sell" ? (trade.pnl >= 0 ? "+" : "") + formatCurrency(trade.pnl) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}


          </>
        )}
      </div>
    </aside>
  );
}
