import { afterEach, expect, test } from "bun:test";
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

const SOUNDS = { globalEnabled: true, volume: 0.8, events: { task_complete: { enabled: true, sounds: [] } } };

test("sound settings survive a reload", async () => {
  const api = await start();
  expect(await (await api.send("PUT", "sounds/config", SOUNDS)).json()).toEqual(SOUNDS);
  expect(await (await api.get("sounds/config")).json()).toEqual(SOUNDS);
});

test("a volume out of range is refused", async () => {
  const api = await start();
  expect((await api.send("PUT", "sounds/config", { ...SOUNDS, volume: 2 })).status).toBe(400);
});

test("the sound list answers even with no custom sounds", async () => {
  const api = await start();
  expect(await (await api.get("sounds/available")).json()).toEqual({ sounds: [] });
});
