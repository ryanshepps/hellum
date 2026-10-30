import { join } from "node:path";
import { adminSocketPath, startAdminServer } from "./admin/admin-server";
import { attachmentRoutes } from "./api/attachment-routes";
import { avatarRoutes } from "./api/avatar-routes";
import { createAssistantApi } from "./api/assistant-api";
import { mcpRoutes } from "./api/mcp-routes";
import { memoryRoutes } from "./api/memory-routes";
import { modelRoutes } from "./api/model-routes";
import { AttachmentStore } from "./attachments/attachment-store";
import { conversationRoutes } from "./api/conversation-routes";
import { pushRoutes } from "./api/push-routes";
import { scheduleRoutes } from "./api/schedule-routes";
import { DEFAULT_SOUNDS, soundRoutes, SoundsConfigSchema } from "./api/sound-routes";
import { skillRoutes } from "./api/skill-routes";
import { usageRoutes } from "./api/usage-routes";
import { voiceRoutes } from "./api/voice-routes";
import { systemRoutes } from "./api/system-routes";
import { settingsRoutes } from "./api/settings-routes";
import { createAuthRoutes } from "./auth/auth-routes";
import { createFileAccessStore } from "./auth/access-store";
import { AuthService } from "./auth/auth-service";
import { createFileDeviceStore } from "./auth/device-store";
import type { BridgeConfig } from "./config";
import { ConversationService } from "./conversations/conversation-service";
import { createFileConversationStore } from "./conversations/conversation-store";
import { EventHub } from "./events/event-hub";
import { spawnGatewayProcess } from "./hermes/gateway-process";
import { attachGatewaySocket } from "./hermes/gateway-socket";
import { HermesGateway } from "./hermes/hermes-gateway";
import { bearerToken, errorResponse } from "./http/json";
import { loadIdentity } from "./identity";
import { log } from "./log";
import { McpService } from "./mcp/mcp-service";
import { MemoryService } from "./memory/memory-service";
import { ModelService } from "./models/model-service";
import { EMPTY_PROFILE_STORE, ProfileStoreSchema } from "./translate/inference";
import { APNS_ORIGINS, createApnsClient } from "./push/apns-client";
import { createTokenCache } from "./push/apns-jwt";
import { NotificationLog } from "./notifications/notification-log";
import { NotificationRouter } from "./notifications/notification-router";
import { OutsideChatWatcher } from "./notifications/outside-chat-watcher";
import { PlatformPush } from "./notifications/platform-push";
import { startReplyNotifications } from "./notifications/reply-producer";
import { PushTokenRegistry } from "./push/push-tokens";
import { ScheduleDescriptionsSchema, ScheduleService } from "./schedules/schedule-service";
import { CredentialService } from "./settings/credentials";
import { HermesSettings } from "./settings/hermes-settings";
import { SETTINGS_SECTIONS } from "./settings/sections";
import { SettingsService } from "./settings/settings-service";
import { WEB_KEY_ENV } from "./settings/web";
import { SkillService } from "./skills/skill-service";
import { UsageService } from "./usage/usage-service";
import { VoiceService } from "./voice/voice-service";
import { buildRemoteGatewayConfig } from "./spa/index-html";
import { createSpaHandler } from "./spa/spa-handler";
import { privateJsonFile } from "./storage/json-file";

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

async function startPlatformPush(config: BridgeConfig, tokens: PushTokenRegistry): Promise<PlatformPush | null> {
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
  return new PlatformPush(tokens, createApnsClient(providerToken, origins));
}

export async function startBridge(config: BridgeConfig): Promise<BridgeServer> {
  const auth = await AuthService.open(createFileDeviceStore(config.stateDir), createFileAccessStore(config.stateDir));
  const identity = await loadIdentity(config.stateDir);
  const pushTokens = await PushTokenRegistry.open(config.stateDir);
  const hub = new EventHub();
  const notifications = new NotificationRouter(hub, await NotificationLog.open(config.stateDir), await startPlatformPush(config, pushTokens), config.assistantName);
  const stopReplyNotifications = startReplyNotifications(hub, notifications);
  const outsideChats = await OutsideChatWatcher.start(config.stateDir, config.hermesHelpers, notifications, config.outsideChatPollMs);
  const gateway = new HermesGateway(config.hermesGateway, config.hermesGateway.mode === "attach" ? attachGatewaySocket : spawnGatewayProcess);
  const attachments = await AttachmentStore.open(config.stateDir);
  const conversations = await ConversationService.open(gateway, hub, createFileConversationStore(config.stateDir), attachments, config.hermesHelpers);
  gateway.start().catch((error: unknown) => {
    log.error("hermes gateway failed to start", { error: error instanceof Error ? error.message : String(error) });
  });
  const spa = createSpaHandler(config.webDistDir, buildRemoteGatewayConfig(config.assistantName, config.assistantId));
  const authRoutes = createAuthRoutes(auth, config.assistantId);
  const models = new ModelService(
    config.hermesHelpers,
    privateJsonFile(join(config.stateDir, "llm-profiles.json"), ProfileStoreSchema, EMPTY_PROFILE_STORE),
    () => conversations.releaseIdleSessions(),
    () => conversations.markCredentialsChanged(),
  );
  const hermesSettings = new HermesSettings(config.hermesHelpers, () => conversations.markCredentialsChanged());
  const assistantApi = createAssistantApi(new Set([SELF_ASSISTANT_ID, config.assistantId, identity.platformAssistantId]), [
    ...systemRoutes(config.assistantName),
    ...avatarRoutes(),
    ...pushRoutes(pushTokens, identity.platformAssistantId),
    ...attachmentRoutes(attachments),
    ...memoryRoutes(new MemoryService(config.hermesHelpers)),
    ...mcpRoutes(new McpService(config.hermesHelpers, () => conversations.markMcpChanged())),
    ...modelRoutes(models, new CredentialService(models, hermesSettings, WEB_KEY_ENV)),
    ...settingsRoutes(models, new SettingsService(hermesSettings, SETTINGS_SECTIONS), hermesSettings),
    ...scheduleRoutes(
      new ScheduleService(
        config.hermesHelpers,
        privateJsonFile(join(config.stateDir, "schedule-descriptions.json"), ScheduleDescriptionsSchema, {}),
        () => conversations.sessionRows(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    ),
    ...skillRoutes(new SkillService(config.hermesHelpers)),
    ...soundRoutes(privateJsonFile(join(config.stateDir, "sounds.json"), SoundsConfigSchema, DEFAULT_SOUNDS)),
    ...usageRoutes(new UsageService(config.hermesHelpers), Intl.DateTimeFormat().resolvedOptions().timeZone),
    ...voiceRoutes(new VoiceService(config.hermesHelpers, join(config.stateDir, "voice"))),
    ...conversationRoutes(conversations, hub),
  ]);
  const socketPath = adminSocketPath(config.stateDir);
  const admin = await startAdminServer(auth, notifications, socketPath);

  async function handleApi(request: Request): Promise<Response> {
    const token = bearerToken(request);
    if (!token || !auth.authenticate(token)) {
      return errorResponse(401, "unauthorized", "Missing or expired access token");
    }
    const response = (await assistantApi(request)) ?? notFound(request);
    if (response.status >= 400 && response.status !== 404) {
      log.warn("assistant api error", { method: request.method, path: new URL(request.url).pathname, status: response.status });
    }
    return response;
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
      outsideChats.stop();
      stopReplyNotifications();
      notifications.stop();
      await server.stop(true);
      await admin.stop();
      await gateway.stop();
    },
  };
}
