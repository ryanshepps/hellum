import { afterEach, describe, expect, test } from "bun:test";
import { isType, sendMessage } from "../support/chat";
import { missingFields, responseSchema } from "../support/daemon-spec";
import { readModelState } from "../support/fake-hermes-models";
import { authedClient, openEventStream, pairDevice, startTestBridge, type EventStreamReader, type TestBridge } from "../support/test-bridge";

let bridge: TestBridge | null = null;
let stream: EventStreamReader | null = null;

afterEach(async () => {
  stream?.close();
  stream = null;
  await bridge?.dispose();
  bridge = null;
});

async function start() {
  bridge = await startTestBridge();
  process.env.FAKE_HERMES_MODELS_FILE = `${bridge.stateDir}/fake-models.json`;
  const token = await pairDevice(bridge);
  return { api: authedClient(bridge, token), token, target: bridge };
}

type Llm = { profiles: Record<string, { label?: string; model?: string; provider?: string }>; profileOrder: string[]; activeProfile?: string };

async function llm(api: Awaited<ReturnType<typeof start>>["api"]): Promise<Llm> {
  return ((await (await api.get("config")).json()) as { llm: Llm }).llm;
}

const SONNET = { label: "Sonnet", provider: "anthropic", model: "claude-sonnet-4-6" };

describe("language model settings", () => {
  test("Hermes' current model shows as the active profile", async () => {
    const { api } = await start();
    expect(await llm(api)).toMatchObject({
      profiles: { hermes: { provider: "openrouter", model: "@preset/vellum-main" } },
      profileOrder: ["hermes"],
      activeProfile: "hermes",
    });
  });

  test("making a profile active switches Hermes' model", async () => {
    const { api } = await start();
    await api.send("PATCH", "config", { llm: { profiles: { sonnet: SONNET }, profileOrder: ["hermes", "sonnet"] } });
    expect((await llm(api)).activeProfile).toBe("hermes");

    expect(await (await api.send("PUT", "inference/active-profile", { name: "sonnet" })).json()).toEqual({ ok: true, activeProfile: "sonnet" });
    expect(readModelState()).toMatchObject({ model: "claude-sonnet-4-6", provider: "anthropic" });
    expect((await llm(api)).activeProfile).toBe("sonnet");
  });

  test("editing the active profile's model applies it to Hermes", async () => {
    const { api } = await start();
    await api.send("PATCH", "config", { llm: { profiles: { hermes: { model: "anthropic/claude-sonnet-5" } } } });
    expect(readModelState().model).toBe("anthropic/claude-sonnet-5");
    expect((await llm(api)).activeProfile).toBe("hermes");
  });

  test("a profile whose provider has no key cannot be made active", async () => {
    const { api } = await start();
    await api.send("PATCH", "config", { llm: { profiles: { cheap: { provider: "openai-compatible", provider_connection: "deepseek", model: "deepseek-chat" } } } });
    expect((await api.send("PUT", "inference/active-profile", { name: "cheap" })).status).toBe(422);
    expect(readModelState().model).toBe("@preset/vellum-main");
  });

  test("conversations keep working after the model changes", async () => {
    const { api, token, target } = await start();
    stream = await openEventStream(target, token);
    const first = await sendMessage(api, "before");
    await stream.until(isType("message_complete", first.conversationId));
    await api.send("PATCH", "config", { llm: { profiles: { sonnet: SONNET } } });
    await api.send("PUT", "inference/active-profile", { name: "sonnet" });

    await sendMessage(api, "after", first.conversationId);
    const received = await stream.until((envelope) => envelope.message.type === "assistant_text_delta" && envelope.message.text === "echo: after");
    expect(received.filter(isType("conversation_error"))).toEqual([]);
  });

  test("deleting a profile removes it from the order", async () => {
    const { api } = await start();
    await api.send("PATCH", "config", { llm: { profiles: { sonnet: SONNET }, profileOrder: ["hermes", "sonnet"] } });
    expect(await llm(api)).toMatchObject({ profileOrder: ["hermes", "sonnet"] });
    await api.send("PATCH", "config", { llm: { profiles: { sonnet: null } } });
    expect(await llm(api)).toMatchObject({ profileOrder: ["hermes"] });
  });
});

describe("providers", () => {
  test("connected Hermes providers are listed in the shape the web client expects", async () => {
    const { api } = await start();
    const { connections } = (await (await api.get("inference/provider-connections")).json()) as { connections: Record<string, unknown>[] };
    expect(connections.map((connection) => [connection.name, connection.provider])).toEqual([
      ["openrouter", "openrouter"],
      ["anthropic", "anthropic"],
    ]);
    const itemSchema = responseSchema("inference/provider-connections", "get").properties?.connections?.items ?? {};
    expect(connections.flatMap((connection) => missingFields(connection, itemSchema))).toEqual([]);
  });

  test("saving a key through secrets connects the provider and the key is never readable", async () => {
    const { api } = await start();
    const saved = await api.send("POST", "secrets", { type: "credential", name: "openrouter:api_key", value: "sk-or-new" });
    expect(await saved.json()).toEqual({ success: true, type: "credential", name: "openrouter:api_key" });

    const read = (await (await api.send("POST", "secrets/read", { type: "credential", name: "openrouter:api_key", reveal: true })).json()) as Record<string, unknown>;
    expect(read).toMatchObject({ found: true, value: "" });
    expect(JSON.stringify(read)).not.toContain("sk-or-new");
  });

  test("a key for a provider Hermes cannot map is rejected", async () => {
    const { api } = await start();
    expect((await api.send("POST", "secrets", { type: "credential", name: "elevenlabs:api_key", value: "x" })).status).toBe(422);
  });

  test("removing a provider disconnects it, except the one Hermes is using", async () => {
    const { api } = await start();
    expect((await api.send("DELETE", "inference/provider-connections/openrouter")).status).toBe(422);
    expect(await (await api.send("DELETE", "inference/provider-connections/anthropic")).json()).toEqual({ ok: true });
    const { connections } = (await (await api.get("inference/provider-connections")).json()) as { connections: { name: string }[] };
    expect(connections.map((connection) => connection.name)).toEqual(["openrouter"]);
  });

  test("the model picker lists models from connected providers", async () => {
    const { api } = await start();
    const { models } = (await (await api.get("inference/models")).json()) as { models: { provider: string; id: string }[] };
    expect(models.map((model) => `${model.provider}/${model.id}`)).toEqual([
      "openrouter/@preset/vellum-main",
      "openrouter/anthropic/claude-sonnet-5",
      "anthropic/claude-sonnet-4-6",
    ]);
  });
});
