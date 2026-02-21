import cors from "cors";
import express from "express";
import { connectNats } from "./redprint/nats.js";
import { redprintRouter } from "./redprint/routes.js";
import { polymarketRoutes } from "./routes/index.js";
import { errorHandler } from "./middleware/index.js";

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
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
  await connectNats();
  app.listen(port, () => {
    console.log(`API server running on http://localhost:${port}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
