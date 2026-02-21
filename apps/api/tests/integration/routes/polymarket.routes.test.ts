import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { polymarketRoutes } from "../../../src/routes/polymarket.routes.js";
import { errorHandler } from "../../../src/middleware/error-handler.js";

// Mock the service
vi.mock("../../../src/services/polymarket.service.js", () => ({
  polymarketService: {
    placeOrder: vi.fn().mockResolvedValue({
      orderId: "order-123",
      status: "FILLED",
      tokenId: "12345",
      side: "BUY",
      amount: 100,
      executionPrice: 0.5,
      filledAmount: 100,
      createdAt: "2024-01-01T00:00:00.000Z",
    }),
    cancelOrder: vi.fn().mockResolvedValue(undefined),
    getOrder: vi.fn().mockResolvedValue({
      orderId: "order-123",
      status: "FILLED",
      tokenId: "12345",
      side: "BUY",
      price: "0.50",
      originalSize: "100",
      sizeMatched: "100",
      createdAt: 1704067200,
    }),
    getMarketInfo: vi.fn().mockResolvedValue({
      conditionId: "cond-123",
      tokenId: "12345",
      outcome: "Yes",
      price: 0.5,
      tickSize: "0.01",
      negRisk: false,
    }),
  },
}));

describe("Polymarket Routes", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/api/polymarket", polymarketRoutes);
    app.use(errorHandler);
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/polymarket/orders", () => {
    it("should place a market order and return 201", async () => {
      const response = await request(app)
        .post("/api/polymarket/orders")
        .send({
          tokenId: "12345",
          side: "BUY",
          amount: 100,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.orderId).toBe("order-123");
      expect(response.body.data.side).toBe("BUY");
      expect(response.body.data.amount).toBe(100);
    });

    it("should return 400 for invalid side", async () => {
      const response = await request(app)
        .post("/api/polymarket/orders")
        .send({
          tokenId: "12345",
          side: "INVALID_SIDE",
          amount: 100,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 for invalid price (> 1)", async () => {
      const response = await request(app)
        .post("/api/polymarket/orders")
        .send({
          tokenId: "12345",
          side: "BUY",
          price: 1.5,
          amount: 100,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 for invalid price (< 0)", async () => {
      const response = await request(app)
        .post("/api/polymarket/orders")
        .send({
          tokenId: "12345",
          side: "BUY",
          price: -0.5,
          amount: 100,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should return 400 for invalid amount (<= 0)", async () => {
      const response = await request(app)
        .post("/api/polymarket/orders")
        .send({
          tokenId: "12345",
          side: "BUY",
          amount: 0,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 for missing tokenId", async () => {
      const response = await request(app)
        .post("/api/polymarket/orders")
        .send({
          side: "BUY",
          amount: 100,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should accept SELL side", async () => {
      const response = await request(app)
        .post("/api/polymarket/orders")
        .send({
          tokenId: "12345",
          side: "SELL",
          amount: 50,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it("should accept optional price limit", async () => {
      const response = await request(app)
        .post("/api/polymarket/orders")
        .send({
          tokenId: "12345",
          side: "BUY",
          amount: 100,
          price: 0.55,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it("should accept optional orderType", async () => {
      const response = await request(app)
        .post("/api/polymarket/orders")
        .send({
          tokenId: "12345",
          side: "BUY",
          amount: 100,
          orderType: "FOK",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
    });

    it("should return 400 for invalid orderType", async () => {
      const response = await request(app)
        .post("/api/polymarket/orders")
        .send({
          tokenId: "12345",
          side: "BUY",
          amount: 100,
          orderType: "INVALID",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/polymarket/orders/:orderId", () => {
    it("should return order details", async () => {
      const response = await request(app)
        .get("/api/polymarket/orders/order-123")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.orderId).toBe("order-123");
      expect(response.body.data.status).toBe("FILLED");
    });
  });

  describe("DELETE /api/polymarket/orders/:orderId", () => {
    it("should cancel an order and return 200", async () => {
      const response = await request(app)
        .delete("/api/polymarket/orders/order-123")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.orderId).toBe("order-123");
      expect(response.body.data.status).toBe("cancelled");
    });
  });

  describe("GET /api/polymarket/markets/:tokenId", () => {
    it("should return market info", async () => {
      const response = await request(app)
        .get("/api/polymarket/markets/12345")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tokenId).toBe("12345");
      expect(response.body.data.conditionId).toBe("cond-123");
      expect(response.body.data.tickSize).toBe("0.01");
      expect(response.body.data.negRisk).toBe(false);
    });
  });
});
