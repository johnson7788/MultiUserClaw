import express from "express";
import http from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import type { BridgeConfig } from "./config.js";
import type { BridgeGatewayClient } from "./gateway-client.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { statusRoutes } from "./routes/status.js";
import { filesRoutes } from "./routes/files.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { skillsRoutes } from "./routes/skills.js";
import { commandsRoutes } from "./routes/commands.js";
import { pluginsRoutes } from "./routes/plugins.js";
import { cronRoutes } from "./routes/cron.js";
import { agentsRoutes } from "./routes/agents.js";
import { marketplacesRoutes } from "./routes/marketplaces.js";
import { filemanagerRoutes } from "./routes/filemanager.js";
import { channelsRoutes } from "./routes/channels.js";
import { settingsRoutes } from "./routes/settings.js";
import { nodesRoutes } from "./routes/nodes.js";

export function createServer(client: BridgeGatewayClient, config: BridgeConfig): http.Server {
  const app = express();

  // Middleware
  app.use(express.json({ limit: "50mb" }));

  // Mount routes
  app.use("/api", sessionsRoutes(client));
  app.use("/api", statusRoutes(client, config));
  app.use("/api", filesRoutes(config));
  app.use("/api", workspaceRoutes(config));
  app.use("/api", skillsRoutes(config, client));
  app.use("/api", commandsRoutes(config));
  app.use("/api", pluginsRoutes(config));
  app.use("/api", cronRoutes(client));
  app.use("/api", agentsRoutes(client));
  app.use("/api", marketplacesRoutes(config));
  app.use("/api", filemanagerRoutes(config));
  app.use("/api", channelsRoutes(client, config));
  app.use("/api", settingsRoutes(config));
  app.use("/api", nodesRoutes(client));

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[bridge] Error:", err.message);
    res.status(500).json({ detail: err.message });
  });

  // Create HTTP server
  const server = http.createServer(app);

  // WebSocket relay: proxy external WS connections to local gateway (loopback)
  const wss = new WebSocketServer({ server, path: "/ws" });
  const gatewayUrl = `ws://127.0.0.1:${config.gatewayPort}`;

  wss.on("connection", (downstream) => {
    const upstream = new WebSocket(gatewayUrl, { headers: { origin: `http://127.0.0.1:${config.gatewayPort}` } });
    // Buffer downstream messages until upstream is open
    const pending: { data: WebSocket.RawData; isBinary: boolean }[] = [];
    let upstreamOpen = false;

    upstream.on("open", () => {
      upstreamOpen = true;
      for (const msg of pending) {
        upstream.send(msg.data, { binary: msg.isBinary });
      }
      pending.length = 0;
    });

    upstream.on("message", (data, isBinary) => {
      if (downstream.readyState === WebSocket.OPEN) {
        downstream.send(data, { binary: isBinary });
      }
    });

    downstream.on("message", (data, isBinary) => {
      if (upstreamOpen && upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else {
        pending.push({ data, isBinary });
      }
    });

    upstream.on("close", () => {
      downstream.close();
    });

    downstream.on("close", () => {
      upstream.close();
    });

    upstream.on("error", (err) => {
      console.error("[ws-relay] upstream error:", err.message);
      downstream.close();
    });

    downstream.on("error", (err) => {
      console.error("[ws-relay] downstream error:", err.message);
      upstream.close();
    });
  });

  return server;
}
