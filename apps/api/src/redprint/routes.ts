import { Router, type Router as RouterType } from "express";
import type { BlueprintDefinition } from "@repo/backend/blueprints/definition";
import * as manager from "./manager.js";
import { redprintToJSON } from "./types.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("RedprintRoutes");

export const redprintRouter: RouterType = Router();

// POST /api/redprints — dispatch a new redprint from a blueprint
redprintRouter.post("/redprints", (req, res) => {
  const blueprint = req.body as BlueprintDefinition;

  if (!blueprint?.name || !blueprint?.nodes) {
    logger.warn("Rejected POST /redprints — invalid blueprint definition");
    res.status(400).json({ error: "Invalid blueprint definition" });
    return;
  }

  logger.info(`POST /redprints — dispatching blueprint "${blueprint.name}"`);
  const redprint = manager.dispatch(blueprint);
  logger.debug(`Redprint created with id=${redprint.id}`);
  res.status(201).json(redprintToJSON(redprint));
});

// GET /api/redprints — list all redprints
redprintRouter.get("/redprints", (_req, res) => {
  const all = manager.list().map(redprintToJSON);
  logger.debug(`GET /redprints — returning ${all.length} redprint(s)`);
  res.json(all);
});

// GET /api/redprints/:id — get a single redprint
redprintRouter.get("/redprints/:id", (req, res) => {
  const { id } = req.params as { id: string };
  logger.debug(`GET /redprints/${id}`);
  const redprint = manager.get(id);
  if (!redprint) {
    logger.warn(`GET /redprints/${id} — not found`);
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
    logger.warn(`POST /redprints/${id}/nodes/${node_name} — missing or invalid "output" field`);
    res.status(400).json({ error: "Body must include \"output\" as a boolean" });
    return;
  }

  logger.info(`POST /redprints/${id}/nodes/${node_name} — pushing event (output=${output})`);

  try {
    manager.pushEvent(id, node_name, output);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.warn(`POST /redprints/${id}/nodes/${node_name} — error: ${message}`);
    res.status(404).json({ error: message });
  }
});

// DELETE /api/redprints/:id — tear down a redprint
redprintRouter.delete("/redprints/:id", (req, res) => {
  const { id } = req.params as { id: string };
  logger.info(`DELETE /redprints/${id}`);
  const deleted = manager.teardown(id);
  if (!deleted) {
    logger.warn(`DELETE /redprints/${id} — not found`);
    res.status(404).json({ error: "Redprint not found" });
    return;
  }
  logger.debug(`Redprint ${id} torn down successfully`);
  res.status(204).end();
});
