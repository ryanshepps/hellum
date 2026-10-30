import { z } from "zod";
import { errorResponse, readJsonBody } from "../http/json";
import type { ModelService } from "../models/model-service";
import { mergeDeep, type SettingsService } from "../settings/settings-service";
import { ProfileEntrySchema } from "../translate/inference";
import type { Route } from "./route-table";

const DEFAULT_CONFIG = {
  conversations: { autoArchive: { enabled: false, afterDays: 30 } },
  notifications: { newMessageEnabled: true, allAlertsEnabled: false },
  memory: { enabled: true },
} as const;

const ConfigPatchSchema = z
  .object({
    llm: z
      .object({
        profiles: z.record(z.string(), ProfileEntrySchema.nullable()).optional(),
        profileOrder: z.array(z.string()).optional(),
        activeProfile: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function settingsRoutes(models: ModelService, settings: SettingsService): readonly Route[] {
  const config = async () => {
    const [llm, hermes] = await Promise.all([models.llm(), settings.view()]);
    return Response.json(mergeDeep(DEFAULT_CONFIG, { ...hermes, llm }), { headers: { "Cache-Control": "no-store" } });
  };
  return [
    { method: "GET", pattern: "config", handle: config },
    {
      method: "PATCH",
      pattern: "config",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, ConfigPatchSchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "invalid config patch");
        }
        if (body.llm) {
          await models.patchLlm(body.llm);
        }
        await settings.apply(body);
        return config();
      },
    },
  ];
}
