import { afterEach, describe, expect, test } from "bun:test";
import { USAGE_DAY } from "../support/fake-hermes-usage";
import { authedClient, pairDevice, startTestBridge, type TestBridge } from "../support/test-bridge";

let bridge: TestBridge | null = null;

afterEach(async () => {
  await bridge?.dispose();
  bridge = null;
});

async function start() {
  bridge = await startTestBridge();
  return authedClient(bridge, await pairDevice(bridge));
}

const RANGE = `from=${USAGE_DAY - 3_600_000}&to=${USAGE_DAY + 48 * 3_600_000}`;

async function read<T>(api: Awaited<ReturnType<typeof start>>, path: string): Promise<T> {
  return (await (await api.get(path)).json()) as T;
}

describe("usage", () => {
  test("totals add up Hermes' sessions and count the ones it could not price", async () => {
    const api = await start();
    expect(await read(api, `usage/totals?${RANGE}`)).toMatchObject({
      totalInputTokens: 3500,
      totalOutputTokens: 350,
      totalEstimatedCostUsd: 0.75,
      eventCount: 3,
      pricedEventCount: 2,
      unpricedEventCount: 1,
    });
  });

  test("the breakdown groups by model, largest first", async () => {
    const api = await start();
    const { breakdown } = await read<{ breakdown: { group: string; eventCount: number }[] }>(api, `usage/breakdown?${RANGE}&groupBy=model`);
    expect(breakdown.map(({ group, eventCount }) => [group, eventCount])).toEqual([
      ["claude-sonnet", 2],
      ["gpt-5", 1],
    ]);
  });

  test("the breakdown by action tells chats from scheduled tasks", async () => {
    const api = await start();
    const { breakdown } = await read<{ breakdown: { group: string }[] }>(api, `usage/breakdown?${RANGE}&groupBy=call_site`);
    expect(breakdown.map(({ group }) => group).sort()).toEqual(["Chats", "Scheduled tasks"]);
  });

  test("daily buckets fall on the viewer's calendar days, empty days included", async () => {
    const api = await start();
    const { buckets } = await read<{ buckets: { date: string; eventCount: number }[] }>(api, `usage/daily?${RANGE}&tz=UTC`);
    expect(buckets.map(({ date, eventCount }) => [date, eventCount])).toEqual([
      ["2026-10-28", 2],
      ["2026-10-29", 1],
      ["2026-10-30", 0],
    ]);
  });

  test("the series splits each day into its groups", async () => {
    const api = await start();
    const { buckets } = await read<{ buckets: { groups: Record<string, { eventCount: number }> }[] }>(api, `usage/series?${RANGE}&tz=UTC&groupBy=model`);
    expect(buckets[0]?.groups["claude-sonnet"]?.eventCount).toBe(2);
  });

  test("a schedule filter keeps only that schedule's runs", async () => {
    const api = await start();
    expect(await read(api, `usage/totals?${RANGE}&scheduleId=job1`)).toMatchObject({ eventCount: 1, totalInputTokens: 2000 });
  });

  test("a range without bounds is refused", async () => {
    const api = await start();
    expect((await api.get("usage/totals")).status).toBe(400);
  });
});
