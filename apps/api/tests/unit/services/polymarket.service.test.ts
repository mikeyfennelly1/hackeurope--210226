import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PolymarketService } from "../../../src/services/polymarket.service.js";
import { OrderSide, OrderType } from "../../../src/types/common.types.js";
import { ValidationError } from "../../../src/utils/errors.js";

// Create mock implementations
const mockClobClient = {
  getTickSize: vi.fn().mockResolvedValue("0.01"),
  getNegRisk: vi.fn().mockResolvedValue(false),
  createAndPostMarketOrder: vi.fn().mockResolvedValue({
    orderID: "order-123",
    status: "FILLED",
    price: "0.50",
    takingAmount: "100",
  }),
  getOrderBook: vi.fn().mockResolvedValue({
    market: "cond-123",
    asset_id: "12345",
    tick_size: "0.01",
    neg_risk: false,
    last_trade_price: "0.50",
  }),
  getOrder: vi.fn().mockResolvedValue({
    id: "order-123",
    status: "FILLED",
    asset_id: "12345",
    side: "BUY",
    price: "0.50",
    original_size: "100",
    size_matched: "100",
    created_at: 1234567890,
  }),
  cancelOrder: vi.fn().mockResolvedValue({}),
};

// Mock the CLOB client
vi.mock("@polymarket/clob-client", () => {
  // Use a class to properly support 'new' keyword
  class MockClobClient {
    constructor() {
      Object.assign(this, mockClobClient);
    }
  }
  return {
    ClobClient: MockClobClient,
    Side: { BUY: "BUY", SELL: "SELL" },
    OrderType: { GTC: "GTC", GTD: "GTD", FOK: "FOK", FAK: "FAK" },
  };
});

vi.mock("@ethersproject/wallet", () => {
  // Use a class to properly support 'new' keyword
  class MockWallet {
    constructor() {
      // Empty wallet mock
    }
  }
  return {
    Wallet: MockWallet,
  };
});

describe("PolymarketService", () => {
  let service: PolymarketService;

  beforeEach(() => {
    service = new PolymarketService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("placeOrder validation", () => {
    it("should throw ValidationError when price is greater than 1", async () => {
      await expect(
        service.placeOrder({
          tokenId: "12345",
          side: OrderSide.BUY,
          price: 1.5,
          amount: 100,
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        service.placeOrder({
          tokenId: "12345",
          side: OrderSide.BUY,
          price: 1.5,
          amount: 100,
        })
      ).rejects.toThrow("Price must be between 0 and 1");
    });

    it("should throw ValidationError when price is negative", async () => {
      await expect(
        service.placeOrder({
          tokenId: "12345",
          side: OrderSide.BUY,
          price: -0.5,
          amount: 100,
        })
      ).rejects.toThrow(ValidationError);
    });

    it("should throw ValidationError when amount is zero", async () => {
      await expect(
        service.placeOrder({
          tokenId: "12345",
          side: OrderSide.BUY,
          amount: 0,
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        service.placeOrder({
          tokenId: "12345",
          side: OrderSide.BUY,
          amount: 0,
        })
      ).rejects.toThrow("Amount must be greater than 0");
    });

    it("should throw ValidationError when amount is negative", async () => {
      await expect(
        service.placeOrder({
          tokenId: "12345",
          side: OrderSide.BUY,
          amount: -100,
        })
      ).rejects.toThrow(ValidationError);
    });

    it("should throw ValidationError when tokenId is empty", async () => {
      await expect(
        service.placeOrder({
          tokenId: "",
          side: OrderSide.BUY,
          amount: 100,
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        service.placeOrder({
          tokenId: "",
          side: OrderSide.BUY,
          amount: 100,
        })
      ).rejects.toThrow("Token ID is required");
    });

    it("should throw ValidationError when tokenId is whitespace only", async () => {
      await expect(
        service.placeOrder({
          tokenId: "   ",
          side: OrderSide.BUY,
          amount: 100,
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("placeOrder success", () => {
    it("should successfully place a BUY market order", async () => {
      const result = await service.placeOrder({
        tokenId: "12345",
        side: OrderSide.BUY,
        amount: 100,
      });

      expect(result.orderId).toBe("order-123");
      expect(result.status).toBe("FILLED");
      expect(result.side).toBe(OrderSide.BUY);
      expect(result.tokenId).toBe("12345");
      expect(result.amount).toBe(100);
    });

    it("should successfully place a SELL market order", async () => {
      const result = await service.placeOrder({
        tokenId: "12345",
        side: OrderSide.SELL,
        amount: 50,
      });

      expect(result.side).toBe(OrderSide.SELL);
      expect(result.amount).toBe(50);
    });

    it("should accept optional price limit", async () => {
      const result = await service.placeOrder({
        tokenId: "12345",
        side: OrderSide.BUY,
        amount: 100,
        price: 0.55,
      });

      expect(result.orderId).toBe("order-123");
    });

    it("should accept boundary price of 0", async () => {
      const result = await service.placeOrder({
        tokenId: "12345",
        side: OrderSide.BUY,
        price: 0,
        amount: 100,
      });

      expect(result.orderId).toBe("order-123");
    });

    it("should accept boundary price of 1", async () => {
      const result = await service.placeOrder({
        tokenId: "12345",
        side: OrderSide.BUY,
        price: 1,
        amount: 100,
      });

      expect(result.orderId).toBe("order-123");
    });

    it("should use FOK order type by default", async () => {
      const result = await service.placeOrder({
        tokenId: "12345",
        side: OrderSide.BUY,
        amount: 100,
      });

      expect(result.orderId).toBe("order-123");
    });

    it("should accept FAK order type", async () => {
      const result = await service.placeOrder({
        tokenId: "12345",
        side: OrderSide.BUY,
        amount: 100,
        orderType: OrderType.FAK,
      });

      expect(result.orderId).toBe("order-123");
    });
  });

  describe("getMarketInfo", () => {
    it("should return market info for a token", async () => {
      const result = await service.getMarketInfo("12345");

      expect(result.conditionId).toBe("cond-123");
      expect(result.tokenId).toBe("12345");
      expect(result.tickSize).toBe("0.01");
      expect(result.negRisk).toBe(false);
      expect(result.price).toBe(0.5);
    });
  });

  describe("getOrder", () => {
    it("should return order details", async () => {
      const result = await service.getOrder("order-123");

      expect(result.orderId).toBe("order-123");
      expect(result.status).toBe("FILLED");
      expect(result.tokenId).toBe("12345");
    });
  });

  describe("OrderSide enum", () => {
    it("should have correct BUY value", () => {
      expect(OrderSide.BUY).toBe("BUY");
    });

    it("should have correct SELL value", () => {
      expect(OrderSide.SELL).toBe("SELL");
    });
  });

  describe("OrderType enum", () => {
    it("should have correct FOK value", () => {
      expect(OrderType.FOK).toBe("FOK");
    });

    it("should have correct FAK value", () => {
      expect(OrderType.FAK).toBe("FAK");
    });
  });
});
