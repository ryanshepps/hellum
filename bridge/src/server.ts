import { adminSocketPath, startAdminServer } from "./admin/admin-server";
import { createAssistantApi } from "./api/assistant-api";
import { conversationRoutes } from "./api/conversation-routes";
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
import { log } from "./log";
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

export async function startBridge(config: BridgeConfig): Promise<BridgeServer> {
  const auth = await AuthService.open(createFileDeviceStore(config.stateDir));
  const hub = new EventHub();
  const gateway = new HermesGateway(config.hermesGateway, spawnGatewayProcess);
  const conversations = await ConversationService.open(gateway, hub, createFileConversationStore(config.stateDir));
  const spa = createSpaHandler(config.webDistDir, buildRemoteGatewayConfig(config.assistantName, config.assistantId));
  const authRoutes = createAuthRoutes(auth, config.assistantId);
  const assistantApi = createAssistantApi(new Set([SELF_ASSISTANT_ID, config.assistantId]), [
    ...systemRoutes(),
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
      await server.stop(true);
      await admin.stop();
      await gateway.stop();
    },
  };
}
