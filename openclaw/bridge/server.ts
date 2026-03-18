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
import { eventsRoutes } from "./routes/events.js";
import { createTerminalWs } from "./routes/terminal-ws.js";

export interface GatewayRestartable {
  restart(): Promise<void>;
  get client(): BridgeGatewayClient;
}

export function createServer(client: BridgeGatewayClient, config: BridgeConfig, manager?: GatewayRestartable): http.Server {
  const app = express();

  // Middleware
  app.use(express.json({ limit: "50mb" }));

  // When a manager is provided, create a proxy that always delegates to
  // manager.client (which gets replaced on restart). This way all routes
  // automatically use the new client after a gateway restart.
  const liveClient: BridgeGatewayClient = manager
    ? new Proxy(client, {
        get(_target, prop, receiver) {
          return Reflect.get(manager.client, prop, receiver);
        },
      })
    : client;

  // Mount routes
  app.use("/api", sessionsRoutes(liveClient));
  app.use("/api", statusRoutes(liveClient, config));
  app.use("/api", filesRoutes(config));
  app.use("/api", workspaceRoutes(config));
  app.use("/api", skillsRoutes(config, liveClient));
  app.use("/api", commandsRoutes(config));
  app.use("/api", pluginsRoutes(config));
  app.use("/api", cronRoutes(liveClient));
  app.use("/api", agentsRoutes(liveClient));
  app.use("/api", marketplacesRoutes(config));
  app.use("/api", filemanagerRoutes(config));
  app.use("/api", channelsRoutes(liveClient, config));
  app.use("/api", settingsRoutes(config, manager));
  app.use("/api", nodesRoutes(liveClient));
  app.use("/api", eventsRoutes(liveClient));

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[bridge] Error:", err.message);
    res.status(500).json({ detail: err.message });
  });

  // Create HTTP server
  const server = http.createServer(app);

  // WebSocket relay: proxy external WS connections to local gateway (loopback)
  const wss = new WebSocketServer({ noServer: true });
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

  const terminalWss = createTerminalWs();

  // Single upgrade dispatcher for all websocket endpoints.
  server.on("upgrade", (request, socket, head) => {
    let pathname = "/";
    try {
      pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      pathname = "/";
    }

    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
      return;
    }

    if (pathname === "/api/terminal/ws") {
      terminalWss.handleUpgrade(request, socket, head, (ws) => {
        terminalWss.emit("connection", ws, request);
      });
      return;
    }

    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  });

  return server;
}
