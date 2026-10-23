import { afterEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { FAKE_SPEECH } from "../support/fake-hermes-voice";
import { authedClient, pairDevice, startTestBridge, type TestBridge } from "../support/test-bridge";

let bridge: TestBridge | null = null;

afterEach(async () => {
  await bridge?.dispose();
  bridge = null;
});

async function start(env: Record<string, string> = {}) {
  bridge = await startTestBridge(env);
  return authedClient(bridge, await pairDevice(bridge));
}

function audio(text: string, mimeType = "audio/webm;codecs=opus") {
  return { audioBase64: Buffer.from(text).toString("base64"), mimeType };
}

async function scratchFiles(): Promise<string[]> {
  return readdir(join(bridge?.stateDir ?? "", "voice")).catch(() => []);
}

describe("speech to text", () => {
  test("recorded audio is transcribed by Hermes and the recording is not kept", async () => {
    const api = await start();
    const response = await api.send("POST", "stt/transcribe", audio("remind me to buy marmalade"));
    expect(await response.json()).toEqual({ text: "remind me to buy marmalade", providerId: "local" });
    expect(await scratchFiles()).toEqual([]);
  });

  test.each([
    ["an unsupported audio type", audio("hi", "video/quicktime"), 400],
    ["empty audio", { audioBase64: "", mimeType: "audio/webm" }, 400],
    ["audio Hermes cannot transcribe", audio("noise"), 502],
  ])("%s is rejected", async (_label, body, status) => {
    const api = await start();
    expect((await api.send("POST", "stt/transcribe", body)).status).toBe(status);
  });
});

describe("text to speech", () => {
  test("Hermes speaks the text as mp3 audio", async () => {
    const api = await start();
    const response = await api.send("POST", "tts/synthesize", { text: "Hello there", conversationId: "c1" });
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(await response.text()).toBe(`${FAKE_SPEECH}: Hello there`);
    expect(await scratchFiles()).toEqual([]);
  });

  test("a broken Hermes TTS provider is reported as unavailable so the app can speak on-device", async () => {
    const api = await start({ FAKE_HERMES_TTS_BROKEN: "1" });
    expect((await api.send("POST", "tts/synthesize", { text: "Hello" })).status).toBe(503);
  });
});
