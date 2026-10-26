import { describe, expect, test } from "bun:test";
import type { SessionRow } from "../../src/hermes/schemas";
import { conversationTitle, toConversationSummary, type ConversationActivity } from "../../src/translate/conversations";

const row: SessionRow = {
  id: "s1",
  title: "",
  preview: "Plan my   week",
  started_at: 1_792_000_000,
  message_count: 4,
  source: "telegram",
  runtime_revision: 0,
  runtime_generation: 0,
};

const noActivity: ConversationActivity = { lastActivityAt: new Map(), processing: new Set(), archivedAt: new Map() };

describe("conversationTitle", () => {
  const cases: ReadonlyArray<readonly [Pick<SessionRow, "title" | "preview">, string]> = [
    [{ title: "Trip ideas", preview: "x" }, "Trip ideas"],
    [{ title: " ", preview: "Plan my   week" }, "Plan my week"],
    [{ title: "", preview: "a".repeat(100) }, "a".repeat(60)],
    [{ title: "", preview: "" }, "New conversation"],
  ];
  for (const [input, expected] of cases) {
    test(JSON.stringify(input).slice(0, 60), () => {
      expect(conversationTitle(input)).toBe(expected);
    });
  }
});

describe("toConversationSummary", () => {
  test("uses the session start until Hellum has seen newer activity", () => {
    expect(toConversationSummary(row, noActivity)).toEqual({
      id: "s1",
      title: "Plan my week",
      createdAt: 1_792_000_000_000,
      updatedAt: 1_792_000_000_000,
      lastMessageAt: 1_792_000_000_000,
      conversationType: "standard",
      source: "telegram",
      groupId: null,
      isProcessing: false,
    });
  });

  test("reflects live activity, processing, and archive state", () => {
    const summary = toConversationSummary(row, {
      lastActivityAt: new Map([["s1", 1_792_000_500_000]]),
      processing: new Set(["s1"]),
      archivedAt: new Map([["s1", 1_792_000_600_000]]),
    });
    expect(summary.lastMessageAt).toBe(1_792_000_500_000);
    expect(summary.isProcessing).toBe(true);
    expect(summary.archivedAt).toBe(1_792_000_600_000);
  });

  test("an empty session has no last message time", () => {
    expect(toConversationSummary({ ...row, message_count: 0 }, noActivity).lastMessageAt).toBeNull();
  });
});
