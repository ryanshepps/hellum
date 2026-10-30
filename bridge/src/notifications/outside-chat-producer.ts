import { z } from "zod";
import { notificationTitle, replyPreview } from "./reply-producer";
import type { NotificationSignal } from "./signal";

export const OUTSIDE_CHAT_SOURCES = ["webhook"] as const;

export const FinishedReplySchema = z.object({
  id: z.string(),
  source: z.string(),
  title: z.string(),
  started_at: z.number(),
  message_id: z.string(),
  replied_at: z.number(),
  text: z.string(),
  silent: z.boolean(),
});
export type FinishedReply = z.infer<typeof FinishedReplySchema>;

function webhookReplySignal(reply: FinishedReply): NotificationSignal | null {
  const body = replyPreview(reply.text);
  if (!body) {
    return null;
  }
  return {
    sourceEventName: "chat.assistant_reply",
    sourceChannel: "webhook",
    sourceContextId: reply.id,
    urgency: "medium",
    requestedTitle: notificationTitle(reply.title),
    requestedMessage: body,
    dedupeKey: `chat.assistant_reply:${reply.id}:${reply.message_id}`,
  };
}

export function outsideChatSignal(reply: FinishedReply): NotificationSignal | null {
  return reply.source === "webhook" ? webhookReplySignal(reply) : null;
}
