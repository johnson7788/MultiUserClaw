import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import type { BridgeConfig } from "../config.js";
import { asyncHandler } from "../utils.js";

export function settingsRoutes(config: BridgeConfig): Router {
  const router = Router();
  const configPath = path.join(config.openclawHome, "openclaw.json");

  function readConfig(): Record<string, unknown> {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  function writeConfig(cfg: Record<string, unknown>): void {
    fs.mkdirSync(config.openclawHome, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf-8");
  }

  // GET /api/settings/config — read openclaw.json
  router.get("/settings/config", asyncHandler(async (_req, res) => {
    const cfg = readConfig();
    res.json({ config: cfg });
  }));

  // PUT /api/settings/config — merge-update openclaw.json
  router.put("/settings/config", asyncHandler(async (req, res) => {
    const updates = req.body as Record<string, unknown>;
    const existing = readConfig();

    // Shallow merge top-level keys, deep merge for gateway
    for (const [key, value] of Object.entries(updates)) {
      if (key === "gateway" && typeof value === "object" && value !== null &&
          typeof existing.gateway === "object" && existing.gateway !== null) {
        existing.gateway = { ...(existing.gateway as Record<string, unknown>), ...(value as Record<string, unknown>) };
      } else {
        existing[key] = value;
      }
    }

    writeConfig(existing);
    res.json({ success: true, config: existing });
  }));

  return router;
}
