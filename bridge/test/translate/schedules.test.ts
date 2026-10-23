import { describe, expect, test } from "bun:test";
import { describeCadence, intervalToCron, parseRunReport, toVellumScheduleRuns } from "../../src/translate/schedules";

describe("intervalToCron", () => {
  test.each([
    [15, "*/15 * * * *"],
    [60, "0 * * * *"],
    [360, "0 */6 * * *"],
    [1440, "0 0 * * *"],
    [45, null],
    [420, null],
  ])("%d minutes → %p", (minutes, expected) => {
    expect(intervalToCron(minutes)).toBe(expected);
  });
});

describe("describeCadence", () => {
  test.each([
    [{ kind: "interval" as const, minutes: 30 }, "every 30 minutes"],
    [{ kind: "interval" as const, minutes: 120 }, "every 2 hours"],
    [{ kind: "interval" as const, minutes: 60 }, "every hour"],
    [{ kind: "cron" as const, expr: "0 9 * * *" }, "0 9 * * *"],
    [{ kind: "once" as const, run_at: "2026-11-01T09:30:00+00:00" }, "Once at 2026-11-01 09:30 UTC"],
  ])("%o → %s", (schedule, expected) => {
    expect(describeCadence({ schedule, schedule_display: null })).toBe(expected);
  });
});

describe("parseRunReport", () => {
  test("a successful run yields Hermes' response", () => {
    const report = parseRunReport("# Cron Job: brief\n\n**Job ID:** a\n\n## Prompt\n\nhi\n\n## Response\n\nAll clear.\n");
    expect(report).toEqual({ failed: false, response: "All clear.", error: null });
  });

  test("a failed run yields the error without fences", () => {
    const report = parseRunReport("# Cron Job: brief (FAILED)\n\n## Prompt\n\nhi\n\n## Error\n\n```\nTimeoutError: slow\n```\n");
    expect(report).toMatchObject({ failed: true, error: "TimeoutError: slow" });
  });
});

describe("toVellumScheduleRuns", () => {
  const sessions = [
    { id: "cron_job1_20261023_090000", title: "brief", startedAtMs: Date.parse("2026-10-23T09:00:00Z") },
    { id: "cron_job1_20261022_090000", title: "brief", startedAtMs: Date.parse("2026-10-22T09:00:00Z") },
    { id: "cron_job10_20261023_090005", title: "other", startedAtMs: Date.parse("2026-10-23T09:00:05Z") },
  ];

  test("each run links to the latest session of its own job that started before it finished", () => {
    const runs = toVellumScheduleRuns(
      "job1",
      [
        { id: "a", finished_at: "2026-10-23T09:00:20Z", output: "## Response\n\nok" },
        { id: "b", finished_at: "2026-10-22T09:00:10Z", output: "## Response\n\nok" },
      ],
      sessions,
    );
    expect(runs.map((run) => [run.conversationId, run.durationMs])).toEqual([
      ["cron_job1_20261023_090000", 20_000],
      ["cron_job1_20261022_090000", 10_000],
    ]);
  });

  test("a run without a session still appears, unlinked", () => {
    const [run] = toVellumScheduleRuns("job2", [{ id: "a", finished_at: "2026-10-23T09:00:20Z", output: "x" }], sessions);
    expect(run).toMatchObject({ conversationId: null, conversationExists: false, durationMs: null, conversations: [] });
  });
});
