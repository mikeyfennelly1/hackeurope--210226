import { OrderSide, OrderType } from "./common.types.js";

/**
 * Request payload for placing a market order
 */
export interface PlaceOrderRequest {
  /** The token_id of the target security (YES or NO token) */
  tokenId: string;
  /** Order side: BUY or SELL */
  side: OrderSide;
  /**
   * For BUY orders: USDC amount to spend
   * For SELL orders: Number of shares to sell
   */
  amount: number;
  /** Optional price limit (0.00 - 1.00). If not provided, uses market price */
  price?: number;
  /** Order type: FOK (fill-or-kill) or FAK (fill-and-kill). Defaults to FOK */
  orderType?: OrderType;
}

/**
 * Response from a successful market order placement
 */
export interface PlaceOrderResponse {
  orderId: string;
  status: string;
  tokenId: string;
  side: OrderSide;
  amount: number;
  /** Execution price (may differ from requested price for market orders) */
  executionPrice?: number;
  /** Amount that was filled */
  filledAmount: number;
  createdAt: string;
}

/**
 * Market information for a token
 */
export interface MarketInfo {
  conditionId: string;
  tokenId: string;
  outcome: "Yes" | "No";
  price: number;
  tickSize: string;
  negRisk: boolean;
}

/**
 * Configuration for Polymarket client
 */
export interface PolymarketConfig {
  privateKey: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  chainId: number;
}
