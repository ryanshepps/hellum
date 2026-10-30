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

describe("web search and fetch", () => {
  test("Settings shows Automatic until a backend is chosen", async () => {
    const api = await start();
    expect(await config(api)).toMatchObject({
      services: { "web-search": { provider: "inference-provider-native" }, "web-fetch": { provider: "default" } },
    });
  });

  test("the chosen providers become Hermes' search and extract backends", async () => {
    const api = await start();
    await api.send("PATCH", "config", { services: { "web-search": { provider: "brave", mode: "your-own" }, "web-fetch": { provider: "firecrawl" } } });
    expect(hermes().values).toEqual({ "web.search_backend": "brave-free", "web.extract_backend": "firecrawl" });
    expect(await config(api)).toMatchObject({ services: { "web-search": { provider: "brave" }, "web-fetch": { provider: "firecrawl" } } });
  });

  test("going back to Automatic hands the choice back to Hermes", async () => {
    const api = await start();
    await api.send("PATCH", "config", { services: { "web-search": { provider: "exa" } } });
    await api.send("PATCH", "config", { services: { "web-search": { provider: "inference-provider-native" } } });
    expect(hermes().values).toEqual({});
  });

  test("a SearXNG address is stored where Hermes looks for it", async () => {
    const api = await start();
    await api.send("PATCH", "config", { services: { "web-search": { provider: "searxng", apiBase: "http://127.0.0.1:8888" } } });
    expect(hermes().env).toEqual({ SEARXNG_URL: "http://127.0.0.1:8888" });
    expect(await config(api)).toMatchObject({ services: { "web-search": { provider: "searxng", apiBase: "http://127.0.0.1:8888" } } });
  });

  test.each([
    ["a provider Hermes lacks", { "web-search": { provider: "vellum" } }],
    ["a SearXNG address that is not a URL", { "web-search": { provider: "searxng", apiBase: "my searx" } }],
  ])("%s is refused", async (_label, services) => {
    const api = await start();
    expect((await api.send("PATCH", "config", { services })).status).toBe(422);
    expect(hermes()).toEqual({ values: {}, env: {} });
  });

  test("a web provider's API key is saved to Hermes' environment and reported as stored", async () => {
    const api = await start();
    expect((await api.send("POST", "secrets", { type: "api_key", name: "exa", value: "exa-key" })).status).toBe(200);
    expect(hermes().env).toEqual({ EXA_API_KEY: "exa-key" });
    const read = await api.send("POST", "secrets/read", { type: "api_key", name: "exa" });
    expect(await read.json()).toMatchObject({ found: true, value: "" });
  });
});

describe("speech", () => {
  test("Settings shows Hermes' defaults until a provider is chosen", async () => {
    const api = await start();
    expect(await config(api)).toMatchObject({ services: { tts: { provider: "edge" }, stt: { provider: "local" } } });
  });

  test("the catalogs list what Hermes can speak and transcribe with", async () => {
    const api = await start();
    const tts = (await (await api.get("tts/providers")).json()) as { providers: { id: string }[] };
    const stt = (await (await api.get("stt/providers")).json()) as { providers: { id: string }[] };
    expect(tts.providers.map((provider) => provider.id)).toContain("edge");
    expect(tts.providers.map((provider) => provider.id)).not.toContain("vellum");
    expect(stt.providers.map((provider) => provider.id)).toContain("groq");
  });

  test("the chosen providers and voice become Hermes' speech settings", async () => {
    const api = await start();
    await api.send("PATCH", "config", {
      services: { tts: { provider: "elevenlabs", mode: "your-own", providers: { elevenlabs: { voiceId: "adam" } } }, stt: { provider: "groq", mode: "your-own" } },
    });
    expect(hermes().values).toEqual({ "tts.provider": "elevenlabs", "tts.elevenlabs.voice_id": "adam", "stt.provider": "groq" });
    expect(await config(api)).toMatchObject({ services: { tts: { provider: "elevenlabs", providers: { elevenlabs: { voiceId: "adam" } } }, stt: { provider: "groq" } } });
  });

  test.each([
    ["speaking", { tts: { provider: "vellum" } }],
    ["transcribing", { stt: { provider: "deepgram" } }],
  ])("a provider Hermes lacks for %s is refused", async (_label, services) => {
    const api = await start();
    expect((await api.send("PATCH", "config", { services })).status).toBe(422);
  });

  test("a speech API key is saved to the variable Hermes reads", async () => {
    const api = await start();
    const response = await api.send("POST", "credentials/set", { service: "openai", field: "api_key", value: "sk-test" });
    expect(response.status).toBe(200);
    expect(hermes().env).toEqual({ VOICE_TOOLS_OPENAI_KEY: "sk-test" });
  });

  test("a credential Hermes has no place for is refused", async () => {
    const api = await start();
    expect((await api.send("POST", "credentials/set", { service: "google", field: "client_secret", value: "x" })).status).toBe(422);
  });
});
