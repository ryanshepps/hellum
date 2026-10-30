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

test("the assistant's avatar is Hellum's own image", async () => {
  const api = await start();
  const response = await api.get("workspace/file/content?path=data%2Favatar%2Favatar-image.png");
  expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
  expect(await response.text()).toContain("<svg");
});

test.each(["workspace/file/content?path=secrets.txt", "workspace/file?path=data%2Favatar%2Fcharacter-traits.json", "avatar/character-components"])(
  "%s is absent",
  async (path) => {
    const api = await start();
    expect((await api.get(path)).status).toBe(404);
  },
);
