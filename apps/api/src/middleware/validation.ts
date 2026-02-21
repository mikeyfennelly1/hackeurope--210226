import { Request, Response, NextFunction } from "express";
import { OrderSide, OrderType } from "../types/common.types.js";
import { ValidationError } from "../utils/errors.js";

/**
 * Validate place market order request body
 */
export function validatePlaceOrder(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const { tokenId, side, price, amount, orderType } = req.body;

  const errors: string[] = [];

  if (!tokenId || typeof tokenId !== "string") {
    errors.push("tokenId is required and must be a string");
  }

  if (!side || !Object.values(OrderSide).includes(side)) {
    errors.push(`side must be one of: ${Object.values(OrderSide).join(", ")}`);
  }

  // Price is optional for market orders, but if provided must be valid
  if (price !== undefined && (typeof price !== "number" || price < 0 || price > 1)) {
    errors.push("price must be a number between 0 and 1");
  }

  if (typeof amount !== "number" || amount <= 0) {
    errors.push("amount must be a positive number");
  }

  if (orderType && !Object.values(OrderType).includes(orderType)) {
    errors.push(
      `orderType must be one of: ${Object.values(OrderType).join(", ")}`
    );
  }

  if (errors.length > 0) {
    next(new ValidationError(errors.join("; ")));
    return;
  }

  next();
}
