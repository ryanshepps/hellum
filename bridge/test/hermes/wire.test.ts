import { describe, expect, test } from "bun:test";
import { parseFrame, splitLines, type Frame } from "../../src/hermes/wire";

describe("splitLines", () => {
  const cases: ReadonlyArray<readonly [string, string, readonly string[], string]> = [
    ["", "a\nb\n", ["a", "b"], ""],
    ["", "partial", [], "partial"],
    ["par", "tial\nnext", ["partial"], "next"],
    ["", "\n\n  \n", [], ""],
  ];
  for (const [buffered, chunk, lines, rest] of cases) {
    test(JSON.stringify([buffered, chunk]), () => {
      expect(splitLines(buffered, chunk)).toEqual({ lines, rest });
    });
  }
});

describe("parseFrame", () => {
  const cases: ReadonlyArray<readonly [string, Frame]> = [
    ['{"jsonrpc":"2.0","id":"1","result":{"ok":true}}', { kind: "result", id: "1", result: { ok: true } }],
    ['{"jsonrpc":"2.0","id":7,"result":null}', { kind: "result", id: "7", result: null }],
    ['{"jsonrpc":"2.0","id":"2","error":{"code":4007,"message":"nope"}}', { kind: "error", id: "2", code: 4007, message: "nope" }],
    ['{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}', { kind: "error", id: null, code: -32700, message: "parse error" }],
    [
      '{"jsonrpc":"2.0","method":"event","params":{"type":"message.delta","session_id":"s","payload":{"text":"h"}}}',
      { kind: "event", event: { type: "message.delta", sessionId: "s", payload: { text: "h" } } },
    ],
    ['{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready"}}', { kind: "event", event: { type: "gateway.ready", sessionId: null, payload: undefined } }],
    ["not json", { kind: "invalid", line: "not json" }],
    ['{"unexpected":true}', { kind: "invalid", line: '{"unexpected":true}' }],
  ];
  for (const [line, expected] of cases) {
    test(line.slice(0, 70), () => {
      expect(parseFrame(line)).toEqual(expected);
    });
  }
});
