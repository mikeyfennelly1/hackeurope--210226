import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Binance public API — no auth required, generous rate limits
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol = searchParams.get("symbol"); // e.g. "BTCUSDT"
  const type = searchParams.get("type") ?? "price";

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol parameter" }, { status: 400 });
  }

  const sym = symbol.toUpperCase();

  try {
    // Aggregated trades for the last N seconds (for live view seeding)
    if (type === "trades") {
      const seconds = parseInt(searchParams.get("seconds") ?? "60", 10);
      const startTime = Date.now() - seconds * 1000;
      const res = await fetch(
        `https://api.binance.com/api/v3/aggTrades?symbol=${encodeURIComponent(sym)}&startTime=${startTime}&limit=1000`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Binance HTTP ${res.status}: ${text}`);
      }
      const data = (await res.json()) as Array<{ T: number; p: string }>;
      // Bucket trades into 1-second intervals to keep point count manageable
      const buckets = new Map<number, number>();
      for (const trade of data) {
        const sec = Math.floor(trade.T / 1000);
        buckets.set(sec, parseFloat(trade.p));
      }
      const points = Array.from(buckets.entries())
        .sort(([a], [b]) => a - b)
        .map(([time, value]) => ({ time, value }));
      return NextResponse.json({ points });
    }

    if (type === "klines") {
      const interval = searchParams.get("interval") ?? "1h";
      const limit = searchParams.get("limit") ?? "24";
      const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Binance HTTP ${res.status}: ${text}`);
      }
      const data = await res.json();
      const points = (data as unknown[][]).map((k: unknown[]) => ({
        time: (k[0] as number) / 1000,
        value: parseFloat(k[4] as string),
      }));
      return NextResponse.json({ points });
    }

    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(sym)}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Binance HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    return NextResponse.json({
      price: parseFloat(data.lastPrice),
      change24h: parseFloat(data.priceChangePercent),
      high24h: parseFloat(data.highPrice),
      low24h: parseFloat(data.lowPrice),
      volume: parseFloat(data.volume),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
