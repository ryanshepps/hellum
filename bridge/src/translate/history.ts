import type { ConversationContentBlock, ConversationMessage } from "@vellumai/assistant-api";
import type { HistoryMessage } from "../hermes/schemas";
import { assistantMessageId, userMessageId } from "./message-ids";
import { toVellumToolCall } from "./tool-names";

type Draft = {
  readonly id: string;
  readonly blocks: readonly ConversationContentBlock[];
};

type Fold = {
  readonly messages: readonly ConversationMessage[];
  readonly turn: number;
  readonly draft: Draft | null;
};

function timestampAt(startedAtMs: number, index: number): string {
  return new Date(startedAtMs + index).toISOString();
}

function flush(fold: Fold, startedAtMs: number): readonly ConversationMessage[] {
  if (!fold.draft || fold.draft.blocks.length === 0) {
    return fold.messages;
  }
  const message: ConversationMessage = {
    id: fold.draft.id,
    role: "assistant",
    timestamp: timestampAt(startedAtMs, fold.messages.length),
    attachments: [],
    contentBlocks: [...fold.draft.blocks],
  };
  return [...fold.messages, message];
}

function draftFor(fold: Fold, conversationId: string): Draft {
  return fold.draft ?? { id: assistantMessageId(conversationId, Math.max(fold.turn, 0)), blocks: [] };
}

function appendBlocks(fold: Fold, conversationId: string, blocks: readonly ConversationContentBlock[]): Fold {
  const draft = draftFor(fold, conversationId);
  return { ...fold, draft: { ...draft, blocks: [...draft.blocks, ...blocks] } };
}

export function userTurnCount(history: readonly HistoryMessage[]): number {
  return history.filter((message) => message.role === "user").length;
}

export function historyToMessages(
  conversationId: string,
  startedAtMs: number,
  history: readonly HistoryMessage[],
): readonly ConversationMessage[] {
  const initial: Fold = { messages: [], turn: -1, draft: null };
  const folded = history.reduce<Fold>((fold, entry) => {
    switch (entry.role) {
      case "system":
        return fold;
      case "user": {
        const messages = flush(fold, startedAtMs);
        const turn = fold.turn + 1;
        const message: ConversationMessage = {
          id: userMessageId(conversationId, turn),
          role: "user",
          timestamp: timestampAt(startedAtMs, messages.length),
          attachments: [],
          contentBlocks: [{ type: "text", text: entry.text }],
          textSegments: [entry.text],
        };
        return { messages: [...messages, message], turn, draft: null };
      }
      case "tool": {
        const draft = draftFor(fold, conversationId);
        const toolIndex = draft.blocks.filter((block) => block.type === "tool_use").length;
        const tool = toVellumToolCall(entry.name, entry.context ?? null);
        const at = startedAtMs + fold.messages.length;
        return appendBlocks(fold, conversationId, [
          {
            type: "tool_use",
            toolCall: { id: `${draft.id}:tool:${toolIndex}`, name: tool.toolName, input: tool.input, result: "", startedAt: at, completedAt: at },
          },
        ]);
      }
      case "assistant": {
        const thinking: readonly ConversationContentBlock[] = entry.reasoning ? [{ type: "thinking", thinking: entry.reasoning }] : [];
        const text: readonly ConversationContentBlock[] = entry.text.trim() ? [{ type: "text", text: entry.text }] : [];
        return appendBlocks(fold, conversationId, [...thinking, ...text]);
      }
      default: {
        const exhaustive: never = entry;
        return exhaustive;
      }
    }
  }, initial);
  return flush(folded, startedAtMs);
}
