import { describe, expect, test } from "bun:test";
import { isLocalNotificationSilent, renderCopy, selectChannels, type NotificationSignal, type Urgency } from "../../src/notifications/signal";

const BOTH = ["vellum", "platform"] as const;

function signal(sourceEventName: string, urgency: Urgency, extra: Partial<NotificationSignal> = {}): NotificationSignal {
  return { sourceEventName, sourceChannel: "assistant_tool", urgency, requestedMessage: "Build finished.", ...extra };
}

describe("selectChannels", () => {
  test.each([
    ["chat.assistant_reply", "medium", BOTH],
    ["schedule.result", "medium", BOTH],
    ["assistant.share", "critical", BOTH],
    ["assistant.share", "high", BOTH],
    ["assistant.share", "medium", ["vellum"]],
    ["assistant.share", "low", ["vellum"]],
  ] as const)("%s at %s urgency goes to %p", (name, urgency, expected) => {
    expect(selectChannels(signal(name, urgency), BOTH)).toEqual(expected);
  });

  test("a signal never reaches a channel that is not connected", () => {
    expect(selectChannels(signal("schedule.result", "medium"), ["vellum"])).toEqual(["vellum"]);
  });
});

describe("isLocalNotificationSilent", () => {
  test.each([
    ["chat.assistant_reply", "medium", false],
    ["schedule.result", "low", false],
    ["assistant.share", "high", false],
    ["assistant.share", "medium", true],
    ["assistant.share", "low", true],
  ] as const)("%s at %s urgency is silent: %p", (name, urgency, silent) => {
    expect(isLocalNotificationSilent(signal(name, urgency))).toBe(silent);
  });

  test("a quiet signal is always silent", () => {
    expect(isLocalNotificationSilent(signal("schedule.result", "medium", { quiet: true }))).toBe(true);
  });
});

describe("renderCopy", () => {
  test("a requested title is kept", () => {
    expect(renderCopy(signal("assistant.share", "high", { requestedTitle: "Nightly sweep" }))).toEqual({ title: "Nightly sweep", body: "Build finished." });
  });

  test("without a title the first sentence of the message becomes the title", () => {
    expect(renderCopy(signal("assistant.share", "high", { requestedMessage: "Deploy done. All checks green." })).title).toBe("Deploy done.");
  });

  test("a title that reads like prose is replaced by one from the message", () => {
    expect(renderCopy(signal("assistant.share", "high", { requestedTitle: "I need to tell you something" })).title).toBe("Build finished.");
  });
});
