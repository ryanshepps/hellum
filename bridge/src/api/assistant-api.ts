import { UnknownAttachmentError } from "../attachments/attachment-stager";
import { ConversationNotFoundError } from "../conversations/conversation-service";
import { HermesRpcError, HermesUnavailableError } from "../hermes/rpc-peer";
import { errorResponse } from "../http/json";
import { log } from "../log";
import { matchRoute, type Route } from "./route-table";

const ASSISTANT_PATH = /^\/v1\/assistants\/([^/]+)\/(.*)$/;

export type AssistantApi = (request: Request) => Promise<Response | null>;

function toErrorResponse(error: unknown, method: string, path: string): Response {
  if (error instanceof ConversationNotFoundError) {
    return errorResponse(404, "not_found", error.message);
  }
  if (error instanceof UnknownAttachmentError) {
    return errorResponse(400, "unknown_attachment", error.message);
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
