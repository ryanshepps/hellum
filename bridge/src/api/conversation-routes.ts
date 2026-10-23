import { z } from "zod";
import type { ArchiveFilter, ConversationService } from "../conversations/conversation-service";
import type { EventHub } from "../events/event-hub";
import { errorResponse, readJsonBody } from "../http/json";
import type { Route, RouteContext } from "./route-table";

const DEFAULT_PAGE_SIZE = 50;

const SendBodySchema = z.object({
  conversationId: z.string().min(1).nullish(),
  content: z.string(),
  clientMessageId: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
});

const ConfirmBodySchema = z.object({ requestId: z.string().min(1), decision: z.enum(["allow", "deny"]) });
const RenameBodySchema = z.object({ name: z.string().trim().min(1).max(200) });

function pageNumber(query: URLSearchParams, key: string, fallback: number): number {
  const value = Number(query.get(key));
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function archiveFilter(query: URLSearchParams): ArchiveFilter {
  const raw = query.get("archiveStatus");
  return raw === "archived" || raw === "all" ? raw : "active";
}

function idParam(context: RouteContext): string {
  return context.params.id ?? "";
}

export function conversationRoutes(conversations: ConversationService, hub: EventHub): readonly Route[] {
  return [
    {
      method: "GET",
      pattern: "conversations",
      handle: async ({ query }) => {
        const page = await conversations.list(
          pageNumber(query, "offset", 0),
          Math.max(1, pageNumber(query, "limit", DEFAULT_PAGE_SIZE)),
          archiveFilter(query),
        );
        return Response.json({ ...page, groups: [], orderedBy: "lastActivity" });
      },
    },
    {
      method: "GET",
      pattern: "conversations/:id",
      handle: async (context) => Response.json({ conversation: await conversations.get(idParam(context)) }),
    },
    {
      method: "DELETE",
      pattern: "conversations/:id",
      handle: async (context) => {
        await conversations.delete(idParam(context));
        return Response.json({ ok: true });
      },
    },
    {
      method: "PATCH",
      pattern: "conversations/:id/name",
      handle: async (context) => {
        const body = await readJsonBody(context.request, RenameBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "name is required");
        }
        await conversations.rename(idParam(context), body.name);
        return Response.json({ ok: true });
      },
    },
    {
      method: "POST",
      pattern: "conversations/:id/archive",
      handle: async (context) => {
        await conversations.setArchived(idParam(context), true);
        return Response.json({ ok: true, conversationId: idParam(context) });
      },
    },
    {
      method: "POST",
      pattern: "conversations/:id/unarchive",
      handle: async (context) => {
        await conversations.setArchived(idParam(context), false);
        return Response.json({ ok: true, conversationId: idParam(context) });
      },
    },
    {
      method: "POST",
      pattern: "conversations/:id/cancel",
      handle: async (context) =>
        Response.json(
          { ok: true, cancelled: await conversations.cancel(idParam(context)), conversationId: idParam(context) },
          { status: 202 },
        ),
    },
    {
      method: "GET",
      pattern: "messages",
      handle: async ({ query }) => {
        const conversationId = query.get("conversationId");
        if (!conversationId) {
          return errorResponse(400, "invalid_request", "conversationId is required");
        }
        const seq = hub.lastSeq;
        const snapshot = await conversations.snapshot(conversationId);
        const oldest = snapshot.messages[0];
        return Response.json({
          messages: snapshot.messages,
          hasMore: false,
          ...(oldest ? { oldestTimestamp: Date.parse(oldest.timestamp), oldestMessageId: oldest.id } : {}),
          seq,
          processing: snapshot.processing,
          modeSessions: [],
        });
      },
    },
    {
      method: "POST",
      pattern: "messages",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, SendBodySchema);
        const attachmentIds = body?.attachmentIds ?? [];
        if (!body || (!body.content.trim() && attachmentIds.length === 0)) {
          return errorResponse(400, "invalid_request", "content or attachments are required");
        }
        const sent = await conversations.send(body.conversationId ?? null, body.content, body.clientMessageId, attachmentIds);
        return Response.json({ accepted: true, conversationId: sent.conversationId, messageId: sent.messageId }, { status: 202 });
      },
    },
    {
      method: "POST",
      pattern: "confirm",
      handle: async ({ request }) => {
        const body = await readJsonBody(request, ConfirmBodySchema);
        if (!body) {
          return errorResponse(400, "invalid_request", "requestId and decision are required");
        }
        return Response.json({ accepted: await conversations.confirm(body.requestId, body.decision) });
      },
    },
    {
      method: "GET",
      pattern: "pending-interactions",
      handle: ({ query }) => Response.json(conversations.pendingInteractions(query.get("conversationId"))),
    },
    {
      method: "GET",
      pattern: "events",
      handle: ({ request, query }) => {
        const cursor = Number(query.get("lastSeenSeq"));
        return hub.stream(Number.isFinite(cursor) && query.has("lastSeenSeq") ? cursor : null, request.signal);
      },
    },
  ];
}
