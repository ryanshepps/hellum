import { describe, expect, test } from "bun:test";
import type { AssistantEvent, ConversationMessage } from "@vellumai/assistant-api";
import { foldLiveTurn, mergeLiveTurn, openLiveTurn, type LiveTurn } from "../../src/translate/live-turn";

const T0 = Date.UTC(2026, 9, 23, 18, 0, 0);

function folded(events: readonly AssistantEvent[]): LiveTurn {
  return events.reduce(foldLiveTurn, openLiveTurn("c:u1", "c:a1", "client-7", "do the thing", T0));
}

const savedUser: ConversationMessage = {
  id: "c:u1",
  role: "user",
  timestamp: new Date(T0).toISOString(),
  attachments: [],
  contentBlocks: [{ type: "text", text: "do the thing" }],
  textSegments: ["do the thing"],
};

const savedAssistant: ConversationMessage = {
  id: "c:a1",
  role: "assistant",
  timestamp: new Date(T0 + 1).toISOString(),
  attachments: [],
  contentBlocks: [{ type: "text", text: "Done." }],
};

describe("foldLiveTurn", () => {
  test("joins consecutive deltas and keeps reasoning, tools, and text in order", () => {
    const turn = folded([
      { type: "assistant_thinking_delta", thinking: "Plan " },
      { type: "assistant_thinking_delta", thinking: "it." },
      { type: "tool_use_start", toolName: "bash", input: { command: "ls" }, toolUseId: "t1" },
      { type: "tool_result", toolName: "bash", result: "a.txt", toolUseId: "t1" },
      { type: "assistant_text_delta", text: "Found " },
      { type: "assistant_text_delta", text: "a.txt" },
    ]);
    expect(turn.blocks.map((block) => block.type)).toEqual(["thinking", "tool_use", "text"]);
    expect(turn.blocks[0]).toEqual({ type: "thinking", thinking: "Plan it." });
    expect(turn.blocks[1]).toMatchObject({ toolCall: { id: "t1", name: "bash", result: "a.txt" } });
    expect(turn.blocks[2]).toEqual({ type: "text", text: "Found a.txt" });
  });
});

describe("mergeLiveTurn", () => {
  const streaming = folded([{ type: "assistant_text_delta", text: "Work" }]);

  test("adds the whole in-flight turn when Hermes has saved none of it", () => {
    const merged = mergeLiveTurn([], streaming);
    expect(merged.map((message) => [message.id, message.clientMessageId])).toEqual([
      ["c:u1", "client-7"],
      ["c:a1", undefined],
    ]);
    expect(merged[1]?.contentBlocks).toEqual([{ type: "text", text: "Work" }]);
  });

  test("adds only the partial reply when the user message is already saved", () => {
    const merged = mergeLiveTurn([savedUser], streaming);
    expect(merged.map((message) => message.id)).toEqual(["c:u1", "c:a1"]);
    expect(merged[0]?.clientMessageId).toBe("client-7");
  });

  test("defers to the saved turn once Hermes has it, keeping the client id on the user row", () => {
    const merged = mergeLiveTurn([savedUser, savedAssistant], streaming);
    expect(merged).toEqual([{ ...savedUser, clientMessageId: "client-7" }, savedAssistant]);
  });

  test("an in-flight turn with no output yet shows only the user message", () => {
    expect(mergeLiveTurn([], folded([])).map((message) => message.id)).toEqual(["c:u1"]);
  });

  test("history is untouched when nothing is in flight", () => {
    expect(mergeLiveTurn([savedUser], null)).toEqual([savedUser]);
  });
});
