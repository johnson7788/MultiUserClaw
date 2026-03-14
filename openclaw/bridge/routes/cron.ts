import { Router } from "express";
import type { BridgeGatewayClient } from "../gateway-client.js";
import { asyncHandler } from "../utils.js";

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule_kind: string;
  schedule_display: string;
  schedule_expr: string | null;
  schedule_every_ms: number | null;
  message: string;
  deliver: boolean;
  channel: string | null;
  to: string | null;
  next_run_at_ms: number | null;
  last_run_at_ms: number | null;
  last_status: string | null;
  last_error: string | null;
  created_at_ms: number;
}

type LegacyCreateBody = {
  name?: unknown;
  message?: unknown;
  every_seconds?: unknown;
  cron_expr?: unknown;
  at_iso?: unknown;
  deliver?: unknown;
  channel?: unknown;
  to?: unknown;
  schedule?: unknown;
  payload?: unknown;
  sessionTarget?: unknown;
  wakeMode?: unknown;
  delivery?: unknown;
};

function formatScheduleDisplay(scheduleKind: string, scheduleExpr: string | null, scheduleEveryMs: number | null): string {
  if (scheduleKind === "every" && typeof scheduleEveryMs === "number" && scheduleEveryMs > 0) {
    const seconds = Math.floor(scheduleEveryMs / 1000);
    if (seconds % 3600 === 0) return `every ${seconds / 3600} hour(s)`;
    if (seconds % 60 === 0) return `every ${seconds / 60} minute(s)`;
    return `every ${seconds} second(s)`;
  }
  if (scheduleKind === "cron" && scheduleExpr) return scheduleExpr;
  if (scheduleKind === "at" && scheduleExpr) return scheduleExpr;
  return "";
}

function serializeJob(job: Record<string, unknown>): CronJob {
  const schedule = (job.schedule && typeof job.schedule === "object")
    ? (job.schedule as Record<string, unknown>)
    : null;
  const state = (job.state && typeof job.state === "object")
    ? (job.state as Record<string, unknown>)
    : null;
  const payload = (job.payload && typeof job.payload === "object")
    ? (job.payload as Record<string, unknown>)
    : null;

  const scheduleKind =
    (schedule?.kind as string) ||
    (job.scheduleKind as string) ||
    (job.schedule_kind as string) ||
    "every";

  const scheduleExpr =
    (schedule?.expr as string) ||
    (schedule?.at as string) ||
    (job.scheduleExpr as string) ||
    (job.schedule_expr as string) ||
    null;

  const scheduleEveryMs =
    (schedule?.everyMs as number) ||
    (job.scheduleEveryMs as number) ||
    (job.schedule_every_ms as number) ||
    null;

  return {
    id: (job.id as string) || "",
    name: (job.name as string) || "",
    enabled: (job.enabled as boolean) ?? true,
    schedule_kind: scheduleKind,
    schedule_display:
      (job.scheduleDisplay as string) ||
      (job.schedule_display as string) ||
      formatScheduleDisplay(scheduleKind, scheduleExpr, scheduleEveryMs),
    schedule_expr: scheduleExpr,
    schedule_every_ms: scheduleEveryMs,
    message:
      (payload?.message as string) ||
      (payload?.text as string) ||
      (job.message as string) ||
      "",
    deliver: (job.deliver as boolean) ?? false,
    channel: (job.channel as string) || null,
    to: (job.to as string) || null,
    next_run_at_ms:
      (state?.nextRunAtMs as number) ||
      (job.nextRunAtMs as number) ||
      (job.next_run_at_ms as number) ||
      null,
    last_run_at_ms:
      (state?.lastRunAtMs as number) ||
      (job.lastRunAtMs as number) ||
      (job.last_run_at_ms as number) ||
      null,
    last_status:
      (state?.lastStatus as string) ||
      (state?.lastRunStatus as string) ||
      (job.lastStatus as string) ||
      (job.last_status as string) ||
      null,
    last_error:
      (state?.lastError as string) ||
      (job.lastError as string) ||
      (job.last_error as string) ||
      null,
    created_at_ms: (job.createdAtMs as number) || (job.created_at_ms as number) || Date.now(),
  };
}

