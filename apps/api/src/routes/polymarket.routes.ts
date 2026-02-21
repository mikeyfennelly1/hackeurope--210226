import { Router, Request, Response, NextFunction } from "express";
import type { Router as RouterType } from "express";
import { polymarketService } from "../services/polymarket.service.js";
import { PlaceOrderRequest } from "../types/polymarket.types.js";
import { ApiResponse } from "../types/common.types.js";
import { validatePlaceOrder } from "../middleware/validation.js";

const router: RouterType = Router();

/**
 * POST /api/polymarket/orders
 * Place a new order on Polymarket
 */
router.post(
  "/orders",
  validatePlaceOrder,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orderRequest: PlaceOrderRequest = req.body;
      const result = await polymarketService.placeOrder(orderRequest);

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/polymarket/orders/:orderId
 * Get order status
 */
router.get(
  "/orders/:orderId",
  async (
    req: Request<{ orderId: string }>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { orderId } = req.params;
      const result = await polymarketService.getOrder(orderId);

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/polymarket/orders/:orderId
 * Cancel an existing order
 */
router.delete(
  "/orders/:orderId",
  async (
    req: Request<{ orderId: string }>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { orderId } = req.params;
      await polymarketService.cancelOrder(orderId);

      const response: ApiResponse<{ orderId: string; status: string }> = {
        success: true,
        data: { orderId, status: "cancelled" },
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/polymarket/markets/:tokenId
 * Get market information for a token
 */
router.get(
  "/markets/:tokenId",
  async (
    req: Request<{ tokenId: string }>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { tokenId } = req.params;
      const result = await polymarketService.getMarketInfo(tokenId);

      const response: ApiResponse<typeof result> = {
        success: true,
        data: result,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

export { router as polymarketRoutes };
