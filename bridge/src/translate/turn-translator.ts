import type { AssistantEvent } from "@vellumai/assistant-api";
import type { HermesTurnEvent } from "../hermes/schemas";
import { approvalRequestId, assistantMessageId } from "./message-ids";
import { formatToolResult } from "./tool-result";

type ActivityEvent = Extract<AssistantEvent, { type: "assistant_activity_state" }>;
type ActivityPhase = ActivityEvent["phase"];
type ActivityReason = ActivityEvent["reason"];

export type PendingApproval = {
  readonly requestId: string;
  readonly toolUseId: string | null;
};

export type TurnState = {
  readonly conversationId: string;
  readonly turn: number;
  readonly activityVersion: number;
  readonly phase: ActivityPhase;
  readonly approvals: number;
  readonly lastTool: { readonly id: string; readonly name: string } | null;
  readonly pendingApproval: PendingApproval | null;
};

export type TranslatedTurn = {
  readonly state: TurnState;
  readonly events: readonly AssistantEvent[];
};

export function startTurn(conversationId: string, turn: number, previous: TurnState | null): TurnState {
  return {
    conversationId,
    turn,
    activityVersion: previous?.activityVersion ?? 0,
    phase: previous?.phase ?? "idle",
    approvals: 0,
    lastTool: null,
    pendingApproval: null,
  };
}

function withActivity(state: TurnState, phase: ActivityPhase, reason: ActivityReason): TranslatedTurn {
  if (state.phase === phase) {
    return { state, events: [] };
  }
  const next = { ...state, phase, activityVersion: state.activityVersion + 1 };
  const event: ActivityEvent = {
    type: "assistant_activity_state",
    conversationId: state.conversationId,
    activityVersion: next.activityVersion,
    phase,
    anchor: phase === "idle" ? "global" : "assistant_turn",
    reason,
  };
  return { state: next, events: [event] };
}

function emit(state: TurnState, events: readonly AssistantEvent[], phase?: ActivityPhase, reason?: ActivityReason): TranslatedTurn {
  if (!phase || !reason) {
    return { state, events };
  }
  const activity = withActivity(state, phase, reason);
  return { state: activity.state, events: [...events, ...activity.events] };
}

export function translateTurnEvent(state: TurnState, event: HermesTurnEvent, nowMs: number): TranslatedTurn {
  const { conversationId } = state;
  const messageId = assistantMessageId(conversationId, state.turn);
  switch (event.type) {
    case "message.start":
      return emit(state, [{ type: "assistant_turn_start", messageId, conversationId }], "thinking", "message_dequeued");
    case "reasoning.delta":
      return emit(
        state,
        [{ type: "assistant_thinking_delta", thinking: event.text, messageId, conversationId, timestampMs: nowMs }],
        "thinking",
        "thinking_delta",
      );
    case "message.delta":
      return emit(state, [{ type: "assistant_text_delta", text: event.text, messageId, conversationId }], "streaming", "first_text_delta");
    case "tool.start":
      return emit(
        { ...state, lastTool: { id: event.toolId, name: event.name } },
        [
          {
            type: "tool_use_start",
            toolName: event.name,
            input: event.context ? { description: event.context } : {},
            toolUseId: event.toolId,
            messageId,
            conversationId,
            startedAt: nowMs,
          },
        ],
        "tool_running",
        "tool_use_start",
      );
    case "tool.complete": {
      const formatted = formatToolResult(event.result);
      return emit(
        { ...state, pendingApproval: null },
        [
          {
            type: "tool_result",
            toolName: event.name,
            result: formatted.text,
            isError: formatted.isError,
            ...(formatted.status ? { status: formatted.status } : {}),
            toolUseId: event.toolId,
            messageId,
            conversationId,
          },
        ],
        "thinking",
        "tool_result_received",
      );
    }
    case "approval.request": {
      const approval = state.approvals + 1;
      const pendingApproval: PendingApproval = {
        requestId: approvalRequestId(conversationId, state.turn, approval),
        toolUseId: state.lastTool?.id ?? null,
      };
      return emit(
        { ...state, approvals: approval, pendingApproval },
        [
          {
            type: "confirmation_request",
            requestId: pendingApproval.requestId,
            toolName: state.lastTool?.name ?? "terminal",
            input: { command: event.command },
            riskLevel: "high",
            ...(event.description ? { riskReason: event.description } : {}),
            allowlistOptions: [],
            scopeOptions: [],
            conversationId,
            persistentDecisionsAllowed: false,
            ...(pendingApproval.toolUseId ? { toolUseId: pendingApproval.toolUseId } : {}),
          },
        ],
        "awaiting_confirmation",
        "confirmation_requested",
      );
    }
    case "message.complete":
      return event.status === "interrupted"
        ? emit({ ...state, pendingApproval: null }, [{ type: "generation_cancelled", conversationId }], "idle", "generation_cancelled")
        : emit({ ...state, pendingApproval: null }, [{ type: "message_complete", messageId, conversationId }], "idle", "message_complete");
    case "error":
      return emit(
        { ...state, pendingApproval: null },
        [
          {
            type: "conversation_error",
            conversationId,
            code: "CONVERSATION_PROCESSING_FAILED",
            userMessage: event.message,
            retryable: true,
          },
        ],
        "idle",
        "error_terminal",
      );
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function resolveApproval(state: TurnState, decision: "approved" | "rejected"): TranslatedTurn {
  const pending = state.pendingApproval;
  if (!pending) {
    return { state, events: [] };
  }
  return emit(
    { ...state, pendingApproval: null },
    [
      {
        type: "interaction_resolved",
        requestId: pending.requestId,
        conversationId: state.conversationId,
        state: decision,
        kind: "confirmation",
      },
    ],
    "tool_running",
    "confirmation_resolved",
  );
}
