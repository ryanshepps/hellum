import type { SessionRow } from "../hermes/schemas";

const UNTITLED = "New conversation";
const TITLE_FROM_PREVIEW_LENGTH = 60;

export type ConversationSummary = {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastMessageAt: number | null;
  readonly conversationType: "standard";
  readonly source: string;
  readonly groupId: null;
  readonly isProcessing: boolean;
  readonly archivedAt?: number;
};

export type ConversationActivity = {
  readonly lastActivityAt: ReadonlyMap<string, number>;
  readonly processing: ReadonlySet<string>;
  readonly archivedAt: ReadonlyMap<string, number>;
};

export function conversationTitle(row: Pick<SessionRow, "title" | "preview">): string {
  const title = row.title.trim();
  if (title) {
    return title;
  }
  const preview = row.preview.trim().replace(/\s+/g, " ");
  return preview ? preview.slice(0, TITLE_FROM_PREVIEW_LENGTH) : UNTITLED;
}

export function toConversationSummary(row: SessionRow, activity: ConversationActivity): ConversationSummary {
  const createdAt = Math.round(row.started_at * 1000);
  const lastActivity = Math.max(createdAt, activity.lastActivityAt.get(row.id) ?? 0);
  const archivedAt = activity.archivedAt.get(row.id);
  return {
    id: row.id,
    title: conversationTitle(row),
    createdAt,
    updatedAt: lastActivity,
    lastMessageAt: row.message_count > 0 ? lastActivity : null,
    conversationType: "standard",
    source: row.source || "hermes",
    groupId: null,
    isProcessing: activity.processing.has(row.id),
    ...(archivedAt !== undefined ? { archivedAt } : {}),
  };
}
