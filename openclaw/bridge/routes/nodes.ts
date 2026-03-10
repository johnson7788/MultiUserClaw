import { Router } from "express";
import type { BridgeGatewayClient } from "../gateway-client.js";
import { asyncHandler } from "../utils.js";

export function nodesRoutes(client: BridgeGatewayClient): Router {
  const router = Router();

  // GET /api/nodes — list all nodes (paired + connected)
  router.get("/nodes", asyncHandler(async (_req, res) => {
    // node.list returns { nodes: [...] }
    const raw = await client.request<Record<string, unknown>>("node.list", {});
    const nodes = Array.isArray(raw) ? raw : (Array.isArray((raw as any)?.nodes) ? (raw as any).nodes : []);

    // Also get pairing list for pending requests
    let pending: unknown[] = [];
    let paired: unknown[] = [];
    try {
      const pairRaw = await client.request<Record<string, unknown>>("node.pair.list", {});
      pending = Array.isArray((pairRaw as any)?.pending) ? (pairRaw as any).pending : [];
      paired = Array.isArray((pairRaw as any)?.paired) ? (pairRaw as any).paired : [];
    } catch {
      // older gateways may not support node.pair.list
    }

    res.json({ nodes, pending, paired });
  }));

  // GET /api/nodes/:nodeId — describe a specific node
  router.get("/nodes/:nodeId", asyncHandler(async (req, res) => {
    const result = await client.request("node.describe", { nodeId: req.params.nodeId });
    res.json(result);
  }));

  // POST /api/nodes/pair/approve — approve a pending pairing request
  router.post("/nodes/pair/approve", asyncHandler(async (req, res) => {
    const { requestId } = req.body as { requestId: string };
    const result = await client.request("node.pair.approve", { requestId });
    res.json({ success: true, result });
  }));

  // POST /api/nodes/pair/reject — reject a pending pairing request
  router.post("/nodes/pair/reject", asyncHandler(async (req, res) => {
    const { requestId } = req.body as { requestId: string };
    const result = await client.request("node.pair.reject", { requestId });
    res.json({ success: true, result });
  }));

  // DELETE /api/nodes/:nodeId — remove a paired node (uses device.pair.remove)
  router.delete("/nodes/:nodeId", asyncHandler(async (req, res) => {
    const result = await client.request("device.pair.remove", { deviceId: req.params.nodeId });
    res.json({ success: true, result });
  }));

  // POST /api/nodes/:nodeId/rename — rename a node
  router.post("/nodes/:nodeId/rename", asyncHandler(async (req, res) => {
    const { displayName } = req.body as { displayName: string };
    const result = await client.request("node.rename", { nodeId: req.params.nodeId, displayName });
    res.json({ success: true, result });
  }));

  return router;
}
