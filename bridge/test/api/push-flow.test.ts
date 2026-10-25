import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApnsKeyPem, startFakeApns, type FakeApns } from "../support/fake-apns";
import { authedClient, openEventStream, pairDevice, startTestBridge, type EventStreamReader, type TestBridge } from "../support/test-bridge";

const DEVICE_TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

let bridge: TestBridge | null = null;
let apns: FakeApns | null = null;
let stream: EventStreamReader | null = null;

afterEach(async () => {
  stream?.close();
  await bridge?.dispose();
  await apns?.close();
  bridge = null;
  apns = null;
  stream = null;
});

async function startWithPush() {
  apns = await startFakeApns();
  const keyPath = join(tmpdir(), `hellum-test-key-${crypto.randomUUID()}.p8`);
  await writeFile(keyPath, (await generateApnsKeyPem()).pem);
  bridge = await startTestBridge({
    HELLUM_APNS_KEY_PATH: keyPath,
    HELLUM_APNS_KEY_ID: "ABCDEFGHIJ",
    HELLUM_APNS_TEAM_ID: "TEAM123456",
    HELLUM_APNS_ORIGIN: apns.origin,
  });
  const token = await pairDevice(bridge);
  stream = await openEventStream(bridge, token);
  const status = (await (await authedClient(bridge, token).get("platform/status")).json()) as { assistantId: string };
  return { api: authedClient(bridge, token, status.assistantId), events: stream, fakeApns: apns, platformAssistantId: status.assistantId };
}

describe("push notifications", () => {
  test("the platform status exposes a stable UUID for push registration", async () => {
    const { platformAssistantId } = await startWithPush();
    expect(platformAssistantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("a registered iPhone is notified when a reply finishes", async () => {
    const { api, events, fakeApns } = await startWithPush();
    const registered = await api.send("POST", "push-tokens/", {
      token: DEVICE_TOKEN,
      platform: "ios",
      bundle_id: "com.ryanshepps.hellum",
      apns_environment: "development",
    });
    expect(registered.status).toBe(200);

    const sent = (await (await api.send("POST", "messages", { content: "ping", sourceChannel: "vellum", interface: "ios" })).json()) as {
      conversationId: string;
    };
    const received = await events.until((envelope) => envelope.message.type === "notification_intent");
    const [push] = await fakeApns.waitFor(1);
    expect(push?.path).toBe(`/3/device/${DEVICE_TOKEN}`);
    expect(push?.headers["apns-topic"]).toBe("com.ryanshepps.hellum");
    expect(JSON.parse(push?.body ?? "{}")).toMatchObject({
      aps: { alert: { title: "echo: ping", body: "echo: ping" } },
      conversationId: sent.conversationId,
      deep_link: { conversationId: sent.conversationId },
    });
    expect(received.at(-1)?.message).toMatchObject({
      type: "notification_intent",
      sourceEventName: "chat.assistant_reply",
      deepLinkMetadata: { conversationId: sent.conversationId },
      silent: false,
      remotePushDispatched: true,
      remotePushPlatforms: ["ios"],
    });
  });

  test("clients can acknowledge a local notification", async () => {
    const { api } = await startWithPush();
    const response = await api.send("POST", "notification-intent-result", { deliveryId: "d1", success: true });
    expect(await response.json()).toEqual({ ok: true });
  });

  test("a token Apple reports as unregistered is forgotten", async () => {
    const { api, events, fakeApns } = await startWithPush();
    fakeApns.respondWith(410, "Unregistered");
    await api.send("POST", "push-tokens/", { token: DEVICE_TOKEN, platform: "ios", bundle_id: "com.ryanshepps.hellum", apns_environment: "production" });

    await api.send("POST", "messages", { content: "one", sourceChannel: "vellum", interface: "ios" });
    await events.until((envelope) => envelope.message.type === "message_complete");
    await fakeApns.waitFor(1);
    const second = (await (await api.send("POST", "messages", { content: "two", sourceChannel: "vellum", interface: "ios" })).json()) as {
      conversationId: string;
    };
    await events.until((envelope) => envelope.message.type === "message_complete" && envelope.conversationId === second.conversationId);
    await Bun.sleep(100);
    expect(fakeApns.received).toHaveLength(1);
  });

  test("unregistering stops notifications", async () => {
    const { api, events, fakeApns } = await startWithPush();
    await api.send("POST", "push-tokens/", { token: DEVICE_TOKEN, platform: "ios", bundle_id: "com.ryanshepps.hellum", apns_environment: "production" });
    expect((await api.send("DELETE", `push-tokens/${DEVICE_TOKEN}/`)).status).toBe(204);
    await api.send("POST", "messages", { content: "quiet", sourceChannel: "vellum", interface: "ios" });
    await events.until((envelope) => envelope.message.type === "message_complete");
    await Bun.sleep(100);
    expect(fakeApns.received).toEqual([]);
  });

  test("android registrations are refused", async () => {
    const { api } = await startWithPush();
    const response = await api.send("POST", "push-tokens/", { token: "abc", platform: "android", bundle_id: "x", capabilities: [] });
    expect(response.status).toBe(422);
  });
});
