import { describe, expect, test } from "bun:test";
import type { ToolResultPayload } from "../../src/hermes/schemas";
import { formatToolResult, type FormattedToolResult } from "../../src/translate/tool-result";

const cases: ReadonlyArray<readonly [string, ToolResultPayload, FormattedToolResult]> = [
  ["missing result", undefined, { text: "", isError: false, status: undefined }],
  ["plain string", "done", { text: "done", isError: false, status: undefined }],
  ["successful command", { output: "hi", exit_code: 0, error: null }, { text: "hi", isError: false, status: undefined }],
  ["failing command", { output: "", exit_code: 2, error: null }, { text: "", isError: true, status: undefined }],
  [
    "blocked command",
    { output: "", exit_code: -1, error: "BLOCKED", status: "blocked" },
    { text: "BLOCKED", isError: true, status: "blocked" },
  ],
  ["structured result", { results: [1, 2] }, { text: '{\n  "results": [\n    1,\n    2\n  ]\n}', isError: false, status: undefined }],
];

describe("formatToolResult", () => {
  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(formatToolResult(input)).toEqual(expected);
    });
  }
});
