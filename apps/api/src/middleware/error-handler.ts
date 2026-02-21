import type { ErrorRequestHandler } from "express";
import { AppError } from "../utils/errors.js";
import { ApiResponse } from "../types/common.types.js";
import { config } from "../config/env.js";

// Express requires 4 parameters to recognize error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  // Log error in development
  if (config.isDevelopment()) {
    console.error("Error:", error);
  }

  if (error instanceof AppError) {
    const response: ApiResponse<never> = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: config.isDevelopment() ? error.stack : undefined,
      },
    };
    res.status(error.statusCode).json(response);
    return;
  }

  // Unknown errors
  const response: ApiResponse<never> = {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: config.isProduction()
        ? "An unexpected error occurred"
        : error.message,
    },
  };
  res.status(500).json(response);
}
