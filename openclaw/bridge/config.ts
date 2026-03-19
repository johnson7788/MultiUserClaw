import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface BridgeConfig {
  proxyUrl: string;
  proxyToken: string;
  model: string;
  gatewayPort: number;
  bridgePort: number;
  openclawHome: string;
  workspacePath: string;
  uploadsPath: string;
  sessionsPath: string;
}

export function loadConfig(): BridgeConfig {
  const proxyUrl = process.env.NANOBOT_PROXY__URL || "http://localhost:8080/llm/v1";
  const proxyToken = process.env.NANOBOT_PROXY__TOKEN || "dev-token";
  const model = process.env.NANOBOT_AGENTS__DEFAULTS__MODEL || "claude-sonnet-4-20250514";
  const gatewayPort = parseInt(process.env.OPENCLAW_GATEWAY_PORT || "18789", 10);
  const bridgePort = parseInt(process.env.BRIDGE_PORT || "18080", 10);
  const openclawHome = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
  const workspacePath = process.env.OPENCLAW_WORKSPACE || path.join(openclawHome, "workspace");
  const uploadsPath = path.join(openclawHome, "uploads");
  const sessionsPath = path.join(openclawHome, "sessions");

  return {
    proxyUrl,
    proxyToken,
    model,
    gatewayPort,
    bridgePort,
    openclawHome,
    workspacePath,
    uploadsPath,
    sessionsPath,
  };
}

/**
 * Write openclaw config file so the gateway uses our platform LLM proxy.
 */
export function writeOpenclawConfig(cfg: BridgeConfig): void {
  const configDir = cfg.openclawHome;
  fs.mkdirSync(configDir, { recursive: true });

  const openclawConfig = {
    models: {
      mode: "replace",
      providers: {
        "platform-proxy": {
          baseUrl: cfg.proxyUrl,
          api: "openai-completions",
          apiKey: cfg.proxyToken,
          models: [{
            id: cfg.model,
            name: cfg.model,
          }],
        },
      },
    },
    agents: {
      defaults: {
        model: `platform-proxy/${cfg.model}`,
      },
    },
    gateway: {
      mode: "local",
      port: cfg.gatewayPort,
      bind: "loopback",
      auth: { mode: "none" },
      controlUi: {
        allowedOrigins: [
          "http://localhost:3080",
          "http://127.0.0.1:3080",
          "http://localhost:8080",
          "http://127.0.0.1:8080",
          `http://localhost:${cfg.gatewayPort}`,
          `http://127.0.0.1:${cfg.gatewayPort}`,
        ],
      },
    },
  };

  const configPath = path.join(configDir, "openclaw.json");

  // Merge with existing config to preserve user customizations
  if (fs.existsSync(configPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      // --- models: add platform-proxy provider alongside user's existing providers ---
      if (!existing.models) existing.models = {};
      if (!existing.models.providers) existing.models.providers = {};
      // Keep user's mode (e.g. "merge") — only default to "merge" if not set
      if (!existing.models.mode) existing.models.mode = "merge";
      existing.models.providers["platform-proxy"] = openclawConfig.models.providers["platform-proxy"];

      // --- agents: set default model to platform-proxy ---
      if (!existing.agents) existing.agents = {};
      if (!existing.agents.defaults) existing.agents.defaults = {};
      existing.agents.defaults.model = openclawConfig.agents.defaults.model;

      // --- agents.defaults.models: ensure platform-proxy model is in the allowlist ---
      // If models map exists (whitelist mode), add our platform-proxy model so it's allowed.
      // If models map is empty or absent, openclaw allows any model (allowAny mode).
      const proxyModel = openclawConfig.agents.defaults.model; // e.g. "platform-proxy/kimi/kimi-k2.5"
      if (existing.agents.defaults.models && typeof existing.agents.defaults.models === "object") {
        if (!existing.agents.defaults.models[proxyModel]) {
          existing.agents.defaults.models[proxyModel] = { alias: "Platform Proxy" };
        }
      }

      // --- agents.list: rewrite per-agent model overrides to use platform-proxy ---
      if (Array.isArray(existing.agents.list)) {
        for (const agent of existing.agents.list) {
          if (agent.model && !agent.model.startsWith("platform-proxy/")) {
            agent.model = proxyModel;
          }
        }
      }

      // --- gateway: always ensure auth.mode = "none" (bridge connects without token) ---
      if (!existing.gateway) existing.gateway = {};
      const gw = existing.gateway as Record<string, unknown>;
      gw.mode = "local";
      gw.port = cfg.gatewayPort;
      gw.bind = "loopback";
      gw.auth = { mode: "none" };
      // Merge controlUi origins (keep user's + add defaults)
      if (!gw.controlUi || typeof gw.controlUi !== "object") {
        gw.controlUi = openclawConfig.gateway.controlUi;
      } else {
        const ui = gw.controlUi as Record<string, unknown>;
        const defaultOrigins = new Set(openclawConfig.gateway.controlUi.allowedOrigins);
        const existing_origins = Array.isArray(ui.allowedOrigins) ? ui.allowedOrigins as string[] : [];
        for (const o of existing_origins) defaultOrigins.add(o);
        ui.allowedOrigins = Array.from(defaultOrigins);
      }

      // --- plugins: preserve user-configured allow list ---
      // If plugins.allow already exists (e.g. from openclaw_defaults.json merge), keep it.
      // Only default to empty array if no allow list was previously configured.
      if (!existing.plugins) existing.plugins = {};
      if (!Array.isArray(existing.plugins.allow)) {
        existing.plugins.allow = [];
      }

      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf-8");
    } catch {
      // Corrupted file, overwrite
      fs.writeFileSync(configPath, JSON.stringify(openclawConfig, null, 2), "utf-8");
    }
  } else {
    fs.writeFileSync(configPath, JSON.stringify(openclawConfig, null, 2), "utf-8");
  }

  // Ensure workspace, uploads, sessions directories exist
  fs.mkdirSync(cfg.workspacePath, { recursive: true });
  fs.mkdirSync(cfg.uploadsPath, { recursive: true });
  fs.mkdirSync(cfg.sessionsPath, { recursive: true });
}
