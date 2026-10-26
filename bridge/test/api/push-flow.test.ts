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

type OutsideReply = { id: string; source: string; title: string; text: string; message_id: string };

async function writeOutsideReplies(replies: readonly OutsideReply[]): Promise<void> {
  const now = Date.now() / 1000;
  const rows = replies.map((reply) => ({ ...reply, started_at: now, replied_at: now + 1, silent: false }));
  await writeFile(join(bridge?.stateDir ?? "", "fake-sessions.json"), JSON.stringify(rows));
}

async function runCli(args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["bun", "run", join(import.meta.dir, "../../src/cli.ts"), ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, HELLUM_STATE_DIR: bridge?.stateDir ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exitCode !== 0) {
    throw new Error(`hellum ${args.join(" ")} failed: ${stderr}`);
  }
  return stdout.trim();
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
      bundle_id: "com.example.hellum",
      apns_environment: "development",
    });
    expect(registered.status).toBe(200);

    const sent = (await (await api.send("POST", "messages", { content: "ping", sourceChannel: "vellum", interface: "ios" })).json()) as {
      conversationId: string;
    };
    const received = await events.until((envelope) => envelope.message.type === "notification_intent");
    const [push] = await fakeApns.waitFor(1);
    expect(push?.path).toBe(`/3/device/${DEVICE_TOKEN}`);
    expect(push?.headers["apns-topic"]).toBe("com.example.hellum");
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

  test("a chat a webhook started notifies when Hermes finishes replying", async () => {
    const { api, fakeApns } = await startWithPush();
    await api.send("POST", "push-tokens/", { token: DEVICE_TOKEN, platform: "ios", bundle_id: "com.example.hellum", apns_environment: "production" });
    await writeOutsideReplies([
      { id: "20261025_170610_c7dfdc3d", source: "webhook", title: "Deploy hook", text: "Deploy **finished**.", message_id: "7" },
    ]);
    const [push] = await fakeApns.waitFor(1);
    expect(JSON.parse(push?.body ?? "{}")).toMatchObject({
      aps: { alert: { title: "Deploy hook", body: "Deploy finished." } },
      conversationId: "20261025_170610_c7dfdc3d",
    });
  });

  test("a scheduled run notifies under the schedule's name, once", async () => {
    const { api, fakeApns } = await startWithPush();
    await api.send("POST", "push-tokens/", { token: DEVICE_TOKEN, platform: "ios", bundle_id: "com.example.hellum", apns_environment: "production" });
    const created = (await (
      await api.send("POST", "schedules", { name: "Nightly sweep", expression: "0 3 * * *", message: "Sweep the repo", syntax: "cron", mode: "execute" })
    ).json()) as { schedule: { id: string } };
    await writeOutsideReplies([{ id: `cron_${created.schedule.id}_20261026_030001`, source: "cron", title: "", text: "No new issues.", message_id: "9" }]);
    const [push] = await fakeApns.waitFor(1);
    expect(JSON.parse(push?.body ?? "{}")).toMatchObject({ aps: { alert: { title: "Nightly sweep", body: "No new issues." } } });
    await Bun.sleep(400);
    expect(fakeApns.received).toHaveLength(1);
  });

  test("hellum notifications send --urgent reaches the phone and the open app", async () => {
    const { api, events, fakeApns } = await startWithPush();
    await api.send("POST", "push-tokens/", { token: DEVICE_TOKEN, platform: "ios", bundle_id: "com.example.hellum", apns_environment: "production" });
    const output = await runCli(["notifications", "send", "--message", "Prod is down", "--title", "Pager", "--urgent", "--json"]);
    expect(JSON.parse(output)).toEqual({ ok: true, dispatched: true, deduplicated: false, selectedChannels: ["vellum", "platform"], remotePushAccepted: true });
    const [push] = await fakeApns.waitFor(1);
    expect(JSON.parse(push?.body ?? "{}")).toMatchObject({ aps: { alert: { title: "Pager", body: "Prod is down" } } });
    const received = await events.until((envelope) => envelope.message.type === "notification_intent");
    expect(received.at(-1)?.message).toMatchObject({ silent: false, remotePushDispatched: true });
  });

  test("a plain send stays in the open app without a banner, like Vellum", async () => {
    const { api, events, fakeApns } = await startWithPush();
    await api.send("POST", "push-tokens/", { token: DEVICE_TOKEN, platform: "ios", bundle_id: "com.example.hellum", apns_environment: "production" });
    await runCli(["notifications", "send", "--message", "Build finished"]);
    const received = await events.until((envelope) => envelope.message.type === "notification_intent");
    expect(received.at(-1)?.message).toMatchObject({ sourceEventName: "assistant.share", silent: true, remotePushDispatched: false });
    expect(fakeApns.received).toHaveLength(0);
  });

  test("a repeated dedupe key is sent once", async () => {
    await startWithPush();
    const first = await runCli(["notifications", "send", "--message", "m", "--dedupe-key", "k1", "--json"]);
    const second = await runCli(["notifications", "send", "--message", "m", "--dedupe-key", "k1", "--json"]);
    expect(JSON.parse(first)).toMatchObject({ dispatched: true, deduplicated: false });
    expect(JSON.parse(second)).toMatchObject({ dispatched: false, deduplicated: true });
  });

  test("clients can acknowledge a local notification", async () => {
    const { api } = await startWithPush();
    const response = await api.send("POST", "notification-intent-result", { deliveryId: "d1", success: true });
    expect(await response.json()).toEqual({ ok: true });
  });

  test("a token Apple reports as unregistered is forgotten", async () => {
    const { api, events, fakeApns } = await startWithPush();
    fakeApns.respondWith(410, "Unregistered");
    await api.send("POST", "push-tokens/", { token: DEVICE_TOKEN, platform: "ios", bundle_id: "com.example.hellum", apns_environment: "production" });

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
    await api.send("POST", "push-tokens/", { token: DEVICE_TOKEN, platform: "ios", bundle_id: "com.example.hellum", apns_environment: "production" });
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