function toCronAddParams(body: LegacyCreateBody): Record<string, unknown> {
  // If caller already sends new protocol params, pass through untouched.
  if (body.schedule && body.payload) {
    return {
      name: body.name,
      schedule: body.schedule,
      payload: body.payload,
      sessionTarget: body.sessionTarget ?? "isolated",
      wakeMode: body.wakeMode ?? "now",
      delivery: body.delivery,
    };
  }

  let schedule: Record<string, unknown> | null = null;
  if (typeof body.every_seconds === "number" && body.every_seconds > 0) {
    schedule = { kind: "every", everyMs: Math.floor(body.every_seconds * 1000) };
  } else if (typeof body.cron_expr === "string" && body.cron_expr.trim()) {
    schedule = { kind: "cron", expr: body.cron_expr.trim() };
  } else if (typeof body.at_iso === "string" && body.at_iso.trim()) {
    schedule = { kind: "at", at: body.at_iso.trim() };
  }

  if (!schedule) {
    throw new Error("Must specify every_seconds, cron_expr, or at_iso");
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    throw new Error("message is required");
  }

  const addParams: Record<string, unknown> = {
    name: typeof body.name === "string" ? body.name : "Untitled job",
    schedule,
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: {
      kind: "agentTurn",
      message,
    },
  };

  if (body.deliver === true) {
    addParams.delivery = {
      mode: "announce",
      channel: typeof body.channel === "string" && body.channel.trim() ? body.channel.trim() : undefined,
      to: typeof body.to === "string" && body.to.trim() ? body.to.trim() : undefined,
    };
  } else {
    addParams.delivery = { mode: "none" };
  }

  return addParams;
}

export function cronRoutes(client: BridgeGatewayClient): Router {
  const router = Router();

  // GET /api/cron/jobs
  router.get("/cron/jobs", asyncHandler(async (req, res) => {
    const includeDisabled = req.query.include_disabled === "true";

    try {
      const raw = await client.request<Record<string, unknown>[] | { jobs: Record<string, unknown>[] }>("cron.list", {});
      const jobs = Array.isArray(raw) ? raw : (raw?.jobs || []);
      let result = jobs.map(serializeJob);

      if (!includeDisabled) {
        result = result.filter((j) => j.enabled);
      }

      // Sort by next_run_at_ms ascending
      result.sort((a, b) => (a.next_run_at_ms || Infinity) - (b.next_run_at_ms || Infinity));
      res.json(result);
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  }));

  // POST /api/cron/jobs
  router.post("/cron/jobs", asyncHandler(async (req, res) => {
    try {
      const params = toCronAddParams(req.body as LegacyCreateBody);
      const job = await client.request<Record<string, unknown>>("cron.add", params);
      res.json(serializeJob(job));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("Must specify") || msg.includes("required")) {
        res.status(400).json({ detail: msg });
      } else {
        res.status(500).json({ detail: msg });
      }
    }
  }));

  // DELETE /api/cron/jobs/:job_id
  router.delete("/cron/jobs/:job_id", asyncHandler(async (req, res) => {
    try {
      await client.request("cron.remove", { id: req.params.job_id });
      res.json({ ok: true });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("not found")) {
        res.status(404).json({ detail: "Job not found" });
      } else {
        res.status(500).json({ detail: msg });
      }
    }
  }));

  // PUT /api/cron/jobs/:job_id/toggle
  router.put("/cron/jobs/:job_id/toggle", asyncHandler(async (req, res) => {
    const { enabled } = req.body;

    try {
      const job = await client.request<Record<string, unknown>>("cron.update", {
        id: req.params.job_id,
        patch: { enabled: Boolean(enabled) },
      });
      res.json(serializeJob(job));
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("not found")) {
        res.status(404).json({ detail: "Job not found" });
      } else {
        res.status(500).json({ detail: msg });
      }
    }
  }));

  // POST /api/cron/jobs/:job_id/run
  router.post("/cron/jobs/:job_id/run", asyncHandler(async (req, res) => {
    try {
      await client.request("cron.run", { id: req.params.job_id });
      res.json({ ok: true });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("not found")) {
        res.status(404).json({ detail: "Job not found" });
      } else {
        res.status(500).json({ detail: msg });
      }
    }
  }));

  return router;
}
