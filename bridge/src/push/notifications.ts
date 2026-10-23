import type { AssistantEvent } from "@vellumai/assistant-api";

const MAX_BODY_LENGTH = 180;

export type Notification = {
  readonly conversationId: string;
  readonly title: string;
  readonly body: string;
  readonly collapseId: string;
};

export type NotificationState = {
  readonly fallbackTitle: string;
  readonly titles: ReadonlyMap<string, string>;
  readonly replies: ReadonlyMap<string, string>;
};

export type Observed = {
  readonly state: NotificationState;
  readonly notification: Notification | null;
};

export function initialNotificationState(fallbackTitle: string): NotificationState {
  return { fallbackTitle, titles: new Map(), replies: new Map() };
}

function summarize(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_BODY_LENGTH ? `${collapsed.slice(0, MAX_BODY_LENGTH - 1)}…` : collapsed;
}

function withoutReply(state: NotificationState, conversationId: string): NotificationState {
  return { ...state, replies: new Map([...state.replies].filter(([key]) => key !== conversationId)) };
}

function titleFor(state: NotificationState, conversationId: string): string {
  return state.titles.get(conversationId) ?? state.fallbackTitle;
}

export function observeEvent(state: NotificationState, event: AssistantEvent): Observed {
  switch (event.type) {
    case "conversation_title_updated":
      return { state: { ...state, titles: new Map([...state.titles, [event.conversationId, event.title]]) }, notification: null };
    case "assistant_turn_start":
      return { state: event.conversationId ? withoutReply(state, event.conversationId) : state, notification: null };
    case "assistant_text_delta": {
      if (!event.conversationId) {
        return { state, notification: null };
      }
      const reply = (state.replies.get(event.conversationId) ?? "") + event.text;
      return { state: { ...state, replies: new Map([...state.replies, [event.conversationId, reply]]) }, notification: null };
    }
    case "message_complete": {
      if (!event.conversationId) {
        return { state, notification: null };
      }
      const body = summarize(state.replies.get(event.conversationId) ?? "");
      return {
        state: withoutReply(state, event.conversationId),
        notification: {
          conversationId: event.conversationId,
          title: titleFor(state, event.conversationId),
          body: body || "Replied",
          collapseId: event.messageId ?? event.conversationId,
        },
      };
    }
    case "confirmation_request": {
      if (!event.conversationId) {
        return { state, notification: null };
      }
      const command = typeof event.input.command === "string" ? event.input.command : event.toolName;
      return {
        state,
        notification: {
          conversationId: event.conversationId,
          title: `Approval needed · ${titleFor(state, event.conversationId)}`,
          body: summarize(command),
          collapseId: event.requestId,
        },
      };
    }
    case "conversation_error":
      return {
        state: withoutReply(state, event.conversationId),
        notification: {
          conversationId: event.conversationId,
          title: titleFor(state, event.conversationId),
          body: summarize(`Something went wrong: ${event.userMessage}`),
          collapseId: `${event.conversationId}:error`,
        },
      };
    case "generation_cancelled":
      return { state: event.conversationId ? withoutReply(state, event.conversationId) : state, notification: null };
    default:
      return { state, notification: null };
  }
}
