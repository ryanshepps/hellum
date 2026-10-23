import { z } from "zod";
import { errorResponse, readJsonBody } from "../http/json";
import type { MemoryService } from "../memory/memory-service";
import { memoryGraph, memoryNodeDetail } from "../translate/memory-graph";
import type { Route } from "./route-table";

const RememberBodySchema = z.object({ content: z.string().trim().min(1) });

export function memoryRoutes(memory: MemoryService): readonly Route[] {
  return [
    {
      method: "GET",
      pattern: "memory/stats",
      handle: async () => {
        const snapshot = await memory.snapshot();
        return Response.json({ concepts: snapshot.memory.length + snapshot.user.length, graph_supported: true, tier: "v3" });
      },
    },
    {
      method: "GET",
      pattern: "memory-graph",
      handle: async () => Response.json({ backend: "hermes", supported: true, ...memoryGraph(await memory.snapshot()), truncated: false }),
    },
    {
      method: "GET",
      pattern: "memory-graph-node",
      handle: async ({ query }) => Response.json(memoryNodeDetail(await memory.snapshot(), query.get("id") ?? "")),
    },
    {
      method: "POST",
      pattern: "memory/remember",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, RememberBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "content is required");
        }
        await memory.add("user", body.content);
        return Response.json({ success: true, message: "Saved to Hermes' memory of you." });
      },
    },
    { method: "POST", pattern: "memory/v2/list-concept-pages", handle: () => Response.json({ pages: [] }) },
  ];
}
