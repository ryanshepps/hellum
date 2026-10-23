import type { AssistantEvent, ConversationContentBlock, ConversationMessage, ConversationMessageAttachment } from "@vellumai/assistant-api";

export type LiveTurn = {
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly clientMessageId: string | undefined;
  readonly text: string;
  readonly attachments: readonly ConversationMessageAttachment[];
  readonly startedAt: number;
  readonly blocks: readonly ConversationContentBlock[];
};

export function openLiveTurn(
  userMessageId: string,
  assistantMessageId: string,
  clientMessageId: string | undefined,
  text: string,
  attachments: readonly ConversationMessageAttachment[],
  startedAt: number,
): LiveTurn {
  return { userMessageId, assistantMessageId, clientMessageId, text, attachments, startedAt, blocks: [] };
}

function appendText(blocks: readonly ConversationContentBlock[], type: "text" | "thinking", chunk: string): readonly ConversationContentBlock[] {
  const last = blocks.at(-1);
  if (type === "text" && last?.type === "text") {
    return [...blocks.slice(0, -1), { ...last, text: last.text + chunk }];
  }
  if (type === "thinking" && last?.type === "thinking") {
    return [...blocks.slice(0, -1), { ...last, thinking: last.thinking + chunk }];
  }
  return [...blocks, type === "text" ? { type, text: chunk } : { type, thinking: chunk }];
}

export function foldLiveTurn(turn: LiveTurn, event: AssistantEvent): LiveTurn {
  switch (event.type) {
    case "assistant_text_delta":
      return { ...turn, blocks: appendText(turn.blocks, "text", event.text) };
    case "assistant_thinking_delta":
      return { ...turn, blocks: appendText(turn.blocks, "thinking", event.thinking) };
    case "tool_use_start":
      return {
        ...turn,
        blocks: [
          ...turn.blocks,
          {
            type: "tool_use",
            toolCall: {
              ...(event.toolUseId ? { id: event.toolUseId } : {}),
              name: event.toolName,
              input: event.input,
              ...(event.startedAt ? { startedAt: event.startedAt } : {}),
            },
          },
        ],
      };
    case "tool_result":
      return {
        ...turn,
        blocks: turn.blocks.map((block) =>
          block.type === "tool_use" && block.toolCall.id === event.toolUseId
            ? { ...block, toolCall: { ...block.toolCall, result: event.result, ...(event.isError ? { isError: true } : {}), completedAt: Date.now() } }
            : block,
        ),
      };
    default:
      return turn;
  }
}

export function liveTurnMessages(turn: LiveTurn): readonly ConversationMessage[] {
  const user: ConversationMessage = {
    id: turn.userMessageId,
    role: "user",
    timestamp: new Date(turn.startedAt).toISOString(),
    attachments: [...turn.attachments],
    contentBlocks: [{ type: "text", text: turn.text }],
    textSegments: [turn.text],
    ...(turn.clientMessageId ? { clientMessageId: turn.clientMessageId } : {}),
  };
  if (turn.blocks.length === 0) {
    return [user];
  }
  const assistant: ConversationMessage = {
    id: turn.assistantMessageId,
    role: "assistant",
    timestamp: new Date(turn.startedAt + 1).toISOString(),
    attachments: [],
    contentBlocks: [...turn.blocks],
  };
  return [user, assistant];
}

export function mergeLiveTurn(history: readonly ConversationMessage[], turn: LiveTurn | null): readonly ConversationMessage[] {
  if (!turn) {
    return history;
  }
  const withClientId = history.map((message) =>
    message.id === turn.userMessageId && turn.clientMessageId ? { ...message, clientMessageId: turn.clientMessageId } : message,
  );
  if (withClientId.some((message) => message.id === turn.assistantMessageId)) {
    return withClientId;
  }
  const live = liveTurnMessages(turn);
  const hasUser = withClientId.some((message) => message.id === turn.userMessageId);
  return [...withClientId, ...(hasUser ? live.slice(1) : live)];
}
