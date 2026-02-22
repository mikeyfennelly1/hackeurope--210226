import { EventEmitter } from "node:events";
import { getLogger } from "../utils/logger.js";

const POLYMARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const GAMMA_API_URL = "https://gamma-api.polymarket.com";

// WebSocket message types from Polymarket
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

export type MarketConfig = {
  tokenId: string;
  marketSlug?: string;
};

// Event payloads
export type PriceEvent = { tokenId: string; price: number };
export type VolumeEvent = { tokenId: string; volume: number };
export type LiquidityEvent = { tokenId: string; liquidity: number };
export type SpreadEvent = { tokenId: string; spread: number; bestBid: number; bestAsk: number };
export type LastTradeEvent = { tokenId: string; price: number };

type TokenListener = {
  tokenId: string;
  callback: (data: { price?: number; bestBid?: number; bestAsk?: number }) => void;
};

/**
 * Singleton WebSocket manager for Polymarket market data.
 * Maintains a single connection and demultiplexes messages to registered listeners.
 */
class PolymarketWebSocketManager extends EventEmitter {
  private static instance: PolymarketWebSocketManager | null = null;

  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1_000;
  private readonly MAX_RECONNECT_DELAY = 30_000;
  private readonly logger = getLogger("PolymarketWS");
  private readonly tokenListeners: TokenListener[] = [];
  private readonly subscribedTokens = new Set<string>();
  private connected = false;

  private constructor() {
    super();
  }

  static getInstance(): PolymarketWebSocketManager {
    if (!PolymarketWebSocketManager.instance) {
      PolymarketWebSocketManager.instance = new PolymarketWebSocketManager();
    }
    return PolymarketWebSocketManager.instance;
  }

  subscribe(
    tokenId: string,
    callback: (data: { price?: number; bestBid?: number; bestAsk?: number }) => void,
  ): () => void {
    const listener: TokenListener = { tokenId, callback };
    this.tokenListeners.push(listener);

    const needsResubscribe = !this.subscribedTokens.has(tokenId);
    this.subscribedTokens.add(tokenId);

    if (!this.connected) {
      this.connect();
    } else if (needsResubscribe) {
      this.sendSubscription();
    }

    // Return unsubscribe function
    return () => {
      const idx = this.tokenListeners.indexOf(listener);
      if (idx !== -1) {
        this.tokenListeners.splice(idx, 1);
      }
    };
  }

  private connect(): void {
    if (this.closed) return;

    this.logger.info(`Connecting to ${POLYMARKET_WS_URL}`);
    this.ws = new WebSocket(POLYMARKET_WS_URL);

    this.ws.onopen = () => {
      this.logger.info("Connected to Polymarket WebSocket");
      this.connected = true;
      this.reconnectDelay = 1_000;
      this.sendSubscription();
    };

    this.ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(String(event.data));
        const messages: WsMessage[] = Array.isArray(raw) ? raw : [raw];

        for (const msg of messages) {
          this.handleMessage(msg);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onerror = () => {
      this.logger.error("WebSocket error");
    };

    this.ws.onclose = () => {
      this.connected = false;
      if (!this.closed) {
        this.logger.warn(`Disconnected — reconnecting in ${this.reconnectDelay}ms`);
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.MAX_RECONNECT_DELAY);
          this.connect();
        }, this.reconnectDelay);
      }
    };
  }

  private sendSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const tokenIds = [...this.subscribedTokens];
    if (tokenIds.length === 0) return;

    this.logger.debug(`Subscribing to ${tokenIds.length} token(s)`);
    this.ws.send(
      JSON.stringify({
        assets_ids: tokenIds,
        type: "market",
        custom_feature_enabled: true,
      }),
    );
  }

  private handleMessage(msg: WsMessage): void {
    switch (msg.event_type) {
      case "last_trade_price":
        if (msg.asset_id && msg.price) {
          this.notifyListeners(msg.asset_id, {
            price: parseFloat(msg.price),
          });
        }
        break;

      case "price_change":
        if (msg.price_changes) {
          for (const pc of msg.price_changes) {
            this.notifyListeners(pc.asset_id, {
              price: parseFloat(pc.price),
              bestBid: pc.best_bid ? parseFloat(pc.best_bid) : undefined,
              bestAsk: pc.best_ask ? parseFloat(pc.best_ask) : undefined,
            });
          }
        }
        break;

      case "best_bid_ask":
        if (msg.asset_id && msg.best_bid) {
          this.notifyListeners(msg.asset_id, {
            bestBid: parseFloat(msg.best_bid),
            bestAsk: msg.best_ask ? parseFloat(msg.best_ask) : undefined,
          });
        }
        break;
    }
  }

  private notifyListeners(
    tokenId: string,
    data: { price?: number; bestBid?: number; bestAsk?: number },
  ): void {
    for (const listener of this.tokenListeners) {
      if (listener.tokenId === tokenId) {
        listener.callback(data);
      }
    }
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
    this.connected = false;
  }
}

