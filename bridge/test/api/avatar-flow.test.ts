import { afterEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
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

const TRAITS = { bodyShape: "no-such-shape", eyeStyle: "no-such-eyes", color: "green" };

async function validTraits(api: Awaited<ReturnType<typeof start>>) {
  const catalog = (await (await api.get("avatar/character-components")).json()) as Record<"bodyShapes" | "eyeStyles" | "colors", { id: string }[]>;
  return { bodyShape: catalog.bodyShapes[0]?.id, eyeStyle: catalog.eyeStyles[0]?.id, color: "green" };
}

async function state(api: Awaited<ReturnType<typeof start>>) {
  return (await (await api.get("avatar/state")).json()) as Record<string, unknown>;
}

const IMAGE_PATH = "workspace/file/content?path=data%2Favatar%2Favatar-image.png";

async function redPng(): Promise<string> {
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#d02020" } }).png().toBuffer();
  return png.toString("base64");
}

describe("avatar", () => {
  test("a new assistant wears Hellum's eyes", async () => {
    const api = await start();
    expect(await state(api)).toMatchObject({ kind: "image", traits: null });
    const image = await api.get(IMAGE_PATH);
    expect(image.headers.get("Content-Type")).toBe("image/svg+xml");
  });

  test("the character catalog lists every part the builder needs", async () => {
    const api = await start();
    const catalog = (await (await api.get("avatar/character-components")).json()) as Record<string, unknown[]>;
    expect(catalog.bodyShapes?.length).toBeGreaterThan(0);
    expect(catalog.eyeStyles?.length).toBeGreaterThan(0);
    expect(catalog.colors?.length).toBeGreaterThan(0);
  });

  test("a saved character is the avatar and is tinted by its colour", async () => {
    const api = await start();
    const traits = await validTraits(api);
    expect((await api.send("POST", "avatar/render-from-traits", traits)).status).toBe(200);
    expect(await state(api)).toMatchObject({ kind: "character", traits, source: "builder", accent: { hex: "#4C9B50", source: "palette" } });
    expect((await api.get(IMAGE_PATH)).status).toBe(404);
  });

  test("unknown traits are refused", async () => {
    const api = await start();
    expect((await api.send("POST", "avatar/render-from-traits", TRAITS)).status).toBe(400);
  });

  test("an uploaded image replaces a character and lends the avatar its colour", async () => {
    const api = await start();
    await api.send("POST", "avatar/render-from-traits", await validTraits(api));
    expect((await api.send("POST", "avatar/image", { content: await redPng(), encoding: "base64" })).status).toBe(200);
    expect(await state(api)).toMatchObject({ kind: "image", traits: null, source: "upload", accent: { source: "derived" } });
    expect((await api.get(IMAGE_PATH)).headers.get("Content-Type")).toBe("image/png");
  });

  test.each([
    ["text that is not base64", "not base64!"],
    ["bytes that are not an image", Buffer.from("just some text").toString("base64")],
  ])("%s is refused", async (_label, content) => {
    const api = await start();
    expect((await api.send("POST", "avatar/image", { content })).status).toBe(400);
  });

  test("the accent can be overridden and handed back", async () => {
    const api = await start();
    await api.send("POST", "avatar/render-from-traits", await validTraits(api));
    await api.send("POST", "avatar/accent", { hex: "#112233" });
    expect(await state(api)).toMatchObject({ accent: { hex: "#112233", source: "custom" } });
    await api.send("POST", "avatar/accent", { hex: null });
    expect(await state(api)).toMatchObject({ accent: { hex: "#4C9B50", source: "palette" } });
  });

  test("an accent needs a chosen avatar and a real colour", async () => {
    const api = await start();
    expect((await api.send("POST", "avatar/accent", { hex: null })).status).toBe(400);
    await api.send("POST", "avatar/render-from-traits", await validTraits(api));
    expect((await api.send("POST", "avatar/accent", { hex: "red" })).status).toBe(400);
  });

  test("removing the avatar goes back to Hellum's eyes", async () => {
    const api = await start();
    await api.send("POST", "avatar/render-from-traits", await validTraits(api));
    expect(await (await api.send("POST", "avatar/remove")).json()).toEqual({ ok: true, hadAvatar: true });
    expect(await state(api)).toMatchObject({ kind: "image", source: "upload", accent: null });
  });

  test("a chosen avatar survives a bridge restart", async () => {
    const first = await startTestBridge();
    const api = authedClient(first, await pairDevice(first));
    await api.send("POST", "avatar/render-from-traits", await validTraits(api));
    await first.stop();
    bridge = await startTestBridge({ HELLUM_STATE_DIR: first.stateDir });
    expect(await state(authedClient(bridge, await pairDevice(bridge)))).toMatchObject({ kind: "character" });
  });

  test.each(["workspace/file/content?path=secrets.txt", "workspace/file?path=data%2Favatar%2Fcharacter-traits.json"])("%s is absent", async (path) => {
    const api = await start();
    expect((await api.get(path)).status).toBe(404);
  });
});
