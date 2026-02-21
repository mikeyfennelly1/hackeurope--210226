import {
  ClobClient,
  Side as SdkSide,
  OrderType as SdkOrderType,
} from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import {
  PlaceOrderRequest,
  PlaceOrderResponse,
  MarketInfo,
} from "../types/polymarket.types.js";
import { OrderSide, OrderType } from "../types/common.types.js";
import { config } from "../config/env.js";
import { PolymarketError, ValidationError, NotFoundError } from "../utils/errors.js";

/**
 * Service for interacting with Polymarket CLOB
 */
export class PolymarketService {
  private client: ClobClient | null = null;

  /**
   * Initialize the CLOB client (lazy initialization)
   */
  private async getClient(): Promise<ClobClient> {
    if (this.client) return this.client;

    const wallet = new Wallet(config.polymarket.privateKey);

    this.client = new ClobClient(
      config.polymarket.clobHost,
      config.polymarket.chainId,
      wallet,
      {
        key: config.polymarket.apiKey,
        secret: config.polymarket.apiSecret,
        passphrase: config.polymarket.apiPassphrase,
      }
    );

    return this.client;
  }

  /**
   * Map custom OrderSide to SDK Side enum
   */
  private mapSide(side: OrderSide): SdkSide {
    return side === OrderSide.BUY ? SdkSide.BUY : SdkSide.SELL;
  }

  /**
   * Map custom OrderType to SDK OrderType enum for market orders
   */
  private mapOrderType(
    orderType: OrderType
  ): SdkOrderType.FOK | SdkOrderType.FAK {
    switch (orderType) {
      case OrderType.FAK:
        return SdkOrderType.FAK;
      case OrderType.FOK:
      default:
        return SdkOrderType.FOK;
    }
  }

  /**
   * Validate market order parameters
   */
  private validateOrder(request: PlaceOrderRequest): void {
    if (request.price !== undefined && (request.price < 0 || request.price > 1)) {
      throw new ValidationError("Price must be between 0 and 1");
    }
    if (request.amount <= 0) {
      throw new ValidationError("Amount must be greater than 0");
    }
    if (!request.tokenId || request.tokenId.trim() === "") {
      throw new ValidationError("Token ID is required");
    }
  }

  /**
   * Place a market order on Polymarket
   *
   * For BUY orders: amount is the USDC amount to spend
   * For SELL orders: amount is the number of shares to sell
   */
  async placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResponse> {
    this.validateOrder(request);

    const client = await this.getClient();
    const sdkSide = this.mapSide(request.side);
    const sdkOrderType = this.mapOrderType(request.orderType || OrderType.FOK);

    try {
      // Fetch tick size and negRisk for the token
      const tickSize = await client.getTickSize(request.tokenId);
      const negRisk = await client.getNegRisk(request.tokenId);

      const order = await client.createAndPostMarketOrder(
        {
          tokenID: request.tokenId,
          side: sdkSide,
          amount: request.amount,
          price: request.price, // Optional - uses market price if undefined
          orderType: sdkOrderType,
        },
        {
          tickSize,
          negRisk,
        },
        sdkOrderType
      );

      return {
        orderId: order.orderID || order.id || "",
        status: order.status || "FILLED",
        tokenId: request.tokenId,
        side: request.side,
        amount: request.amount,
        executionPrice: order.price ? parseFloat(order.price) : undefined,
        filledAmount: parseFloat(order.takingAmount || order.makingAmount || "0"),
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new PolymarketError(
        `Failed to place market order: ${(error as Error).message}`,
        error
      );
    }
  }

  /**
   * Get market information for a token
   */
  async getMarketInfo(tokenId: string): Promise<MarketInfo> {
    const client = await this.getClient();

    try {
      const orderBook = await client.getOrderBook(tokenId);

      return {
        conditionId: orderBook.market,
        tokenId: orderBook.asset_id,
        outcome: "Yes", // This would need to be determined from market data
        price: parseFloat(orderBook.last_trade_price || "0"),
        tickSize: orderBook.tick_size,
        negRisk: orderBook.neg_risk,
      };
    } catch (error) {
      throw new PolymarketError(
        `Failed to get market info: ${(error as Error).message}`,
        error
      );
    }
  }

  /**
   * Get an order by ID
   */
  async getOrder(orderId: string): Promise<{
    orderId: string;
    status: string;
    tokenId: string;
    side: string;
    price: string;
    originalSize: string;
    sizeMatched: string;
    createdAt: number;
  }> {
    const client = await this.getClient();

    try {
      const order = await client.getOrder(orderId);

      if (!order) {
        throw new NotFoundError(`Order ${orderId}`);
      }

      return {
        orderId: order.id,
        status: order.status,
        tokenId: order.asset_id,
        side: order.side,
        price: order.price,
        originalSize: order.original_size,
        sizeMatched: order.size_matched,
        createdAt: order.created_at,
      };
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new PolymarketError(
        `Failed to get order: ${(error as Error).message}`,
        error
      );
    }
  }

  /**
   * Cancel an existing order
   */
  async cancelOrder(orderId: string): Promise<void> {
    const client = await this.getClient();

    try {
      await client.cancelOrder({ orderID: orderId });
    } catch (error) {
      throw new PolymarketError(
        `Failed to cancel order: ${(error as Error).message}`,
        error
      );
    }
  }
}

// Export singleton instance
export const polymarketService = new PolymarketService();
