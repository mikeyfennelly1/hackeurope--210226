/**
 * Custom OrderSide enum (independent of SDK's internal enum)
 * This provides abstraction from the underlying SDK implementation
 */
export enum OrderSide {
  BUY = "BUY",
  SELL = "SELL",
}

/**
 * Supported order types for market orders on Polymarket CLOB
 */
export enum OrderType {
  FOK = "FOK", // Fill-Or-Kill: must fill entirely or cancel
  FAK = "FAK", // Fill-And-Kill: partial fill allowed, remainder cancelled
}

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
