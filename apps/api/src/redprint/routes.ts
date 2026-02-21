import { Router, type Router as RouterType } from "express";
import type { BlueprintDefinition } from "@repo/backend/blueprints/definition";
import * as manager from "./manager.js";
import { redprintToJSON } from "./types.js";

export const redprintRouter: RouterType = Router();

// POST /api/redprints — dispatch a new redprint from a blueprint
redprintRouter.post("/redprints", (req, res) => {
  const blueprint = req.body as BlueprintDefinition;

  if (!blueprint?.name || !blueprint?.nodes) {
    res.status(400).json({ error: "Invalid blueprint definition" });
    return;
  }

  const redprint = manager.dispatch(blueprint);
  res.status(201).json(redprintToJSON(redprint));
});

// GET /api/redprints — list all redprints
redprintRouter.get("/redprints", (_req, res) => {
  const all = manager.list().map(redprintToJSON);
  res.json(all);
});

// GET /api/redprints/:id — get a single redprint
redprintRouter.get("/redprints/:id", (req, res) => {
  const redprint = manager.get(req.params.id!);
  if (!redprint) {
    res.status(404).json({ error: "Redprint not found" });
    return;
  }
  res.json(redprintToJSON(redprint));
});

// POST /api/redprints/:id/nodes/:node_name — push event to a node
redprintRouter.post("/redprints/:id/nodes/:node_name", (req, res) => {
  const { id, node_name } = req.params as { id: string; node_name: string };
  const { output } = req.body as { output: boolean };

  if (typeof output !== "boolean") {
    res.status(400).json({ error: "Body must include \"output\" as a boolean" });
    return;
  }

  try {
    manager.pushEvent(id, node_name, output);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(404).json({ error: message });
  }
});

// DELETE /api/redprints/:id — tear down a redprint
redprintRouter.delete("/redprints/:id", (req, res) => {
  const deleted = manager.teardown(req.params.id!);
  if (!deleted) {
    res.status(404).json({ error: "Redprint not found" });
    return;
  }
  res.status(204).end();
});
