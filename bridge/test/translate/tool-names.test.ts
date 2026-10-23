import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../../src/hermes/schemas";
import { toVellumToolCall, type VellumToolCall } from "../../src/translate/tool-names";

const cases: ReadonlyArray<readonly [string, string, string | null, Readonly<Record<string, JsonValue>>, VellumToolCall]> = [
  ["terminal context", "terminal", "Running echo hi", {}, { toolName: "bash", input: { command: "echo hi" } }],
  ["terminal args win", "terminal", "Running echo hi", { command: "echo real" }, { toolName: "bash", input: { command: "echo real" } }],
  ["terminal unknown context", "terminal", "Doing things", {}, { toolName: "bash", input: { command: "Doing things" } }],
  ["other tool keeps its name", "web_search", "Searching cats", { query: "cats" }, { toolName: "web_search", input: { description: "Searching cats", query: "cats" } }],
  ["other tool without context", "read_file", null, {}, { toolName: "read_file", input: {} }],
];

describe("toVellumToolCall", () => {
  for (const [name, hermesName, context, args, expected] of cases) {
    test(name, () => {
      expect(toVellumToolCall(hermesName, context, args)).toEqual(expected);
    });
  }
});
