import { errorResponse, readJsonBody } from "../http/json";
import { McpAddBodySchema, McpRemoveBodySchema, McpUpdateBodySchema, type McpService } from "../mcp/mcp-service";
import type { Route } from "./route-table";

export function mcpRoutes(mcp: McpService): readonly Route[] {
  return [
    { method: "GET", pattern: "internal/mcp/list", handle: async () => Response.json(await mcp.list()) },
    { method: "GET", pattern: "internal/mcp/tools-summary", handle: async () => Response.json(await mcp.toolsSummary()) },
    {
      method: "POST",
      pattern: "internal/mcp/add",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, McpAddBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "name and transportType are required");
        }
        await mcp.add(body);
        return Response.json({ ok: true });
      },
    },
    {
      method: "POST",
      pattern: "internal/mcp/update",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, McpUpdateBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "name is required");
        }
        await mcp.update(body);
        return Response.json({ ok: true });
      },
    },
    {
      method: "POST",
      pattern: "internal/mcp/remove",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, McpRemoveBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "name is required");
        }
        await mcp.remove(body.name);
        return Response.json({ ok: true });
      },
    },
    { method: "GET", pattern: "oauth/providers", handle: () => Response.json({ providers: [] }) },
    { method: "GET", pattern: "plugins", handle: () => Response.json({ plugins: [] }) },
    { method: "GET", pattern: "plugins/search", handle: ({ query }) => Response.json({ query: query.get("q") ?? "", ref: "", matches: [] }) },
  ];
}
