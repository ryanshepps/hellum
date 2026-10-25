import type { AssistantEvent } from "@vellumai/assistant-api";
import type { EventHub } from "../events/event-hub";
import type { NotificationRouter } from "./notification-router";
import {
  describeMedia,
  mediaEmbeds,
  sanitizeMessagePreview,
  sanitizeMultilineMessagePreview,
  sanitizeNotificationTitle,
  stripMarkdownForPreview,
} from "./notification-utils";
import type { NotificationSignal } from "./signal";

export type ReplyState = {
  readonly titles: ReadonlyMap<string, string>;
  readonly replies: ReadonlyMap<string, string>;
};

export type Observed = {
  readonly state: ReplyState;
  readonly signal: NotificationSignal | null;
};

export const INITIAL_REPLY_STATE: ReplyState = { titles: new Map(), replies: new Map() };

export function replyPreview(text: string): string {
  return (
    sanitizeMultilineMessagePreview(stripMarkdownForPreview(text)) ||
    sanitizeMessagePreview(describeMedia(mediaEmbeds(text).map((embed) => embed.alt)))
  );
}

export function notificationTitle(title: string | undefined): string | undefined {
  const flattened = title?.replace(/\s+/g, " ").trim();
  return flattened ? sanitizeNotificationTitle(flattened) : undefined;
}

function withoutReply(state: ReplyState, conversationId: string): ReplyState {
  return { ...state, replies: new Map([...state.replies].filter(([key]) => key !== conversationId)) };
}

export function observeEvent(state: ReplyState, event: AssistantEvent): Observed {
  switch (event.type) {
    case "conversation_title_updated":
      return { state: { ...state, titles: new Map([...state.titles, [event.conversationId, event.title]]) }, signal: null };
    case "assistant_turn_start":
      return { state: event.conversationId ? withoutReply(state, event.conversationId) : state, signal: null };
    case "assistant_text_delta": {
      if (!event.conversationId) {
        return { state, signal: null };
      }
      const reply = (state.replies.get(event.conversationId) ?? "") + event.text;
      return { state: { ...state, replies: new Map([...state.replies, [event.conversationId, reply]]) }, signal: null };
    }
    case "message_complete": {
      if (!event.conversationId) {
        return { state, signal: null };
      }
      const preview = replyPreview(state.replies.get(event.conversationId) ?? "");
      const next = withoutReply(state, event.conversationId);
      if (!preview) {
        return { state: next, signal: null };
      }
      return {
        state: next,
        signal: {
          sourceEventName: "chat.assistant_reply",
          sourceChannel: "vellum",
          sourceContextId: event.conversationId,
          urgency: "medium",
          requestedTitle: notificationTitle(state.titles.get(event.conversationId)),
          requestedMessage: preview,
          dedupeKey: `chat.assistant_reply:${event.conversationId}:${event.messageId ?? Date.now()}`,
        },
      };
    }
    case "confirmation_request": {
      if (!event.conversationId) {
        return { state, signal: null };
      }
      const command = typeof event.input.command === "string" ? event.input.command : event.toolName;
      return {
        state,
        signal: {
          sourceEventName: "tool.confirmation_required",
          sourceChannel: "vellum",
          sourceContextId: event.conversationId,
          urgency: "high",
          requestedTitle: "Approval needed",
          requestedMessage: sanitizeMessagePreview(command),
          dedupeKey: `tool.confirmation_required:${event.requestId}`,
        },
      };
    }
    case "conversation_error":
      return {
        state: withoutReply(state, event.conversationId),
        signal: {
          sourceEventName: "activity.failed",
          sourceChannel: "vellum",
          sourceContextId: event.conversationId,
          urgency: "high",
          requestedTitle: notificationTitle(state.titles.get(event.conversationId)),
          requestedMessage: sanitizeMessagePreview(`Something went wrong: ${event.userMessage}`),
        },
      };
    case "generation_cancelled":
      return { state: event.conversationId ? withoutReply(state, event.conversationId) : state, signal: null };
    default:
      return { state, signal: null };
  }
}

export function startReplyNotifications(hub: EventHub, router: NotificationRouter): () => void {
  let state = INITIAL_REPLY_STATE;
  return hub.subscribe((envelope) => {
    const observed = observeEvent(state, envelope.message);
    state = observed.state;
    if (observed.signal) {
      void router.emit(observed.signal);
    }
  });
}
