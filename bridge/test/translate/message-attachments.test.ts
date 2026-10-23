import { describe, expect, test } from "bun:test";
import type { ConversationMessage, ConversationMessageAttachment } from "@vellumai/assistant-api";
import { decorateUserMessages, promptWithFileRefs } from "../../src/translate/message-attachments";

describe("promptWithFileRefs", () => {
  const cases: ReadonlyArray<readonly [string, readonly string[], string]> = [
    ["summarize this", ["@file:uploads/a.pdf"], "summarize this\n\n@file:uploads/a.pdf"],
    ["two files", ["@file:uploads/a.pdf", "@file:uploads/b.csv"], "two files\n\n@file:uploads/a.pdf\n@file:uploads/b.csv"],
    ["", ["@file:uploads/a.pdf"], "@file:uploads/a.pdf"],
    ["no files", [], "no files"],
  ];
  for (const [text, refs, prompt] of cases) {
    test(JSON.stringify([text, refs]), () => {
      expect(promptWithFileRefs(text, refs)).toBe(prompt);
    });
  }
});

describe("decorateUserMessages", () => {
  const pdf: ConversationMessageAttachment = { id: "a1", filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 3, kind: "document", fileBacked: true };
  const expanded = "read it\n\n--- Attached Context ---\n\n📄 @file:a.pdf\n```\ncontents\n```";
  const user: ConversationMessage = {
    id: "c:u0",
    role: "user",
    timestamp: "2026-10-23T18:00:00.000Z",
    attachments: [],
    contentBlocks: [{ type: "text", text: expanded }],
    textSegments: [expanded],
  };
  const assistant: ConversationMessage = { id: "c:a0", role: "assistant", timestamp: "2026-10-23T18:00:00.001Z", attachments: [] };

  test("shows the files and the words the user typed instead of Hermes' expanded prompt", () => {
    const [decorated, untouched] = decorateUserMessages([user, assistant], new Map([["c:u0", [pdf]]]), { "c:u0": "read it" });
    expect(decorated).toEqual({ ...user, attachments: [pdf], contentBlocks: [{ type: "text", text: "read it" }], textSegments: ["read it"] });
    expect(untouched).toBe(assistant);
  });

  test("keeps Hermes' text when the original prompt was not recorded", () => {
    expect(decorateUserMessages([user], new Map([["c:u0", [pdf]]]), {})[0]).toEqual({ ...user, attachments: [pdf] });
  });

  test("messages without attachments are returned as they were", () => {
    expect(decorateUserMessages([user], new Map(), { "c:u0": "read it" })[0]).toBe(user);
  });
});