/**
 * Produces price events from Polymarket WebSocket.
 * Emits "price" event with { tokenId, price }.
 */
export class PolymarketPriceProducer extends EventEmitter {
  private unsubscribe: (() => void) | null = null;
  private closed = false;
  private readonly logger;

  constructor(private readonly config: MarketConfig) {
    super();
    this.logger = getLogger(`PolymarketPrice:${config.tokenId.slice(0, 8)}`);
  }

  start(): void {
    if (this.closed) return;

    this.logger.info(`Starting price producer for token ${this.config.tokenId.slice(0, 16)}...`);

    const manager = PolymarketWebSocketManager.getInstance();
    this.unsubscribe = manager.subscribe(this.config.tokenId, (data) => {
      if (data.price !== undefined) {
        this.logger.trace(`Price update: ${data.price}`);
        this.emit("price", { tokenId: this.config.tokenId, price: data.price } as PriceEvent);
      }
    });
  }

  close(): void {
    this.closed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.logger.info("Price producer closed");
  }
}

/**
 * Produces spread events from Polymarket WebSocket.
 * Emits "spread" event with { tokenId, spread, bestBid, bestAsk }.
 */
export class PolymarketSpreadProducer extends EventEmitter {
  private unsubscribe: (() => void) | null = null;
  private closed = false;
  private readonly logger;

  constructor(private readonly config: MarketConfig) {
    super();
    this.logger = getLogger(`PolymarketSpread:${config.tokenId.slice(0, 8)}`);
  }

  start(): void {
    if (this.closed) return;

    this.logger.info(`Starting spread producer for token ${this.config.tokenId.slice(0, 16)}...`);

    const manager = PolymarketWebSocketManager.getInstance();
    this.unsubscribe = manager.subscribe(this.config.tokenId, (data) => {
      if (data.bestBid !== undefined && data.bestAsk !== undefined) {
        const spread = data.bestAsk - data.bestBid;
        this.logger.trace(`Spread update: ${spread} (bid=${data.bestBid}, ask=${data.bestAsk})`);
        this.emit("spread", {
          tokenId: this.config.tokenId,
          spread,
          bestBid: data.bestBid,
          bestAsk: data.bestAsk,
        } as SpreadEvent);
      }
    });
  }

  close(): void {
    this.closed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.logger.info("Spread producer closed");
  }
}

/**
 * Produces last trade events from Polymarket WebSocket.
 * Emits "lastTrade" event with { tokenId, price }.
 */
export class PolymarketLastTradeProducer extends EventEmitter {
  private unsubscribe: (() => void) | null = null;
  private closed = false;
  private readonly logger;

  constructor(private readonly config: MarketConfig) {
    super();
    this.logger = getLogger(`PolymarketLastTrade:${config.tokenId.slice(0, 8)}`);
  }

  start(): void {
    if (this.closed) return;

    this.logger.info(`Starting lastTrade producer for token ${this.config.tokenId.slice(0, 16)}...`);

    const manager = PolymarketWebSocketManager.getInstance();
    this.unsubscribe = manager.subscribe(this.config.tokenId, (data) => {
      if (data.price !== undefined) {
        this.logger.trace(`Last trade: ${data.price}`);
        this.emit("lastTrade", { tokenId: this.config.tokenId, price: data.price } as LastTradeEvent);
      }
    });
  }

