import { describe, expect, test } from "bun:test";
import { deliverySignal } from "../../src/notifications/hermes-delivery";

describe("deliverySignal", () => {
  test("a scheduled job's result is a schedule result that opens the job's run", () => {
    expect(deliverySignal({ message: "**3 events** this week", jobId: "job1", jobName: "GTA tech events weekly", sessionId: "cron_job1_20261101_140000" })).toEqual({
      sourceEventName: "schedule.result",
      sourceChannel: "scheduler",
      sourceContextId: "cron_job1_20261101_140000",
      urgency: "medium",
      requestedTitle: "GTA tech events weekly",
      requestedMessage: "3 events this week",
      dedupeKey: "schedule.result:job1:cron_job1_20261101_140000",
    });
  });

  test("a message sent outside a schedule reaches a locked phone", () => {
    expect(deliverySignal({ message: "Deploy finished" })).toEqual({
      sourceEventName: "assistant.message",
      sourceChannel: "hermes",
      sourceContextId: undefined,
      urgency: "high",
      requestedMessage: "Deploy finished",
    });
  });

  test("an empty message sends nothing", () => {
    expect(deliverySignal({ message: "  ", jobId: "job1" })).toBeNull();
  });
});
