import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AuthService } from "../auth/auth-service";
import { errorResponse, readJsonBody } from "../http/json";
import { deliverySignal, HermesDeliverySchema } from "../notifications/hermes-delivery";
import type { EmitResult, NotificationRouter } from "../notifications/notification-router";
import { UrgencySchema } from "../notifications/signal";

const ApproveBodySchema = z.object({ userCode: z.string().min(1) });
const NotificationBodySchema = z.object({
  message: z.string().trim().min(1),
  title: z.string().optional(),
  urgency: UrgencySchema,
  sourceChannel: z.string().min(1),
  sourceEventName: z.string().min(1),
  sourceContextId: z.string().trim().min(1).optional(),
  dedupeKey: z.string().min(1).optional(),
});

async function sendNotification(notifications: NotificationRouter, request: Request): Promise<Response> {
  const body = await readJsonBody(request, NotificationBodySchema);
  if (!body) {
    return errorResponse(400, "invalid_request", "message, urgency, sourceChannel and sourceEventName are required");
  }
  const result = await notifications.emit({
    sourceEventName: body.sourceEventName,
    sourceChannel: body.sourceChannel,
    sourceContextId: body.sourceContextId,
    urgency: body.urgency,
    requestedTitle: body.title,
    requestedMessage: body.message,
    dedupeKey: body.dedupeKey,
  });
  return emitted(result);
}

function emitted(result: EmitResult): Response {
  return Response.json({
    ok: true,
    dispatched: !result.deduplicated && result.channels.length > 0,
    deduplicated: result.deduplicated,
    selectedChannels: result.channels,
    remotePushAccepted: result.remotePushAccepted,
  });
}

async function deliverFromHermes(notifications: NotificationRouter, request: Request): Promise<Response> {
  const body = await readJsonBody(request, HermesDeliverySchema);
  if (!body) {
    return errorResponse(400, "invalid_request", "message is required");
  }
  const signal = deliverySignal(body);
  return signal ? emitted(await notifications.emit(signal)) : emitted({ deduplicated: false, channels: [], remotePushAccepted: false });
}

export function adminSocketPath(stateDir: string): string {
  return join(stateDir, "admin.sock");
}

async function route(auth: AuthService, notifications: NotificationRouter, request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === "POST" && pathname === "/notifications") {
    return sendNotification(notifications, request);
  }
  if (request.method === "POST" && pathname === "/deliveries") {
    return deliverFromHermes(notifications, request);
  }
  const deviceMatch = /^\/devices\/([^/]+)$/.exec(pathname);
  if (request.method === "POST" && pathname === "/pairings") {
    return Response.json(auth.createApprovedPairing());
  }
  if (request.method === "GET" && pathname === "/pairings") {
    return Response.json({ pending: auth.listPending().map(({ userCode, expiresAt }) => ({ userCode, expiresAt })) });
  }
  if (request.method === "POST" && pathname === "/pairings/approve") {
    const body = await readJsonBody(request, ApproveBodySchema);
    if (!body) {
      return errorResponse(400, "invalid_request", "userCode is required");
    }
    return auth.approve(body.userCode)
      ? Response.json({ status: "approved" })
      : errorResponse(404, "not_found", "No pending pairing has that code");
  }
  if (request.method === "GET" && pathname === "/devices") {
    return Response.json({
      devices: auth.listDevices().map(({ deviceId, name, platform, pairedAt, lastSeenAt }) => ({
        deviceId,
        name,
        platform,
        pairedAt,
        lastSeenAt,
      })),
    });
  }
  if (request.method === "DELETE" && deviceMatch?.[1]) {
    return (await auth.revoke(decodeURIComponent(deviceMatch[1])))
      ? Response.json({ status: "revoked" })
      : errorResponse(404, "not_found", "No paired device has that id");
  }
  return errorResponse(404, "not_found", "Unknown admin route");
}

export type AdminServer = { readonly stop: () => Promise<void> };

export async function startAdminServer(auth: AuthService, notifications: NotificationRouter, socketPath: string): Promise<AdminServer> {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  await rm(socketPath, { force: true });
  const server = Bun.serve({ unix: socketPath, fetch: (request) => route(auth, notifications, request) });
  await chmod(socketPath, 0o600);
  return {
    stop: async () => {
      await server.stop(true);
      await rm(socketPath, { force: true });
    },
  };
}
