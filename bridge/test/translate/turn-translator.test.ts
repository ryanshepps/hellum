import { describe, expect, test } from "bun:test";
import { AssistantEventSchema, type AssistantEvent } from "@vellumai/assistant-api";
import type { HermesTurnEvent } from "../../src/hermes/schemas";
import { resolveApproval, startTurn, translateTurnEvent, type TurnState } from "../../src/translate/turn-translator";
import { readTurnEvents, type TraceName } from "../support/traces";

const CONVERSATION = "20261023_125858_1302eb";
const NOW = 1_792_000_000_000;

function replay(events: readonly HermesTurnEvent[], turn = 0): { state: TurnState; events: readonly AssistantEvent[] } {
  return events.reduce(
    (acc, event) => {
      const translated = translateTurnEvent(acc.state, event, NOW);
      return { state: translated.state, events: [...acc.events, ...translated.events] };
    },
    { state: startTurn(CONVERSATION, turn, null), events: [] as readonly AssistantEvent[] },
  );
}

function collapse(types: readonly string[]): readonly string[] {
  return types.filter((type, index) => type !== types[index - 1]);
}

function textOf(events: readonly AssistantEvent[]): string {
  return events.flatMap((event) => (event.type === "assistant_text_delta" ? [event.text] : [])).join("");
}

const expectations: ReadonlyArray<readonly [TraceName, readonly string[]]> = [
  [
    "hello",
    ["assistant_turn_start", "assistant_activity_state", "assistant_text_delta", "assistant_activity_state", "assistant_text_delta", "message_complete", "assistant_activity_state"],
  ],
  [
    "tool",
    [
      "assistant_turn_start",
      "assistant_activity_state",
      "assistant_thinking_delta",
      "tool_use_start",
      "assistant_activity_state",
      "tool_result",
      "assistant_activity_state",
      "assistant_text_delta",
      "assistant_activity_state",
      "assistant_text_delta",
      "message_complete",
      "assistant_activity_state",
    ],
  ],
  [
    "approval",
    [
      "assistant_turn_start",
      "assistant_activity_state",
      "tool_use_start",
      "assistant_activity_state",
      "confirmation_request",
      "assistant_activity_state",
      "tool_result",
      "assistant_activity_state",
      "assistant_text_delta",
      "assistant_activity_state",
      "assistant_text_delta",
      "message_complete",
      "assistant_activity_state",
    ],
  ],
];

describe("translateTurnEvent over recorded Hermes turns", () => {
  for (const [trace, expectedTypes] of expectations) {
    test(`${trace}: emits the expected Vellum event sequence`, () => {
      const { events } = replay(readTurnEvents(trace));
      expect(collapse(events.map((event) => event.type))).toEqual(collapse(expectedTypes));
    });

    test(`${trace}: every event satisfies Vellum's event schema`, () => {
      for (const event of replay(readTurnEvents(trace)).events) {
        expect(AssistantEventSchema.safeParse(event).success).toBe(true);
      }
    });

    test(`${trace}: streamed text matches the completed message`, () => {
      const hermes = readTurnEvents(trace);
      const completed = hermes.find((event) => event.type === "message.complete");
      if (completed?.type !== "message.complete") throw new Error("trace has no completion");
      expect(textOf(replay(hermes).events).trim()).toBe(completed.text.trim());
    });
  }

  test("all events of a turn carry the turn's assistant message id", () => {
    const { events } = replay(readTurnEvents("tool"), 3);
    const ids = new Set(events.flatMap((event) => ("messageId" in event && event.messageId ? [event.messageId] : [])));
    expect([...ids]).toEqual([`${CONVERSATION}:a3`]);
  });

  test("tool results pair with their tool start", () => {
    const { events } = replay(readTurnEvents("tool"));
    const start = events.find((event) => event.type === "tool_use_start");
    const result = events.find((event) => event.type === "tool_result");
    if (start?.type !== "tool_use_start" || result?.type !== "tool_result") throw new Error("missing tool events");
    expect(result.toolUseId).toBe(start.toolUseId ?? "");
    expect(result.result).toBe("hellum-trace-ok");
    expect(result.isError).toBe(false);
  });

  test("an approval becomes a confirmation for the running tool's command", () => {
    const { events } = replay(readTurnEvents("approval"));
    const confirmation = events.find((event) => event.type === "confirmation_request");
    if (confirmation?.type !== "confirmation_request") throw new Error("missing confirmation");
    expect(confirmation.requestId).toBe(`${CONVERSATION}:a0:approval:1`);
    expect(confirmation.toolName).toBe("bash");
    expect(confirmation.input).toEqual({ command: "rm -rf ./hellum-nonexistent-dir" });
    expect(confirmation.riskReason).toBe("recursive delete");
  });

  test("a denied command reports a blocked, failed tool result", () => {
    const result = replay(readTurnEvents("approval")).events.find((event) => event.type === "tool_result");
    if (result?.type !== "tool_result") throw new Error("missing tool result");
    expect(result.isError).toBe(true);
    expect(result.status).toBe("blocked");
  });
});

describe("resolveApproval", () => {
  test("resolves the pending confirmation once", () => {
    const events = readTurnEvents("approval");
    const untilApproval = events.slice(0, events.findIndex((event) => event.type === "approval.request") + 1);
    const { state } = replay(untilApproval);
    const resolved = resolveApproval(state, "rejected");
    expect(resolved.events[0]).toEqual({
      type: "interaction_resolved",
      requestId: `${CONVERSATION}:a0:approval:1`,
      conversationId: CONVERSATION,
      state: "rejected",
      kind: "confirmation",
    });
    expect(resolveApproval(resolved.state, "approved").events).toEqual([]);
  });
});

describe("terminal events", () => {
  const cases: ReadonlyArray<readonly [HermesTurnEvent, AssistantEvent["type"]]> = [
    [{ type: "message.complete", text: "", status: "interrupted" }, "generation_cancelled"],
    [{ type: "message.complete", text: "done", status: "complete" }, "message_complete"],
    [{ type: "error", message: "provider down" }, "conversation_error"],
  ];
  for (const [event, expected] of cases) {
    test(`${event.type} (${"status" in event ? event.status : "error"}) ends the turn as ${expected} and goes idle`, () => {
      const started = translateTurnEvent(startTurn(CONVERSATION, 0, null), { type: "message.start" }, NOW).state;
      const { events, state } = translateTurnEvent(started, event, NOW);
      expect(events.map((item) => item.type)).toEqual([expected, "assistant_activity_state"]);
      expect(state.phase).toBe("idle");
    });
  }
});
