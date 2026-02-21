import { EventEmitter } from "node:events";

export type PriceCondition = {
  symbol: string;
  operator: "drops_below" | "rises_above";
  targetPrice: number;
};

/**
 * Monitors a single symbol via Binance miniTicker WebSocket (~1s updates).
 * Emits "condition_met" when the price threshold is crossed, then closes.
 * Emits "price" on every tick with { symbol, price }.
 */
export class BinancePriceMonitor extends EventEmitter {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1_000;
  private readonly MAX_RECONNECT_DELAY = 30_000;

  constructor(private readonly condition: PriceCondition) {
    super();
  }

  start(): void {
    if (this.closed) return;

    const symbol = this.condition.symbol.toLowerCase();
    const url = `wss://stream.binance.com:9443/ws/${symbol}@miniTicker`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log(`[BinanceWS] Connected: ${symbol}`);
      this.reconnectDelay = 1_000;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as { s: string; c: string };
        const price = parseFloat(data.c);

        this.emit("price", { symbol: data.s, price });

        const met =
          this.condition.operator === "drops_below"
            ? price < this.condition.targetPrice
            : price > this.condition.targetPrice;

        if (met) {
          this.emit("condition_met", { symbol: data.s, price });
          this.close();
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onerror = () => {
      console.error(`[BinanceWS] Error for ${symbol}`);
    };

    this.ws.onclose = () => {
      if (!this.closed) {
        console.log(
          `[BinanceWS] Disconnected ${symbol}, reconnecting in ${this.reconnectDelay}ms`,
        );
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectDelay = Math.min(
            this.reconnectDelay * 2,
            this.MAX_RECONNECT_DELAY,
          );
          this.start();
        }, this.reconnectDelay);
      }
    };
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
