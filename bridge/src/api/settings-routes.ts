import { z } from "zod";
import { errorResponse, readJsonBody } from "../http/json";
import type { ModelService } from "../models/model-service";
import { approvalChange, approvalThresholds, APPROVAL_KEYS, ThresholdsSchema } from "../settings/approvals";
import type { HermesSettings } from "../settings/hermes-settings";
import { mergeDeep, type SettingsService } from "../settings/settings-service";
import { SPEECH_KEY_ENV, sttCatalog, ttsCatalog } from "../settings/speech";
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

const CredentialBodySchema = z.object({ service: z.string().min(1), field: z.string().min(1), value: z.string().min(1) }).passthrough();

export function settingsRoutes(models: ModelService, settings: SettingsService, hermes: HermesSettings): readonly Route[] {
  const config = async () => {
    const [llm, hermes] = await Promise.all([models.llm(), settings.view()]);
    return Response.json(mergeDeep(DEFAULT_CONFIG, { ...hermes, llm }), { headers: { "Cache-Control": "no-store" } });
  };
  const thresholds = async () => approvalThresholds((await hermes.read(APPROVAL_KEYS)).values);
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
    { method: "GET", pattern: "permissions/thresholds", handle: async () => Response.json(await thresholds()) },
    {
      method: "PUT",
      pattern: "permissions/thresholds",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, ThresholdsSchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "interactive, autonomous and headless are required");
        }
        await hermes.write(approvalChange(body));
        return Response.json(await thresholds());
      },
    },
    {
      method: "GET",
      pattern: "permissions/thresholds/conversations/:conversationId",
      handle: async () => Response.json({ threshold: (await thresholds()).interactive }),
    },
    { method: "GET", pattern: "tts/providers", handle: () => Response.json({ providers: ttsCatalog() }) },
    { method: "GET", pattern: "stt/providers", handle: () => Response.json({ providers: sttCatalog() }) },
    {
      method: "POST",
      pattern: "credentials/set",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, CredentialBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "service, field and value are required");
        }
        const env = body.field === "api_key" ? SPEECH_KEY_ENV[body.service] : undefined;
        if (!env) {
          return errorResponse(422, "setting_rejected", `Hermes has no ${body.service} ${body.field} credential`);
        }
        await hermes.write({ env: { [env]: body.value } });
        return Response.json({ credentialId: env, service: body.service, field: body.field });
      },
    },
  ];
}
