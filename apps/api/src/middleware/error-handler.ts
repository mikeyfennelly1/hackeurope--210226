import type { ErrorRequestHandler } from "express";
import { AppError } from "../utils/errors.js";
import { ApiResponse } from "../types/common.types.js";
import { config } from "../config/env.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("ErrorHandler");

// Express requires 4 parameters to recognize error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AppError) {
    logger.warn(`[${req.method} ${req.path}] ${error.code}: ${error.message}`);
    if (config.isDevelopment()) {
      logger.debug(error.stack ?? "(no stack)");
    }
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
  logger.error(`[${req.method} ${req.path}] Unhandled error: ${(error as Error).message}`, error);
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
