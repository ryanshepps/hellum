import { UnknownAttachmentError } from "../attachments/attachment-stager";
import { AvatarRejectedError } from "../avatar/avatar-store";
import { ConversationNotFoundError } from "../conversations/conversation-service";
import { HermesHelperError } from "../hermes/helper-process";
import { HermesRpcError, HermesUnavailableError } from "../hermes/rpc-peer";
import { McpRejectedError } from "../mcp/mcp-service";
import { MemoryWriteRejectedError } from "../memory/memory-service";
import { ModelSettingRejectedError, ProfileNotFoundError } from "../models/model-service";
import { ScheduleNotFoundError, ScheduleRejectedError } from "../schedules/schedule-service";
import { SettingRejectedError } from "../settings/hermes-settings";
import { SkillNotFoundError, SkillRejectedError } from "../skills/skill-service";
import { SpeechUnavailableError, TranscriptionFailedError } from "../voice/voice-service";
import { errorResponse } from "../http/json";
import { log } from "../log";
import { matchRoute, type Route } from "./route-table";

const ASSISTANT_PATH = /^\/v1\/assistants\/([^/]+)\/(.*)$/;

export type AssistantApi = (request: Request) => Promise<Response | null>;

function toErrorResponse(error: unknown, method: string, path: string): Response {
  if (error instanceof ConversationNotFoundError) {
    return errorResponse(404, "not_found", error.message);
  }
  if (error instanceof ScheduleNotFoundError || error instanceof SkillNotFoundError || error instanceof ProfileNotFoundError) {
    return errorResponse(404, "not_found", error.message);
  }
  if (error instanceof ScheduleRejectedError) {
    return errorResponse(422, "schedule_rejected", error.message);
  }
  if (error instanceof ModelSettingRejectedError) {
    return errorResponse(422, "model_setting_rejected", error.message);
  }
  if (error instanceof AvatarRejectedError) {
    return errorResponse(400, "invalid_request", error.message);
  }
  if (error instanceof McpRejectedError) {
    return errorResponse(422, "mcp_rejected", error.message);
  }
  if (error instanceof SettingRejectedError) {
    return errorResponse(422, "setting_rejected", error.message);
  }
  if (error instanceof SkillRejectedError) {
    return errorResponse(422, "skill_rejected", error.message);
  }
  if (error instanceof SpeechUnavailableError) {
    log.warn("hermes speech unavailable", { error: error.message });
    return errorResponse(503, "tts_unavailable", error.message);
  }
  if (error instanceof TranscriptionFailedError) {
    log.warn("hermes transcription failed", { error: error.message });
    return errorResponse(502, "stt_failed", error.message);
  }
  if (error instanceof UnknownAttachmentError) {
    return errorResponse(400, "unknown_attachment", error.message);
  }
  if (error instanceof MemoryWriteRejectedError) {
    return errorResponse(422, "memory_rejected", error.message);
  }
  if (error instanceof HermesHelperError) {
    log.error("hermes helper failed", { method, path, error: error.message });
    return errorResponse(502, "hermes_helper_failed", error.message);
  }
  if (error instanceof HermesUnavailableError) {
    return errorResponse(503, "hermes_unavailable", error.message);
  }
  if (error instanceof HermesRpcError) {
    log.warn("hermes rejected a request", { method, path, code: error.code, message: error.message });
    return errorResponse(502, "hermes_error", error.message);
  }
  log.error("assistant api request failed", { method, path, error: error instanceof Error ? error.message : String(error) });
  return errorResponse(500, "internal_error", "Hellum could not complete the request");
}

export function createAssistantApi(assistantIds: ReadonlySet<string>, routes: readonly Route[]): AssistantApi {
  return async (request) => {
    const url = new URL(request.url);
    const match = ASSISTANT_PATH.exec(url.pathname);
    if (!match || !assistantIds.has(match[1] ?? "")) {
      return null;
    }
    const routed = matchRoute(routes, request.method, match[2] ?? "");
    if (!routed) {
      return null;
    }
    try {
      return await routed.route.handle({ request, params: routed.params, query: url.searchParams });
    } catch (error) {
      return toErrorResponse(error, request.method, url.pathname);
    }
  };
}
