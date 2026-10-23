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
      { type: "tool_use", toolCall: { id: "conv:a0:tool:0", name: "terminal", input: { description: "Running echo hi" }, result: "" } },
      { type: "thinking", thinking: "Run the command." },
      { type: "text", text: "It printed hi." },
    ]);
    expect(messages[2]?.contentBlocks).toEqual([{ type: "text", text: "thanks" }]);
  });

  test("produces messages that satisfy Vellum's message schema in chronological order", () => {
    const messages = historyToMessages(CONVERSATION, STARTED_AT, toolTurn);
    for (const message of messages) {
      expect(ConversationMessageSchema.safeParse(message).success).toBe(true);
    }
    const times = messages.map((message) => Date.parse(message.timestamp));
    expect(times).toEqual(times.toSorted((left, right) => left - right));
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
