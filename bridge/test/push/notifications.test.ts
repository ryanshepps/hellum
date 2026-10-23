import { describe, expect, test } from "bun:test";
import type { AssistantEvent } from "@vellumai/assistant-api";
import { initialNotificationState, observeEvent, type Notification } from "../../src/push/notifications";

function run(events: readonly AssistantEvent[]): readonly Notification[] {
  return events.reduce<{ state: ReturnType<typeof initialNotificationState>; out: Notification[] }>(
    (acc, event) => {
      const observed = observeEvent(acc.state, event);
      return { state: observed.state, out: observed.notification ? [...acc.out, observed.notification] : acc.out };
    },
    { state: initialNotificationState("Hellum"), out: [] },
  ).out;
}

const turn = (text: string): readonly AssistantEvent[] => [
  { type: "assistant_turn_start", messageId: "c:a0", conversationId: "c" },
  { type: "assistant_text_delta", text: text.slice(0, 3), messageId: "c:a0", conversationId: "c" },
  { type: "assistant_text_delta", text: text.slice(3), messageId: "c:a0", conversationId: "c" },
  { type: "message_complete", messageId: "c:a0", conversationId: "c" },
];

describe("observeEvent", () => {
  test("a finished reply notifies with the reply text under the assistant name", () => {
    expect(run(turn("All done here."))).toEqual([{ conversationId: "c", title: "Hellum", body: "All done here.", collapseId: "c:a0" }]);
  });

  test("a known conversation title replaces the assistant name", () => {
    const titled: readonly AssistantEvent[] = [{ type: "conversation_title_updated", conversationId: "c", title: "Trip plans" }, ...turn("Booked.")];
    expect(run(titled)[0]?.title).toBe("Trip plans");
  });

  test("long replies are shortened and whitespace collapsed", () => {
    const body = run(turn(`line one\n\n${"x".repeat(300)}`))[0]?.body ?? "";
    expect(body.length).toBe(180);
    expect(body.startsWith("line one x")).toBe(true);
    expect(body.endsWith("…")).toBe(true);
  });

  test("each turn reports only its own text", () => {
    const notifications = run([...turn("first"), ...turn("second")]);
    expect(notifications.map((notification) => notification.body)).toEqual(["first", "second"]);
  });

  test("an approval asks for a decision about the command", () => {
    const notifications = run([
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
    expect(notifications).toEqual([{ conversationId: "c", title: "Approval needed · Hellum", body: "rm -rf build", collapseId: "c:a0:approval:1" }]);
  });

  test("errors notify, cancellations do not", () => {
    const notifications = run([
      { type: "conversation_error", conversationId: "c", code: "UNKNOWN", userMessage: "provider down", retryable: true },
      { type: "generation_cancelled", conversationId: "c" },
    ]);
    expect(notifications.map((notification) => notification.body)).toEqual(["Something went wrong: provider down"]);
  });
});
