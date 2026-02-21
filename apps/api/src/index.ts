import cors from "cors";
import express from "express";
import { connectNats } from "./redprint/nats.js";
import { redprintRouter } from "./redprint/routes.js";

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/api", redprintRouter);

app.get("/", (_req, res) => {
  res.json({ message: "Hello from the API" });
});

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
