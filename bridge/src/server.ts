import { adminSocketPath, startAdminServer } from "./admin/admin-server";
import { createAssistantApi } from "./api/assistant-api";
import { conversationRoutes } from "./api/conversation-routes";
import { pushRoutes } from "./api/push-routes";
import { systemRoutes } from "./api/system-routes";
import { createAuthRoutes } from "./auth/auth-routes";
import { AuthService } from "./auth/auth-service";
import { createFileDeviceStore } from "./auth/device-store";
import type { BridgeConfig } from "./config";
import { ConversationService } from "./conversations/conversation-service";
import { createFileConversationStore } from "./conversations/conversation-store";
import { EventHub } from "./events/event-hub";
import { spawnGatewayProcess } from "./hermes/gateway-process";
import { HermesGateway } from "./hermes/hermes-gateway";
import { bearerToken, errorResponse } from "./http/json";
import { loadIdentity } from "./identity";
import { log } from "./log";
import { APNS_ORIGINS, createApnsClient } from "./push/apns-client";
import { createTokenCache } from "./push/apns-jwt";
import { PushNotifier } from "./push/push-notifier";
import { PushTokenRegistry } from "./push/push-tokens";
import { buildRemoteGatewayConfig } from "./spa/index-html";
import { createSpaHandler } from "./spa/spa-handler";

const SELF_ASSISTANT_ID = "self";
const MAX_IDLE_TIMEOUT_SECONDS = 255;

export type BridgeServer = {
  readonly url: URL;
  readonly adminSocketPath: string;
  readonly stop: () => Promise<void>;
};

function notFound(request: Request): Response {
  const url = new URL(request.url);
  log.warn("unhandled route", { method: request.method, path: url.pathname, query: url.search });
  return errorResponse(404, "not_found", "Not supported by Hellum");
}

async function startPushNotifier(config: BridgeConfig, hub: EventHub, tokens: PushTokenRegistry): Promise<PushNotifier | null> {
  const apns = config.apns;
  if (!apns) {
    log.info("push notifications disabled: no APNs key configured");
    return null;
  }
  const providerToken = createTokenCache({
    keyId: apns.keyId,
    teamId: apns.teamId,
    privateKeyPem: await Bun.file(apns.keyPath).text(),
  });
  const origins = apns.originOverride ? { development: apns.originOverride, production: apns.originOverride } : APNS_ORIGINS;
  return new PushNotifier(hub, tokens, createApnsClient(providerToken, origins), config.assistantName);
}

export async function startBridge(config: BridgeConfig): Promise<BridgeServer> {
  const auth = await AuthService.open(createFileDeviceStore(config.stateDir));
  const identity = await loadIdentity(config.stateDir);
  const pushTokens = await PushTokenRegistry.open(config.stateDir);
  const hub = new EventHub();
  const notifier = await startPushNotifier(config, hub, pushTokens);
  const gateway = new HermesGateway(config.hermesGateway, spawnGatewayProcess);
  const conversations = await ConversationService.open(gateway, hub, createFileConversationStore(config.stateDir));
  const spa = createSpaHandler(config.webDistDir, buildRemoteGatewayConfig(config.assistantName, config.assistantId));
  const authRoutes = createAuthRoutes(auth, config.assistantId);
  const assistantApi = createAssistantApi(new Set([SELF_ASSISTANT_ID, config.assistantId, identity.platformAssistantId]), [
    ...systemRoutes(),
    ...pushRoutes(pushTokens, identity.platformAssistantId),
    ...conversationRoutes(conversations, hub),
  ]);
  const socketPath = adminSocketPath(config.stateDir);
  const admin = await startAdminServer(auth, socketPath);

  async function handleApi(request: Request): Promise<Response> {
    const token = bearerToken(request);
    if (!token || !auth.authenticate(token)) {
      return errorResponse(401, "unauthorized", "Missing or expired access token");
    }
    return (await assistantApi(request)) ?? notFound(request);
  }

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: MAX_IDLE_TIMEOUT_SECONDS,
    async fetch(request) {
      const response = (await spa(request)) ?? (await authRoutes(request));
      if (response) {
        return response;
      }
      return new URL(request.url).pathname.startsWith("/v1/") ? handleApi(request) : notFound(request);
    },
  });

  return {
    url: server.url,
    adminSocketPath: socketPath,
    stop: async () => {
      notifier?.stop();
      await server.stop(true);
      await admin.stop();
      await gateway.stop();
    },
  };
}
