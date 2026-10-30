import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readSettingsState } from "../support/fake-hermes-settings";
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

function hermes() {
  return readSettingsState(join(bridge?.stateDir ?? "", "fake-settings.json"));
}

async function config(api: Awaited<ReturnType<typeof start>>) {
  return (await (await api.get("config")).json()) as Record<string, unknown>;
}

describe("timezone", () => {
  test("the zone picked in Settings becomes Hermes' timezone", async () => {
    const api = await start();
    const response = await api.send("PATCH", "config", { ui: { userTimezone: "America/Toronto" } });
    expect(response.status).toBe(200);
    expect(hermes().values.timezone).toBe("America/Toronto");
    expect(await config(api)).toMatchObject({ ui: { userTimezone: "America/Toronto" } });
  });

  test("clearing the zone lets Hermes fall back to the system zone", async () => {
    const api = await start();
    await api.send("PATCH", "config", { ui: { userTimezone: "America/Toronto" } });
    await api.send("PATCH", "config", { ui: { userTimezone: "" } });
    expect(hermes().values.timezone).toBeUndefined();
    expect((await config(api)).ui).toBeUndefined();
  });

  test("a name that is not a time zone is refused", async () => {
    const api = await start();
    const response = await api.send("PATCH", "config", { ui: { userTimezone: "Mars/Olympus" } });
    expect(response.status).toBe(422);
    expect(hermes().values.timezone).toBeUndefined();
  });
});

describe("settings Hermes does not own", () => {
  test("a patch with nothing for Hermes leaves its settings alone", async () => {
    const api = await start();
    expect((await api.send("PATCH", "config", { conversations: { autoArchive: { enabled: true } } })).status).toBe(200);
    expect(hermes()).toEqual({ values: {}, env: {} });
  });
});
