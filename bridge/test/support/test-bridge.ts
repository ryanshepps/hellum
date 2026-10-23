import type { AssistantEventEnvelope } from "@vellumai/assistant-api";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { startBridge, type BridgeServer } from "../../src/server";

const FAKE_GATEWAY_ARGV = JSON.stringify([process.execPath, join(import.meta.dir, "fake-hermes-gateway.ts")]);
const FAKE_HELPER_ARGV = JSON.stringify([process.execPath, join(import.meta.dir, "fake-hermes-helper.ts")]);

export type TestBridge = BridgeServer & {
  readonly stateDir: string;
  readonly request: (path: string, init?: RequestInit) => Promise<Response>;
  readonly admin: (method: "GET" | "POST" | "DELETE", path: string, body?: object) => Promise<Response>;
  readonly dispose: () => Promise<void>;
};

export async function startTestBridge(env: Readonly<Record<string, string>> = {}): Promise<TestBridge> {
  const stateDir = env.HELLUM_STATE_DIR ?? (await mkdtemp(join(tmpdir(), "hb-")));
  const bridge = await startBridge(
    loadConfig({
      PATH: process.env.PATH,
      HELLUM_PORT: "0",
      HELLUM_STATE_DIR: stateDir,
      HELLUM_WEB_DIST: join(import.meta.dir, "../fixtures/web"),
      HELLUM_HERMES_GATEWAY_ARGV: FAKE_GATEWAY_ARGV,
      HELLUM_HERMES_HELPER_ARGV: FAKE_HELPER_ARGV,
      FAKE_HERMES_MEMORY_FILE: join(stateDir, "fake-memory.json"),
      FAKE_HERMES_CRON_FILE: join(stateDir, "fake-cron.json"),
      ...env,
    }),
  );
  return {
    ...bridge,
    stateDir,
    request: (path, init) => fetch(new URL(path, bridge.url), init),
    admin: (method, path, body) =>
      fetch(`http://hellum${path}`, {
        method,
        unix: bridge.adminSocketPath,
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    dispose: async () => {
      await bridge.stop();
      await rm(stateDir, { recursive: true, force: true });
    },
  };
}

export function postJson(body: object, headers: Readonly<Record<string, string>> = {}): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}

export async function pairDevice(bridge: TestBridge): Promise<string> {
  const created = (await (await bridge.admin("POST", "/pairings")).json()) as { deviceCode: string };
  const response = await bridge.request("/v1/remote-web/pairing-token", postJson({ deviceCode: created.deviceCode }));
  return ((await response.json()) as { accessToken: string }).accessToken;
}

export type AuthedClient = {
  readonly get: (path: string) => Promise<Response>;
  readonly send: (method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: object) => Promise<Response>;
};

export function authedClient(bridge: TestBridge, token: string, assistantId = "self"): AuthedClient {
  const base = `/v1/assistants/${assistantId}/`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    get: (path) => bridge.request(`${base}${path}`, { headers }),
    send: (method, path, body) =>
      bridge.request(`${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }),
  };
}

export type EventStreamReader = {
  readonly until: (predicate: (envelope: AssistantEventEnvelope) => boolean, timeoutMs?: number) => Promise<readonly AssistantEventEnvelope[]>;
  readonly close: () => void;
};

export async function openEventStream(bridge: TestBridge, token: string, lastSeenSeq?: number): Promise<EventStreamReader> {
  const controller = new AbortController();
  const query = lastSeenSeq === undefined ? "" : `?lastSeenSeq=${lastSeenSeq}`;
  const response = await bridge.request(`/v1/assistants/self/events/${query}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (!response.body) throw new Error(`event stream failed: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const received: AssistantEventEnvelope[] = [];
  let buffered = "";

  async function pull(): Promise<boolean> {
    const { value, done } = await reader.read();
    if (done) return false;
    buffered += decoder.decode(value, { stream: true });
    const frames = buffered.split("\n\n");
    buffered = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      if (data) received.push(JSON.parse(data.slice("data: ".length)) as AssistantEventEnvelope);
    }
    return true;
  }

  return {
    async until(predicate, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (!received.some(predicate)) {
        if (Date.now() > deadline) {
          throw new Error(`timed out; saw ${received.map((envelope) => envelope.message.type).join(", ")}`);
        }
        if (!(await Promise.race([pull(), Bun.sleep(Math.max(1, deadline - Date.now())).then(() => true)]))) {
          throw new Error("event stream ended");
        }
      }
      return [...received];
    },
    close: () => controller.abort(),
  };
}
