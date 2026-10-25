import { describe, expect, test } from "bun:test";
import { parseSendArgs, SendUsageError } from "../../src/notifications/send-command";

describe("parseSendArgs", () => {
  test("only --message is required, defaulting like Vellum", () => {
    expect(parseSendArgs(["--message", "Build finished"], {})).toEqual({
      json: false,
      request: { message: "Build finished", urgency: "low", sourceChannel: "assistant_tool", sourceEventName: "assistant.share" },
    });
  });

  test.each([
    [["--urgent"], "critical"],
    [["--urgency", "high"], "high"],
    [["--urgent", "--urgency", "medium"], "medium"],
  ] as const)("%p sends at %s urgency", (flags, urgency) => {
    expect(parseSendArgs(["--message", "m", ...flags], {}).request.urgency).toBe(urgency);
  });

  test.each([
    [["--session-id", "s1", "--conversation-id", "c1"], { HERMES_SESSION_ID: "h1" }, "s1"],
    [["--conversation-id", "c1"], { HERMES_SESSION_ID: "h1" }, "h1"],
    [["--conversation-id", "c1"], {}, "c1"],
    [[], {}, undefined],
  ])("%p with env %p links to %p", (flags, env, sourceContextId) => {
    expect(parseSendArgs(["--message", "m", ...flags], env).request.sourceContextId).toBe(sourceContextId);
  });

  test("title, source, dedupe key and json output pass through", () => {
    expect(
      parseSendArgs(
        ["--message", "m", "--title", "Sweep", "--source-channel", "scheduler", "--source-event-name", "sweep.done", "--dedupe-key", "k1", "--json"],
        {},
      ),
    ).toEqual({
      json: true,
      request: { message: "m", title: "Sweep", urgency: "low", sourceChannel: "scheduler", sourceEventName: "sweep.done", dedupeKey: "k1" },
    });
  });

  test.each([
    [[], "--message is required"],
    [["--message", "  "], "--message is required"],
    [["--message", "m", "--urgency", "loud"], 'Invalid urgency "loud". Must be one of: low, medium, high, critical'],
    [["--message", "m", "--conversation-id", " "], "Conversation ID must be a non-empty string"],
  ])("%p is refused", (args, message) => {
    expect(() => parseSendArgs(args, {})).toThrow(new SendUsageError(message));
  });
});
