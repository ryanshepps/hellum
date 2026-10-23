import { z } from "zod";
import { errorResponse, readJsonBody } from "../http/json";
import type { ScheduleService } from "../schedules/schedule-service";
import type { Route } from "./route-table";

const CreateBodySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().default(""),
  expression: z.string().trim().min(1),
  message: z.string().trim().min(1),
  enabled: z.boolean().default(true),
});

const PatchBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  expression: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).optional(),
});

const ToggleBodySchema = z.object({ enabled: z.boolean() });

const DEFAULT_RUNS_LIMIT = 10;

function positiveNumber(raw: string | null): number | null {
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function scheduleRoutes(schedules: ScheduleService): readonly Route[] {
  const listed = async () => Response.json({ schedules: await schedules.list() });
  return [
    { method: "GET", pattern: "schedules", handle: listed },
    {
      method: "POST",
      pattern: "schedules",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, CreateBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "name, expression and message are required");
        }
        return Response.json({ schedule: await schedules.create(body) });
      },
    },
    { method: "GET", pattern: "schedules/usage-summary", handle: () => Response.json({ summaries: [] }) },
    { method: "GET", pattern: "schedules/worker/status", handle: () => Response.json({ status: "running" }) },
    { method: "GET", pattern: "schedules/:id", handle: async ({ params }) => Response.json({ schedule: await schedules.get(params.id ?? "") }) },
    {
      method: "PATCH",
      pattern: "schedules/:id",
      handle: async ({ request, params }) => {
        const body = await readJsonBody(request, PatchBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "invalid schedule changes");
        }
        await schedules.update(params.id ?? "", body);
        return listed();
      },
    },
    {
      method: "DELETE",
      pattern: "schedules/:id",
      handle: async ({ params }) => {
        await schedules.remove(params.id ?? "");
        return listed();
      },
    },
    {
      method: "POST",
      pattern: "schedules/:id/toggle",
      handle: async ({ request, params }) => {
        const body = await readJsonBody(request, ToggleBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "enabled is required");
        }
        await schedules.setEnabled(params.id ?? "", body.enabled);
        return listed();
      },
    },
    {
      method: "POST",
      pattern: "schedules/:id/cancel",
      handle: async ({ params }) => {
        await schedules.setEnabled(params.id ?? "", false);
        return listed();
      },
    },
    {
      method: "POST",
      pattern: "schedules/:id/run",
      handle: async ({ params }) => {
        await schedules.runNow(params.id ?? "");
        return listed();
      },
    },
    {
      method: "GET",
      pattern: "schedules/:id/runs",
      handle: async ({ params, query }) =>
        Response.json(await schedules.runs(params.id ?? "", positiveNumber(query.get("limit")) ?? DEFAULT_RUNS_LIMIT, positiveNumber(query.get("before")))),
    },
  ];
}
