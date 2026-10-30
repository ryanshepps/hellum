import { describe, expect, test } from "bun:test";
import { outsideChatSignal, type FinishedReply } from "../../src/notifications/outside-chat-producer";

function reply(overrides: Partial<FinishedReply>): FinishedReply {
  return {
    id: "20261025_170610_c7dfdc3d",
    source: "webhook",
    title: "Deploy finished",
    started_at: 1_792_962_370,
    message_id: "41",
    replied_at: 1_792_962_373,
    text: "**Deploy** finished. All green.",
    silent: false,
    ...overrides,
  };
}

describe("outsideChatSignal", () => {
  test("a finished webhook reply notifies like a chat reply", () => {
    expect(outsideChatSignal(reply({}))).toEqual({
      sourceEventName: "chat.assistant_reply",
      sourceChannel: "webhook",
      sourceContextId: "20261025_170610_c7dfdc3d",
      urgency: "medium",
      requestedTitle: "Deploy finished",
      requestedMessage: "Deploy finished. All green.",
      dedupeKey: "chat.assistant_reply:20261025_170610_c7dfdc3d:41",
    });
  });

  test.each([
    ["a scheduled run, which Hermes delivers itself", reply({ id: "cron_a1b2c3d4e5f6_20261026_030001", source: "cron" })],
    ["a Telegram chat", reply({ source: "telegram" })],
    ["a reply with no text", reply({ text: "   " })],
  ])("%s stays silent", (_label, finished) => {
    expect(outsideChatSignal(finished)).toBeNull();
  });
});
