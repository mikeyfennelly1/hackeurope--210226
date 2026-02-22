import cors from "cors";
import express from "express";
import { connectNats } from "./redprint/nats.js";
import { redprintRouter } from "./redprint/RedprintRoutes.js";
import { polymarketRoutes } from "./routes/index.js";
import { errorHandler } from "./middleware/index.js";
import { getLogger } from "./utils/logger.js";

const logger = getLogger("App");

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Redprint routes
app.use("/api", redprintRouter);

// Health check
app.get("/", (_req, res) => {
  res.json({ message: "Hello from the API" });
});

// Mount Polymarket routes
app.use("/api/polymarket", polymarketRoutes);

// Global error handler (must be last)
app.use(errorHandler);

async function start() {
  logger.info("Starting API server...");
  await connectNats();
  app.listen(port, () => {
    logger.info(`API server running on http://localhost:${port}`);
  });
}

start().catch((err) => {
  logger.error("Failed to start:", err);
  process.exit(1);
});
