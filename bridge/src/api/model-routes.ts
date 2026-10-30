import { z } from "zod";
import { errorResponse, readJsonBody } from "../http/json";
import type { ModelService } from "../models/model-service";
import type { Route } from "./route-table";

const ActiveProfileBodySchema = z.object({ name: z.string().min(1) });
const ConnectionBodySchema = z.object({ name: z.string().min(1), provider: z.string().min(1) }).passthrough();
const SecretBodySchema = z.object({ type: z.string(), name: z.string().min(1), value: z.string() });
const SecretReadBodySchema = z.object({ type: z.string(), name: z.string().min(1) });

const MASKED_SECRET = "••••••••";

export function modelRoutes(models: ModelService): readonly Route[] {
  return [
    { method: "GET", pattern: "config/llm/call-sites", handle: () => Response.json({ domains: [], callSites: [] }) },
    {
      method: "PUT",
      pattern: "inference/active-profile",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, ActiveProfileBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "name is required");
        }
        return Response.json({ ok: true, activeProfile: await models.setActiveProfile(body.name) });
      },
    },
    { method: "POST", pattern: "inference/profiles/:name/validate", handle: () => Response.json({ check: null }) },
    { method: "GET", pattern: "inference/models", handle: async () => Response.json({ models: await models.models() }) },
    { method: "GET", pattern: "inference/provider-connections", handle: async () => Response.json({ connections: await models.connections() }) },
    {
      method: "POST",
      pattern: "inference/provider-connections",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, ConnectionBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "name and provider are required");
        }
        return Response.json(await models.connectionForProvider(body.provider, body.name), { status: 201 });
      },
    },
    { method: "GET", pattern: "inference/provider-connections/:name", handle: async ({ params }) => Response.json(await models.connection(params.name ?? "")) },
    { method: "PATCH", pattern: "inference/provider-connections/:name", handle: async ({ params }) => Response.json(await models.connection(params.name ?? "")) },
    {
      method: "DELETE",
      pattern: "inference/provider-connections/:name",
      handle: async ({ params }) => {
        await models.disconnect(params.name ?? "");
        return Response.json({ ok: true });
      },
    },
    {
      method: "GET",
      pattern: "secrets",
      handle: async () => Response.json({ secrets: (await models.secretNames()).map((name) => ({ type: "credential", name })), accounts: [] }),
    },
    {
      method: "POST",
      pattern: "secrets",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, SecretBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "type, name and value are required");
        }
        await models.saveSecret(body.name, body.value);
        return Response.json({ success: true, type: body.type, name: body.name });
      },
    },
    {
      method: "POST",
      pattern: "secrets/read",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, SecretReadBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "type and name are required");
        }
        const found = await models.hasSecret(body.name);
        return Response.json({ found, value: "", masked: found ? MASKED_SECRET : "", unreachable: false });
      },
    },
  ];
}
