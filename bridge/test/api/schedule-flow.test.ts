import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

type Schedule = { id: string; name: string; enabled: boolean; description: string; message: string; cronExpression: string; timezone: string };

type JsonSchema = { properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: unknown[] };

const DAEMON_SPEC = JSON.parse(readFileSync(join(import.meta.dir, "../../../clients/web/openapi-schemas/daemon.json"), "utf8")) as {
  paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: JsonSchema }> }> }>>;
};

function responseSchema(path: string, method: string): JsonSchema {
  const schema = DAEMON_SPEC.paths[`/v1/assistants/{assistant_id}/${path}`]?.[method]?.responses["200"]?.content["application/json"]?.schema;
  if (!schema) throw new Error(`no schema for ${method} ${path}`);
  return schema;
}

function missingFields(value: Record<string, unknown>, schema: JsonSchema): string[] {
  return (schema.required ?? []).filter((field) => !(field in value));
}

const NEW_SCHEDULE = {
  name: "Morning brief",
  description: "Summarise my day",
  expression: "0 9 * * 1-5",
  message: "What's on today?",
  timezone: "America/Toronto",
};

describe("schedules", () => {
  test("a created schedule is listed with its description and Hermes' timezone", async () => {
    const api = await start();
    const created = (await (await api.send("POST", "schedules", NEW_SCHEDULE)).json()) as { schedule: Schedule };
    expect(created.schedule).toMatchObject({ name: "Morning brief", description: "Summarise my day", cronExpression: "0 9 * * 1-5", enabled: true, timezone: "America/Toronto" });

    const listed = (await (await api.get("schedules")).json()) as { schedules: Schedule[] };
    expect(listed.schedules.map((schedule) => schedule.id)).toEqual([created.schedule.id]);
  });

  test("schedules carry every field the web client's schema requires", async () => {
    const api = await start();
    await api.send("POST", "schedules", NEW_SCHEDULE);
    const listed = (await (await api.get("schedules")).json()) as { schedules: Record<string, unknown>[] };
    const itemSchema = responseSchema("schedules", "get").properties?.schedules?.items ?? {};
    expect(listed.schedules[0] ? missingFields(listed.schedules[0], itemSchema) : ["<none>"]).toEqual([]);
  });

  test("toggling, editing and deleting change what Hermes stores", async () => {
    const api = await start();
    const { schedule } = (await (await api.send("POST", "schedules", NEW_SCHEDULE)).json()) as { schedule: Schedule };

    const toggled = (await (await api.send("POST", `schedules/${schedule.id}/toggle`, { enabled: false })).json()) as { schedules: Schedule[] };
    expect(toggled.schedules[0]?.enabled).toBe(false);

    const edited = (await (await api.send("PATCH", `schedules/${schedule.id}`, { message: "Anything urgent?" })).json()) as { schedules: Schedule[] };
    expect(edited.schedules[0]?.message).toBe("Anything urgent?");

    const deleted = (await (await api.send("DELETE", `schedules/${schedule.id}`)).json()) as { schedules: Schedule[] };
    expect(deleted.schedules).toEqual([]);
    expect((await api.get(`schedules/${schedule.id}`)).status).toBe(404);
  });

  test("running a schedule records a run with Hermes' response", async () => {
    const api = await start();
    const { schedule } = (await (await api.send("POST", "schedules", NEW_SCHEDULE)).json()) as { schedule: Schedule };
    await api.send("POST", `schedules/${schedule.id}/run`);

    const page = (await (await api.get(`schedules/${schedule.id}/runs?limit=10`)).json()) as { runs: Record<string, unknown>[]; nextCursor: number | null };
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]).toMatchObject({ status: "ok", output: "Done: What's on today?", error: null });
    const runSchema = responseSchema("schedules/{id}/runs", "get").properties?.runs?.items ?? {};
    expect(page.runs[0] ? missingFields(page.runs[0], runSchema) : ["<none>"]).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  test.each([
    ["an invalid cron expression", { ...NEW_SCHEDULE, expression: "whenever" }, 422],
    ["a missing message", { name: "x", expression: "0 9 * * *" }, 400],
  ])("creating with %s is rejected", async (_label, body, status) => {
    const api = await start();
    expect((await api.send("POST", "schedules", body)).status).toBe(status);
  });

  test("unknown schedules are not found", async () => {
    const api = await start();
    expect((await api.send("POST", "schedules/nope/toggle", { enabled: true })).status).toBe(404);
  });
});
