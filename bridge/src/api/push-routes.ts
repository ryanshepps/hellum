import { z } from "zod";
import { errorResponse, readJsonBody } from "../http/json";
import type { PushTokenRegistry } from "../push/push-tokens";
import type { Route } from "./route-table";

const IosTokenSchema = z.object({
  token: z.string().regex(/^[0-9a-fA-F]{32,200}$/),
  platform: z.literal("ios"),
  bundle_id: z.string().min(1),
  apns_environment: z.enum(["development", "production"]),
});

export function pushRoutes(tokens: PushTokenRegistry, platformAssistantId: string): readonly Route[] {
  return [
    {
      method: "POST",
      pattern: "notification-intent-result",
      handle: () => Response.json({ ok: true }),
    },
    {
      method: "GET",
      pattern: "platform/status",
      handle: () =>
        Response.json({
          assistantId: platformAssistantId,
          baseUrl: null,
          organizationId: null,
          hasAssistantApiKey: false,
          clientInstallationId: null,
        }),
    },
    {
      method: "POST",
      pattern: "push-tokens",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, IosTokenSchema);
        if (!body) {
          return errorResponse(422, "unsupported_push_registration", "Hellum delivers push only to iOS devices");
        }
        await tokens.upsert({ token: body.token, bundleId: body.bundle_id, environment: body.apns_environment, registeredAt: Date.now() });
        return Response.json({ token: body.token, platform: "ios", bundle_id: body.bundle_id, apns_environment: body.apns_environment });
      },
    },
    {
      method: "DELETE",
      pattern: "push-tokens/:token",
      handle: async ({ params }) => {
        await tokens.remove(params.token ?? "");
        return new Response(null, { status: 204 });
      },
    },
  ];
}
