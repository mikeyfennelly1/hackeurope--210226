import express from "express";

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Hello from the API" });
});

app.listen(port, () => {
  console.log(`API server running on http://localhost:${port}`);
});
