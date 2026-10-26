import { describe, expect, test } from "bun:test";
import { ConversationMessageSchema } from "@vellumai/assistant-api";
import type { HistoryMessage } from "../../src/hermes/schemas";
import { historyToMessages, userTurnCount } from "../../src/translate/history";

const CONVERSATION = "conv";
const STARTED_AT = Date.UTC(2026, 9, 23, 12, 0, 0);

const toolTurn: readonly HistoryMessage[] = [
  { role: "user", text: "run echo" },
  { role: "tool", name: "terminal", context: "Running echo hi" },
  { role: "assistant", text: "It printed hi.", reasoning: "Run the command." },
  { role: "user", text: "thanks" },
  { role: "assistant", text: "Anytime." },
];

describe("historyToMessages", () => {
  test("groups each user turn's tools and replies into one assistant message", () => {
    const messages = historyToMessages(CONVERSATION, STARTED_AT, toolTurn);
    expect(messages.map((message) => [message.id, message.role])).toEqual([
      ["conv:u0", "user"],
      ["conv:a0", "assistant"],
      ["conv:u1", "user"],
      ["conv:a1", "assistant"],
    ]);
    expect(messages[1]?.contentBlocks).toEqual([
      {
        type: "tool_use",
        toolCall: {
          id: "conv:a0:tool:0",
          name: "bash",
          input: { command: "echo hi" },
          result: "",
          startedAt: STARTED_AT + 1,
          completedAt: STARTED_AT + 1,
        },
      },
      { type: "thinking", thinking: "Run the command." },
      { type: "text", text: "It printed hi." },
    ]);
    expect(messages[2]).toMatchObject({ contentBlocks: [{ type: "text", text: "thanks" }], textSegments: ["thanks"] });
  });

  test("produces messages that satisfy Vellum's message schema in chronological order", () => {
    const messages = historyToMessages(CONVERSATION, STARTED_AT, toolTurn);
    for (const message of messages) {
      expect(ConversationMessageSchema.safeParse(message).success).toBe(true);
    }
    const times = messages.map((message) => Date.parse(message.timestamp));
    expect(times).toEqual(times.toSorted((left, right) => left - right));
  });

  test("each message takes the time Hermes recorded for its row", () => {
    const at = (seconds: number) => (STARTED_AT + seconds * 1000) / 1000;
    const timed: readonly HistoryMessage[] = [
      { role: "user", text: "run echo", timestamp: at(60), row_id: 1 },
      { role: "tool", name: "terminal", context: "Running echo hi", timestamp: at(70) },
      { role: "assistant", text: "It printed hi.", timestamp: at(90), row_id: 3 },
      { role: "user", text: "thanks", timestamp: at(3600), row_id: 4 },
      { role: "assistant", text: "Anytime.", timestamp: at(3605), row_id: 5 },
    ];
    const messages = historyToMessages(CONVERSATION, STARTED_AT, timed);
    expect(messages.map((message) => Date.parse(message.timestamp))).toEqual([STARTED_AT + 60_000, STARTED_AT + 90_000, STARTED_AT + 3_600_000, STARTED_AT + 3_605_000]);
    expect(messages[1]?.contentBlocks?.[0]).toMatchObject({ toolCall: { startedAt: STARTED_AT + 70_000 } });
  });

  test("a row compaction copied keeps the time of the message it copies", () => {
    const copied: readonly HistoryMessage[] = [{ role: "user", text: "Sounds good", timestamp: (STARTED_AT + 7_200_000) / 1000, row_id: 42 }];
    const messages = historyToMessages(CONVERSATION, STARTED_AT, copied, new Map([[42, STARTED_AT + 60_000]]));
    expect(Date.parse(messages[0]?.timestamp ?? "")).toBe(STARTED_AT + 60_000);
  });

  test("rows without a recorded time keep placeholder times", () => {
    const messages = historyToMessages(CONVERSATION, STARTED_AT, toolTurn);
    expect(messages.map((message) => Date.parse(message.timestamp))).toEqual([STARTED_AT, STARTED_AT + 1, STARTED_AT + 2, STARTED_AT + 3]);
  });

  const edgeCases: ReadonlyArray<readonly [string, readonly HistoryMessage[], string[]]> = [
    ["empty history", [], []],
    ["system prompts are hidden", [{ role: "system", text: "be nice" }, { role: "user", text: "hi" }], ["conv:u0"]],
    ["a reply before any user message", [{ role: "assistant", text: "Welcome!" }], ["conv:a0"]],
    ["an assistant turn with no visible content is dropped", [{ role: "user", text: "hi" }, { role: "assistant", text: "  " }], ["conv:u0"]],
  ];
  for (const [name, history, ids] of edgeCases) {
    test(name, () => {
      expect(historyToMessages(CONVERSATION, STARTED_AT, history).map((message) => message.id)).toEqual(ids);
    });
  }
});

describe("userTurnCount", () => {
  test("counts user messages so live ids continue where history ends", () => {
    expect(userTurnCount(toolTurn)).toBe(2);
  });
});
