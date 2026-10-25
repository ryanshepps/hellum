import { describe, expect, test } from "bun:test";
import { cronJobId, outsideChatSignal, type FinishedReply, type ScheduledJob } from "../../src/notifications/outside-chat-producer";

const JOBS: ReadonlyMap<string, ScheduledJob> = new Map([
  ["a1b2c3d4e5f6", { name: "nightly status report", deliver: "local" }],
  ["aa11bb22cc33", { name: "telegram digest", deliver: "telegram" }],
]);

function reply(overrides: Partial<FinishedReply>): FinishedReply {
  return {
    id: "20261025_170610_c7dfdc3d",
    source: "webhook",
    title: "Deploy finished",
    started_at: 1_792_962_370,
    message_id: "41",
    replied_at: 1_792_962_373,
    text: "**Deploy** finished. All green.",
    silent: false,
    ...overrides,
  };
}

describe("cronJobId", () => {
  test.each([
    ["cron_a1b2c3d4e5f6_20261026_030001", "a1b2c3d4e5f6"],
    ["cron_job_with_underscores_20261026_030001", "job_with_underscores"],
    ["20261025_170610_c7dfdc3d", null],
  ])("%s belongs to job %p", (sessionId, jobId) => {
    expect(cronJobId(sessionId)).toBe(jobId);
  });
});

describe("outsideChatSignal", () => {
  test("a finished webhook reply notifies like a chat reply", () => {
    expect(outsideChatSignal(reply({}), JOBS)).toEqual({
      sourceEventName: "chat.assistant_reply",
      sourceChannel: "webhook",
      sourceContextId: "20261025_170610_c7dfdc3d",
      urgency: "medium",
      requestedTitle: "Deploy finished",
      requestedMessage: "Deploy finished. All green.",
      dedupeKey: "chat.assistant_reply:20261025_170610_c7dfdc3d:41",
    });
  });

  test("a scheduled run notifies with the schedule's name", () => {
    expect(outsideChatSignal(reply({ id: "cron_a1b2c3d4e5f6_20261026_030001", source: "cron", title: "nightly · Oct 26" }), JOBS)).toEqual({
      sourceEventName: "schedule.result",
      sourceChannel: "scheduler",
      sourceContextId: "cron_a1b2c3d4e5f6_20261026_030001",
      urgency: "medium",
      requestedTitle: "nightly status report",
      requestedMessage: "Deploy finished. All green.",
      dedupeKey: "schedule.result:a1b2c3d4e5f6:cron_a1b2c3d4e5f6_20261026_030001",
    });
  });

  test("a run of a deleted schedule still notifies under a generic title", () => {
    expect(outsideChatSignal(reply({ id: "cron_gone_20261026_030001", source: "cron" }), JOBS)?.requestedTitle).toBe("Scheduled task");
  });

  test.each([
    ["a run that answered [SILENT]", reply({ id: "cron_a1b2c3d4e5f6_20261026_030001", source: "cron", silent: true })],
    ["a run Hermes delivers somewhere else", reply({ id: "cron_aa11bb22cc33_20261026_030001", source: "cron" })],
    ["a Telegram chat", reply({ source: "telegram" })],
    ["a reply with no text", reply({ text: "   " })],
  ])("%s stays silent", (_label, finished) => {
    expect(outsideChatSignal(finished, JOBS)).toBeNull();
  });
});
