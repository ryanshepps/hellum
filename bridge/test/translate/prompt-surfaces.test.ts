import { describe, expect, test } from "bun:test";
import type { HermesPrompt } from "../../src/hermes/schemas";
import { promptReply, type PromptReply } from "../../src/translate/prompt-surfaces";

const choice: HermesPrompt = { kind: "clarify", requestId: "p1", control: { promptId: "p1", generation: 3 }, question: "Tea or coffee?", choices: ["Tea", "Coffee"] };
const open: HermesPrompt = { kind: "clarify", requestId: "p2", control: { promptId: "p2", generation: 4 }, question: "Name?", choices: [] };
const secret: HermesPrompt = { kind: "secret", requestId: "srq-3", prompt: "Key", envVar: "API_KEY" };
const sudo: HermesPrompt = { kind: "sudo", requestId: "srq-4" };
const login: HermesPrompt = { kind: "login", requestId: "srq-5", origin: "https://login.yahoo.com", site: "login.yahoo.com" };

function answered(promptId: string, generation: number, answer: string, summary: string): PromptReply {
  return { kind: "control", method: "clarify.respond", params: { prompt_id: promptId, execution_generation: generation, answer }, summary };
}

describe("promptReply", () => {
  test.each([
    ["an option card tap", choice, "choice-1", {}, answered("p1", 3, "Coffee", "Coffee")],
    ["a multi-select submit", choice, "submit", { selectedTitles: ["Tea"] }, answered("p1", 3, "Tea", "Tea")],
    ["a typed answer", open, "submit", { answer: "  Ryan " }, answered("p2", 4, "Ryan", "Ryan")],
    ["a skipped question", open, "cancel", { answer: "ignored" }, answered("p2", 4, "", "Cancelled")],
    ["a secret", secret, "submit", { value: "s3cret" }, { kind: "response", requestId: "srq-3", value: "s3cret", summary: "Saved API_KEY" }],
    ["a dismissed secret", secret, "dismiss", { value: "s3cret" }, { kind: "response", requestId: "srq-3", value: "", summary: "Cancelled" }],
    ["a password", sudo, "submit", { password: "pw" }, { kind: "response", requestId: "srq-4", value: "pw", summary: "Password sent" }],
    ["a site login", login, "submit", { identifier: " me@x.com ", password: "pw" }, { kind: "response", requestId: "srq-5", value: '{"identifier":"me@x.com","password":"pw"}', summary: "Saved login for login.yahoo.com" }],
    ["a site login missing its password", login, "submit", { identifier: "me@x.com" }, { kind: "response", requestId: "srq-5", value: "", summary: "Cancelled" }],
  ] as const)("%s", (_label, prompt, actionId, data, expected) => {
    expect(promptReply(prompt, actionId, data)).toEqual(expected);
  });
});
