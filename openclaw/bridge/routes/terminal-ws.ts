import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import WebSocket, { WebSocketServer } from "ws";

type ClientMessage =
  | { type: "start"; command?: string; cwd?: string }
  | { type: "input"; data: string }
  | { type: "kill" }
  | { type: "ping" };

function send(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function parseMessage(raw: WebSocket.RawData): ClientMessage | null {
  try {
    const txt = typeof raw === "string" ? raw : raw.toString("utf-8");
    const obj = JSON.parse(txt) as ClientMessage;
    if (!obj || typeof obj !== "object" || !("type" in obj)) return null;
    return obj;
  } catch {
    return null;
  }
}

export function createTerminalWs(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    let proc: ChildProcessWithoutNullStreams | null = null;

    const startProc = (command?: string, cwd?: string) => {
      if (proc) {
        try { proc.kill("SIGTERM"); } catch { /* ignore */ }
      }

      const shellCmd = command?.trim() || "bash -il";
      const spawnOpts = {
        cwd: cwd && cwd.trim() ? cwd : process.cwd(),
        env: process.env,
      };

      // Keep a stable interactive shell by default; arbitrary commands run via bash -lc.
      if (shellCmd === "bash -il" || shellCmd === "bash -i" || shellCmd === "bash") {
        proc = spawn("bash", ["-il"], spawnOpts);
      } else {
        proc = spawn("bash", ["-lc", shellCmd], spawnOpts);
      }

      send(ws, { type: "started", command: shellCmd });

      proc.stdout.on("data", (chunk: Buffer) => {
        send(ws, { type: "output", data: chunk.toString("utf-8") });
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        send(ws, { type: "output", data: chunk.toString("utf-8") });
      });
      proc.on("exit", (code, signal) => {
        send(ws, { type: "exit", code, signal: signal ?? null });
        proc = null;
      });
      proc.on("error", (err: NodeJS.ErrnoException) => {
        send(ws, { type: "error", message: err.message });
      });
    };

    ws.on("message", (raw) => {
      const msg = parseMessage(raw);
      if (!msg) return;

      switch (msg.type) {
        case "start":
          startProc(msg.command, msg.cwd);
          break;
        case "input":
          if (proc && proc.stdin.writable) {
            proc.stdin.write(msg.data);
          }
          break;
        case "kill":
          if (proc) {
            try { proc.kill("SIGTERM"); } catch { /* ignore */ }
          }
          break;
        case "ping":
          send(ws, { type: "pong" });
          break;
      }
    });

    ws.on("close", () => {
      if (proc) {
        try { proc.kill("SIGTERM"); } catch { /* ignore */ }
      }
      proc = null;
    });
  });
  return wss;
}
