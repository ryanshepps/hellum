import type { ConversationContentBlock, ConversationMessage } from "@vellumai/assistant-api";
import type { HistoryMessage } from "../hermes/schemas";
import { assistantMessageId, userMessageId } from "./message-ids";
import { toVellumToolCall } from "./tool-names";

type Draft = {
  readonly id: string;
  readonly blocks: readonly ConversationContentBlock[];
  readonly atMs: number | null;
};

type Fold = {
  readonly messages: readonly ConversationMessage[];
  readonly turn: number;
  readonly draft: Draft | null;
};

export type OriginalTimes = ReadonlyMap<number, number>;

type Clock = {
  readonly startedAtMs: number;
  readonly originalTimes: OriginalTimes;
};

type TimedEntry = { readonly timestamp?: number | null | undefined; readonly row_id?: number | null | undefined };

function placeholderMs(clock: Clock, fold: Fold): number {
  return clock.startedAtMs + fold.messages.length;
}

function recordedMs(clock: Clock, entry: TimedEntry): number | null {
  const original = entry.row_id === null || entry.row_id === undefined ? undefined : clock.originalTimes.get(entry.row_id);
  if (original !== undefined) {
    return original;
  }
  return entry.timestamp ? Math.round(entry.timestamp * 1000) : null;
}

function flush(fold: Fold, clock: Clock): readonly ConversationMessage[] {
  if (!fold.draft || fold.draft.blocks.length === 0) {
    return fold.messages;
  }
  const message: ConversationMessage = {
    id: fold.draft.id,
    role: "assistant",
    timestamp: new Date(fold.draft.atMs ?? placeholderMs(clock, fold)).toISOString(),
    attachments: [],
    contentBlocks: [...fold.draft.blocks],
  };
  return [...fold.messages, message];
}

function draftFor(fold: Fold, conversationId: string): Draft {
  return fold.draft ?? { id: assistantMessageId(conversationId, Math.max(fold.turn, 0)), blocks: [], atMs: null };
}

function appendBlocks(fold: Fold, conversationId: string, blocks: readonly ConversationContentBlock[], atMs: number | null): Fold {
  const draft = draftFor(fold, conversationId);
  return { ...fold, draft: { ...draft, blocks: [...draft.blocks, ...blocks], atMs: atMs ?? draft.atMs } };
}

export function userTurnCount(history: readonly HistoryMessage[]): number {
  return history.filter((message) => message.role === "user").length;
}

export function historyToMessages(
  conversationId: string,
  startedAtMs: number,
  history: readonly HistoryMessage[],
  originalTimes: OriginalTimes = new Map(),
): readonly ConversationMessage[] {
  const clock: Clock = { startedAtMs, originalTimes };
  const initial: Fold = { messages: [], turn: -1, draft: null };
  const folded = history.reduce<Fold>((fold, entry) => {
    switch (entry.role) {
      case "system":
        return fold;
      case "user": {
        const messages = flush(fold, clock);
        const turn = fold.turn + 1;
        const message: ConversationMessage = {
          id: userMessageId(conversationId, turn),
          role: "user",
          timestamp: new Date(recordedMs(clock, entry) ?? placeholderMs(clock, { ...fold, messages })).toISOString(),
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
        const at = recordedMs(clock, entry) ?? placeholderMs(clock, fold);
        return appendBlocks(
          fold,
          conversationId,
          [
            {
              type: "tool_use",
              toolCall: { id: `${draft.id}:tool:${toolIndex}`, name: tool.toolName, input: tool.input, result: "", startedAt: at, completedAt: at },
            },
          ],
          null,
        );
      }
      case "assistant": {
        const thinking: readonly ConversationContentBlock[] = entry.reasoning ? [{ type: "thinking", thinking: entry.reasoning }] : [];
        const text: readonly ConversationContentBlock[] = entry.text.trim() ? [{ type: "text", text: entry.text }] : [];
        return appendBlocks(fold, conversationId, [...thinking, ...text], recordedMs(clock, entry));
      }
      default: {
        const exhaustive: never = entry;
        return exhaustive;
      }
    }
  }, initial);
  return flush(folded, clock);
}
