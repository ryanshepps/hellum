import { describe, expect, test } from "bun:test";
import type { HermesPrompt } from "../../src/hermes/schemas";
import { promptReply } from "../../src/translate/prompt-surfaces";

const choice: HermesPrompt = { kind: "clarify", requestId: "r1", question: "Tea or coffee?", choices: ["Tea", "Coffee"] };
const open: HermesPrompt = { kind: "clarify", requestId: "r2", question: "Name?", choices: [] };
const secret: HermesPrompt = { kind: "secret", requestId: "r3", prompt: "Key", envVar: "API_KEY" };
const sudo: HermesPrompt = { kind: "sudo", requestId: "r4" };

describe("promptReply", () => {
  test.each([
    ["an option card tap", choice, "choice-1", {}, "clarify.respond", { request_id: "r1", answer: "Coffee" }, "Coffee"],
    ["a multi-select submit", choice, "submit", { selectedTitles: ["Tea"] }, "clarify.respond", { request_id: "r1", answer: "Tea" }, "Tea"],
    ["a typed answer", open, "submit", { answer: "  Ryan " }, "clarify.respond", { request_id: "r2", answer: "Ryan" }, "Ryan"],
    ["a skipped question", open, "cancel", { answer: "ignored" }, "clarify.respond", { request_id: "r2", answer: "" }, "Cancelled"],
    ["a secret", secret, "submit", { value: "s3cret" }, "secret.respond", { request_id: "r3", value: "s3cret" }, "Saved API_KEY"],
    ["a dismissed secret", secret, "dismiss", { value: "s3cret" }, "secret.respond", { request_id: "r3", value: "" }, "Cancelled"],
    ["a password", sudo, "submit", { password: "pw" }, "sudo.respond", { request_id: "r4", password: "pw" }, "Password sent"],
  ] as const)("%s", (_label, prompt, actionId, data, method, params, summary) => {
    expect(promptReply(prompt, actionId, data)).toEqual({ method, params, summary });
  });
});
