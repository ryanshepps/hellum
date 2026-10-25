import { describe, expect, test } from "bun:test";
import type { AssistantEvent } from "@vellumai/assistant-api";
import { INITIAL_REPLY_STATE, observeEvent } from "../../src/notifications/reply-producer";
import type { NotificationSignal } from "../../src/notifications/signal";

function run(events: readonly AssistantEvent[]): readonly NotificationSignal[] {
  return events.reduce<{ state: typeof INITIAL_REPLY_STATE; out: NotificationSignal[] }>(
    (acc, event) => {
      const observed = observeEvent(acc.state, event);
      return { state: observed.state, out: observed.signal ? [...acc.out, observed.signal] : acc.out };
    },
    { state: INITIAL_REPLY_STATE, out: [] },
  ).out;
}

const turn = (text: string): readonly AssistantEvent[] => [
  { type: "assistant_turn_start", messageId: "c:a0", conversationId: "c" },
  { type: "assistant_text_delta", text: text.slice(0, 3), messageId: "c:a0", conversationId: "c" },
  { type: "assistant_text_delta", text: text.slice(3), messageId: "c:a0", conversationId: "c" },
  { type: "message_complete", messageId: "c:a0", conversationId: "c" },
];

describe("observeEvent", () => {
  test("a finished reply emits a chat.assistant_reply signal with the reply as its message", () => {
    expect(run(turn("All done here."))).toEqual([
      {
        sourceEventName: "chat.assistant_reply",
        sourceChannel: "vellum",
        sourceContextId: "c",
        urgency: "medium",
        requestedTitle: undefined,
        requestedMessage: "All done here.",
        dedupeKey: "chat.assistant_reply:c:c:a0",
      },
    ]);
  });

  test("a known conversation title is requested as the notification title", () => {
    const titled: readonly AssistantEvent[] = [{ type: "conversation_title_updated", conversationId: "c", title: "Trip\nplans" }, ...turn("Booked.")];
    expect(run(titled)[0]?.requestedTitle).toBe("Trip plans");
  });

  test("markdown is flattened and long replies are clamped to the preview budget", () => {
    const message = run(turn(`**Done**\n\n${"x".repeat(300)}`))[0]?.requestedMessage ?? "";
    expect(message.startsWith("Done\n\nxxx")).toBe(true);
    expect(message.length).toBe(200);
    expect(message.endsWith("…")).toBe(true);
  });

  test("a reply that is only an image names the image", () => {
    expect(run(turn("![the Q3 chart](https://example.com/q3.png)"))[0]?.requestedMessage).toBe("Sent the Q3 chart");
  });

  test("a reply with no text stays silent", () => {
    expect(run(turn("   "))).toEqual([]);
  });

  test("each turn reports only its own text", () => {
    const signals = run([...turn("first"), ...turn("second")]);
    expect(signals.map((signal) => signal.requestedMessage)).toEqual(["first", "second"]);
  });

  test("an approval asks for a decision about the command", () => {
    const signals = run([
      {
        type: "confirmation_request",
        requestId: "c:a0:approval:1",
        toolName: "bash",
        input: { command: "rm -rf build" },
        riskLevel: "high",
        allowlistOptions: [],
        scopeOptions: [],
        conversationId: "c",
      },
    ]);
    expect(signals).toEqual([
      {
        sourceEventName: "tool.confirmation_required",
        sourceChannel: "vellum",
        sourceContextId: "c",
        urgency: "high",
        requestedTitle: "Approval needed",
        requestedMessage: "rm -rf build",
        dedupeKey: "tool.confirmation_required:c:a0:approval:1",
      },
    ]);
  });

  test("errors notify, cancellations do not", () => {
    const signals = run([
      { type: "conversation_error", conversationId: "c", code: "UNKNOWN", userMessage: "provider down", retryable: true },
      { type: "generation_cancelled", conversationId: "c" },
    ]);
    expect(signals.map((signal) => signal.requestedMessage)).toEqual(["Something went wrong: provider down"]);
  });
});
