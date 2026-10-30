import { z } from "zod";
import { errorResponse, readJsonBody } from "../http/json";
import type { JsonFile } from "../storage/json-file";
import type { Route } from "./route-table";

export const SoundsConfigSchema = z.object({
  globalEnabled: z.boolean(),
  volume: z.number().min(0).max(1),
  events: z.record(z.string(), z.object({ enabled: z.boolean(), sounds: z.array(z.string()) })),
});
type SoundsConfig = z.infer<typeof SoundsConfigSchema>;

export const DEFAULT_SOUNDS: SoundsConfig = { globalEnabled: false, volume: 0.5, events: {} };

export function soundRoutes(store: JsonFile<SoundsConfig>): readonly Route[] {
  return [
    { method: "GET", pattern: "sounds/config", handle: async () => Response.json(await store.read()) },
    {
      method: "PUT",
      pattern: "sounds/config",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, SoundsConfigSchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "globalEnabled, volume and events are required");
        }
        await store.write(body);
        return Response.json(body);
      },
    },
    { method: "GET", pattern: "sounds/available", handle: () => Response.json({ sounds: [] }) },
  ];
}