  close(): void {
    this.closed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.logger.info("LastTrade producer closed");
  }
}

/**
 * Produces volume events by polling Gamma API.
 * Emits "volume" event with { tokenId, volume }.
 */
export class PolymarketVolumeProducer extends EventEmitter {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private readonly POLL_INTERVAL_MS = 60_000; // 60 seconds
  private readonly logger;

  constructor(private readonly config: MarketConfig) {
    super();
    this.logger = getLogger(`PolymarketVolume:${config.marketSlug ?? config.tokenId.slice(0, 8)}`);
  }

  start(): void {
    if (this.closed) return;

    this.logger.info(`Starting volume producer for market ${this.config.marketSlug}`);

    // Initial fetch
    void this.fetchVolume();

    // Poll periodically
    this.pollInterval = setInterval(() => {
      void this.fetchVolume();
    }, this.POLL_INTERVAL_MS);
  }

  private async fetchVolume(): Promise<void> {
    if (!this.config.marketSlug) {
      this.logger.warn("No marketSlug provided, cannot fetch volume");
      return;
    }

    try {
      const response = await fetch(
        `${GAMMA_API_URL}/events?slug=${encodeURIComponent(this.config.marketSlug)}`,
      );

      if (!response.ok) {
        this.logger.error(`Gamma API error: ${response.status}`);
        return;
      }

      const data = (await response.json()) as Array<{ volume?: number; volume24hr?: number }>;
      if (data.length > 0 && data[0]) {
        const volume = data[0].volume ?? data[0].volume24hr ?? 0;
        this.logger.trace(`Volume update: ${volume}`);
        this.emit("volume", { tokenId: this.config.tokenId, volume } as VolumeEvent);
      }
    } catch (err) {
      this.logger.error(`Failed to fetch volume: ${err}`);
    }
  }

  close(): void {
    this.closed = true;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.logger.info("Volume producer closed");
  }
}

/**
 * Produces liquidity events by polling Gamma API.
 * Emits "liquidity" event with { tokenId, liquidity }.
 */
export class PolymarketLiquidityProducer extends EventEmitter {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private readonly POLL_INTERVAL_MS = 60_000; // 60 seconds
  private readonly logger;

  constructor(private readonly config: MarketConfig) {
    super();
    this.logger = getLogger(`PolymarketLiquidity:${config.marketSlug ?? config.tokenId.slice(0, 8)}`);
  }

  start(): void {
    if (this.closed) return;

    this.logger.info(`Starting liquidity producer for market ${this.config.marketSlug}`);

    // Initial fetch
    void this.fetchLiquidity();

    // Poll periodically
    this.pollInterval = setInterval(() => {
      void this.fetchLiquidity();
    }, this.POLL_INTERVAL_MS);
  }

  private async fetchLiquidity(): Promise<void> {
    if (!this.config.marketSlug) {
      this.logger.warn("No marketSlug provided, cannot fetch liquidity");
      return;
    }

    try {
      const response = await fetch(
        `${GAMMA_API_URL}/events?slug=${encodeURIComponent(this.config.marketSlug)}`,
      );

      if (!response.ok) {
        this.logger.error(`Gamma API error: ${response.status}`);
        return;
      }

      const data = (await response.json()) as Array<{ liquidity?: number }>;
      if (data.length > 0 && data[0]) {
        const liquidity = data[0].liquidity ?? 0;
        this.logger.trace(`Liquidity update: ${liquidity}`);
        this.emit("liquidity", { tokenId: this.config.tokenId, liquidity } as LiquidityEvent);
      }
    } catch (err) {
      this.logger.error(`Failed to fetch liquidity: ${err}`);
    }
  }

  close(): void {
    this.closed = true;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.logger.info("Liquidity producer closed");
  }
}

// Union type for all market producers
export type PolymarketProducer =
  | PolymarketPriceProducer
  | PolymarketVolumeProducer
  | PolymarketLiquidityProducer
  | PolymarketSpreadProducer
  | PolymarketLastTradeProducer;
