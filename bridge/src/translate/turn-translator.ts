import type { AssistantEvent } from "@vellumai/assistant-api";
import type { HermesPrompt, HermesTurnEvent, PromptControl } from "../hermes/schemas";
import { approvalRequestId, assistantMessageId } from "./message-ids";
import { promptSurface } from "./prompt-surfaces";
import { formatToolResult } from "./tool-result";
import { toVellumToolCall } from "./tool-names";

type ActivityEvent = Extract<AssistantEvent, { type: "assistant_activity_state" }>;
type ActivityPhase = ActivityEvent["phase"];
type ActivityReason = ActivityEvent["reason"];

type ConfirmationEvent = Extract<AssistantEvent, { type: "confirmation_request" }>;

export type PendingApproval = {
  readonly requestId: string;
  readonly control: PromptControl;
  readonly confirmation: ConfirmationEvent;
};

export type PendingPrompt = {
  readonly surfaceId: string;
  readonly prompt: HermesPrompt;
};

export type TurnState = {
  readonly conversationId: string;
  readonly turn: number;
  readonly activityVersion: number;
  readonly phase: ActivityPhase;
  readonly approvals: number;
  readonly lastTool: { readonly id: string; readonly name: string } | null;
  readonly pendingApproval: PendingApproval | null;
  readonly pendingPrompt: PendingPrompt | null;
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
    pendingPrompt: null,
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
    case "tool.start": {
      const tool = toVellumToolCall(event.name, event.context);
      return emit(
        { ...state, lastTool: { id: event.toolId, name: tool.toolName } },
        [
          {
            type: "tool_use_start",
            toolName: tool.toolName,
            input: tool.input,
            toolUseId: event.toolId,
            messageId,
            conversationId,
            startedAt: nowMs,
          },
        ],
        "tool_running",
        "tool_use_start",
      );
    }
    case "tool.complete": {
      const formatted = formatToolResult(event.result);
      return emit(
        { ...state, pendingApproval: null },
        [
          {
            type: "tool_result",
            toolName: toVellumToolCall(event.name, null, event.args).toolName,
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
      const requestId = approvalRequestId(conversationId, state.turn, approval);
      const confirmation: ConfirmationEvent = {
        type: "confirmation_request",
        requestId,
        toolName: state.lastTool?.name ?? "bash",
        input: { command: event.command },
        riskLevel: "high",
        ...(event.description ? { riskReason: event.description } : {}),
        allowlistOptions: [],
        scopeOptions: [],
        conversationId,
        persistentDecisionsAllowed: false,
        ...(state.lastTool ? { toolUseId: state.lastTool.id } : {}),
      };
      return emit(
        { ...state, approvals: approval, pendingApproval: { requestId, control: event.control, confirmation } },
        [confirmation],
        "awaiting_confirmation",
        "confirmation_requested",
      );
    }
    case "prompt.request": {
      const surface = promptSurface(conversationId, messageId, event.prompt);
      return emit(
        { ...state, pendingPrompt: { surfaceId: surface.surfaceId, prompt: event.prompt } },
        [surface],
        "awaiting_confirmation",
        "confirmation_requested",
      );
    }
    case "message.complete":
      return event.status === "interrupted"
        ? emit(settled(state), [...dismissedPrompt(state), { type: "generation_cancelled", conversationId }], "idle", "generation_cancelled")
        : emit(settled(state), [...dismissedPrompt(state), { type: "message_complete", messageId, conversationId }], "idle", "message_complete");
    case "error":
      return emit(
        settled(state),
        [
          ...dismissedPrompt(state),
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

function settled(state: TurnState): TurnState {
  return { ...state, pendingApproval: null, pendingPrompt: null };
}

function dismissedPrompt(state: TurnState): readonly AssistantEvent[] {
  return state.pendingPrompt ? [{ type: "ui_surface_dismiss", conversationId: state.conversationId, surfaceId: state.pendingPrompt.surfaceId }] : [];
}

export function resolvePrompt(state: TurnState, summary: string): TranslatedTurn {
  const pending = state.pendingPrompt;
  if (!pending) {
    return { state, events: [] };
  }
  return emit(
    { ...state, pendingPrompt: null },
    [{ type: "ui_surface_complete", conversationId: state.conversationId, surfaceId: pending.surfaceId, summary }],
    "thinking",
    "confirmation_resolved",
  );
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
