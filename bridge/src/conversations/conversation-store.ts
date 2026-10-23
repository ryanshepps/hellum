import { join } from "node:path";
import { z } from "zod";
import { privateJsonFile } from "../storage/json-file";

const ConversationStateSchema = z.object({
  archivedAt: z.record(z.string(), z.number()),
  lastActivityAt: z.record(z.string(), z.number()),
});

export type ConversationState = {
  readonly archivedAt: Readonly<Record<string, number>>;
  readonly lastActivityAt: Readonly<Record<string, number>>;
};

export const EMPTY_CONVERSATION_STATE: ConversationState = { archivedAt: {}, lastActivityAt: {} };

export type ConversationStore = {
  readonly load: () => Promise<ConversationState>;
  readonly save: (state: ConversationState) => Promise<void>;
};

export function createFileConversationStore(stateDir: string): ConversationStore {
  const file = privateJsonFile(join(stateDir, "conversations.json"), ConversationStateSchema, EMPTY_CONVERSATION_STATE);
  return { load: file.read, save: file.write };
}

export function withArchived(state: ConversationState, conversationId: string, archivedAt: number | null): ConversationState {
  const { [conversationId]: _previous, ...others } = state.archivedAt;
  return { ...state, archivedAt: archivedAt === null ? others : { ...others, [conversationId]: archivedAt } };
}

export function withActivity(state: ConversationState, conversationId: string, at: number): ConversationState {
  return { ...state, lastActivityAt: { ...state.lastActivityAt, [conversationId]: at } };
}

export function withoutConversation(state: ConversationState, conversationId: string): ConversationState {
  const { [conversationId]: _archived, ...archivedAt } = state.archivedAt;
  const { [conversationId]: _activity, ...lastActivityAt } = state.lastActivityAt;
  return { archivedAt, lastActivityAt };
}
