import { EventEmitter } from "node:events";
import { getLogger } from "../utils/logger.js";

export type PriceCondition = {
  symbol: string;
  operator: "drops_below" | "rises_above";
  targetPrice: number;
};

/**
 * Monitors a single crypto symbol via Polymarket RTDS WebSocket.
 * https://docs.polymarket.com/market-data/websocket/rtds
 *
 * Emits "condition_met" when the price threshold is crossed, then closes.
 * Emits "price" on every tick with { symbol, price }.
 */
export class CryptoPriceMonitor extends EventEmitter {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1_000;
  private readonly MAX_RECONNECT_DELAY = 30_000;
  private readonly logger;

  constructor(private readonly condition: PriceCondition) {
    super();
    this.logger = getLogger(`CryptoRTDS:${condition.symbol}`);
  }

  start(): void {
    if (this.closed) return;

    const symbol = this.condition.symbol.toLowerCase();
    const url = "wss://ws-live-data.polymarket.com";

    this.logger.info(`Connecting to RTDS for ${symbol}`);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.logger.info(
        `Connected — subscribing to ${symbol} (${this.condition.operator} $${this.condition.targetPrice})`,
      );
      this.reconnectDelay = 1_000;

      this.ws?.send(
        JSON.stringify({
          action: "subscribe",
          subscriptions: [
            {
              topic: "crypto_prices",
              type: "update",
            },
          ],
        }),
      );

      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send("PING");
        }
      }, 5_000);
    };

    this.ws.onmessage = (event) => {
      try {
        const raw = String(event.data);
        if (raw === "PONG" || raw === "") return;

        const msg = JSON.parse(raw) as {
          topic?: string;
          payload?: { symbol?: string; value?: number };
        };

        if (msg.topic !== "crypto_prices" || msg.payload?.symbol !== symbol || msg.payload?.value == null) return;

        const price = msg.payload.value;
        const sym = msg.payload.symbol ?? symbol;

        this.logger.trace(`Tick: ${sym} @ $${price}`);
        this.emit("price", { symbol: sym.toUpperCase(), price });

        const met =
          this.condition.operator === "drops_below"
            ? price < this.condition.targetPrice
            : price > this.condition.targetPrice;

        if (met) {
          this.logger.info(
            `Condition met: ${sym} ${this.condition.operator} $${this.condition.targetPrice} (current=$${price})`,
          );
          this.emit("condition_met", { symbol: sym.toUpperCase(), price });
          this.close();
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onerror = () => {
      this.logger.error(`WebSocket error`);
    };

    this.ws.onclose = () => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      if (!this.closed) {
        this.logger.warn(
          `Disconnected — reconnecting in ${this.reconnectDelay}ms`,
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
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
