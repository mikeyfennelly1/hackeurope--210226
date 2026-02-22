import { EventEmitter } from "node:events";
import { getLogger } from "../utils/logger.js";

const RTDS_URL = "wss://ws-live-data.polymarket.com";

export type CryptoCondition = {
  symbol: string;
  operator: "drops_below" | "rises_above";
  targetPrice: number;
};

/**
 * Monitors crypto prices via Polymarket RTDS WebSocket.
 * Emits "price" on every tick with { symbol, price }.
 * Emits "condition_met" when the price threshold is crossed, then closes.
 */
export class PolymarketCryptoMonitor extends EventEmitter {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1_000;
  private readonly MAX_RECONNECT_DELAY = 30_000;
  private readonly logger;

  constructor(private readonly condition: CryptoCondition) {
    super();
    this.logger = getLogger(`PolymarketCrypto:${condition.symbol}`);
  }

  start(): void {
    if (this.closed) return;

    this.logger.info(`Connecting to ${RTDS_URL}`);
    this.ws = new WebSocket(RTDS_URL);

    this.ws.onopen = () => {
      this.logger.info(
        `Connected — subscribing to ${this.condition.symbol} (${this.condition.operator} $${this.condition.targetPrice})`,
      );
      this.reconnectDelay = 1_000;

      // Subscribe to crypto prices
      this.ws?.send(
        JSON.stringify({
          action: "subscribe",
          subscriptions: [
            {
              topic: "crypto_prices",
              type: "update",
              filters: this.condition.symbol.toLowerCase(),
            },
          ],
        }),
      );

      // Start ping interval (every 5 seconds per Polymarket docs)
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send("PING");
        }
      }, 5000);
    };

    this.ws.onmessage = (event) => {
      const data = String(event.data);

      // Ignore PONG responses
      if (data === "PONG") return;

      try {
        const msg = JSON.parse(data) as {
          topic?: string;
          payload?: { symbol: string; value: number };
        };

        if (msg.topic === "crypto_prices" && msg.payload) {
          const { symbol, value: price } = msg.payload;

          this.logger.trace(`Tick: ${symbol} @ $${price}`);
          this.emit("price", { symbol: symbol.toUpperCase(), price });

          const met =
            this.condition.operator === "drops_below"
              ? price < this.condition.targetPrice
              : price > this.condition.targetPrice;

          if (met) {
            this.logger.info(
              `Condition met: ${symbol} ${this.condition.operator} $${this.condition.targetPrice} (current=$${price})`,
            );
            this.emit("condition_met", { symbol: symbol.toUpperCase(), price });
            this.close();
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onerror = () => {
      this.logger.error("WebSocket error");
    };

    this.ws.onclose = () => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      if (!this.closed) {
        this.logger.warn(`Disconnected — reconnecting in ${this.reconnectDelay}ms`);
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.MAX_RECONNECT_DELAY);
          this.start();
        }, this.reconnectDelay);
      }
    };
  }

  close(): void {
    this.closed = true;
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
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
